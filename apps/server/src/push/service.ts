import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  PushSubscriptionSchema,
  type PushPayload,
  type PushSubscriptionInput,
} from "@rh/shared";
import type { Logger } from "../ports.ts";

// web-push is CommonJS without named ESM bindings; require keeps runtime and types together.
const webPush: typeof import("web-push") = createRequire(import.meta.url)("web-push");

/** Result counts for one fan-out send. */
export interface PushSendResult {
  sent: number;
  removed: number;
}

export interface PushService {
  /** VAPID public key for the client, generating and persisting keys on first use. */
  publicKey(): Promise<string>;
  subscribe(sub: PushSubscriptionInput): Promise<void>;
  /** Removes the subscription with this endpoint. Returns true when one was removed. */
  unsubscribe(endpoint: string): Promise<boolean>;
  send(payload: PushPayload): Promise<PushSendResult>;
}

export interface PushServiceDeps {
  dataDir: string;
  log: Logger;
  /** VAPID subject, an https: URL or mailto: address identifying this server. */
  subject: string;
  /** Defaults to web-push's sender; inject a fake in tests. */
  sendNotification?: typeof webPush.sendNotification;
  now?: () => number;
}

/** Browsers cap concurrent push subscriptions; 20 is plenty for one household. */
const MAX_SUBSCRIPTIONS = 20;
/** Push services retain undelivered messages for one hour. */
const TTL_SECONDS = 3600;
const SEND_TIMEOUT_MS = 10_000;

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
}

/** Host only: endpoints and keys are never logged. */
function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "invalid";
  }
}

function isVapidKeys(value: unknown): value is VapidKeys {
  if (typeof value !== "object" || value === null) return false;
  const keys = value as Record<string, unknown>;
  return typeof keys["publicKey"] === "string" && typeof keys["privateKey"] === "string";
}

function isStoredSubscriptions(value: unknown): value is StoredSubscription[] {
  if (!Array.isArray(value)) return false;
  return value.every((row: unknown) => {
    if (typeof row !== "object" || row === null) return false;
    const sub = row as { endpoint?: unknown; keys?: unknown };
    if (typeof sub.endpoint !== "string") return false;
    if (typeof sub.keys !== "object" || sub.keys === null) return false;
    const keys = sub.keys as { p256dh?: unknown; auth?: unknown };
    return typeof keys.p256dh === "string" && typeof keys.auth === "string";
  });
}

function statusCodeOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    return (error as { statusCode?: unknown }).statusCode;
  }
  return undefined;
}

/**
 * File-backed web push service. VAPID keys and subscriptions live under
 * `${dataDir}/push/` with a 0700 directory and 0600 files, written atomically
 * (temp file plus rename) so a crash never leaves a half-written file.
 */
export function createPushService(deps: PushServiceDeps): PushService {
  const dir = join(deps.dataDir, "push");
  const vapidPath = join(dir, "vapid.json");
  const subsPath = join(dir, "subscriptions.json");
  const log = deps.log;
  const now = deps.now ?? Date.now;
  const deliver = deps.sendNotification ?? webPush.sendNotification.bind(webPush);

  let keysPromise: Promise<VapidKeys> | undefined;

  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }

  async function atomicWrite(path: string, text: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, path);
    await chmod(path, 0o600);
  }

  function loadKeys(): Promise<VapidKeys> {
    if (keysPromise === undefined) {
      keysPromise = (async () => {
        await ensureDir();
        try {
          const parsed: unknown = JSON.parse(await readFile(vapidPath, "utf8"));
          if (isVapidKeys(parsed)) return parsed;
          log.warn("push vapid file invalid, regenerating");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            log.warn("push vapid file unreadable, regenerating");
          }
        }
        const keys = webPush.generateVAPIDKeys();
        await atomicWrite(vapidPath, JSON.stringify(keys));
        log.info("push vapid keys generated");
        return keys;
      })();
    }
    return keysPromise;
  }

  async function loadSubs(): Promise<StoredSubscription[]> {
    await ensureDir();
    try {
      const parsed: unknown = JSON.parse(await readFile(subsPath, "utf8"));
      if (isStoredSubscriptions(parsed)) return parsed;
      log.warn("push subscriptions file invalid, starting empty");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("push subscriptions file unreadable, starting empty");
      }
    }
    return [];
  }

  async function saveSubs(subs: StoredSubscription[]): Promise<void> {
    await ensureDir();
    await atomicWrite(subsPath, JSON.stringify(subs));
  }

  return {
    async publicKey(): Promise<string> {
      return (await loadKeys()).publicKey;
    },

    async subscribe(sub: PushSubscriptionInput): Promise<void> {
      const parsed = PushSubscriptionSchema.parse(sub);
      const subs = await loadSubs();
      const index = subs.findIndex((row) => row.endpoint === parsed.endpoint);
      const existing = subs[index];
      if (existing !== undefined) {
        subs[index] = { endpoint: existing.endpoint, keys: parsed.keys, createdAt: existing.createdAt };
      } else {
        subs.push({ endpoint: parsed.endpoint, keys: parsed.keys, createdAt: now() });
        while (subs.length > MAX_SUBSCRIPTIONS) subs.shift();
      }
      await saveSubs(subs);
      log.info("push subscribed", { host: endpointHost(parsed.endpoint) });
    },

    async unsubscribe(endpoint: string): Promise<boolean> {
      const subs = await loadSubs();
      const rest = subs.filter((row) => row.endpoint !== endpoint);
      if (rest.length === subs.length) return false;
      await saveSubs(rest);
      log.info("push unsubscribed", { host: endpointHost(endpoint) });
      return true;
    },

    async send(payload: PushPayload): Promise<PushSendResult> {
      const keys = await loadKeys();
      const subs = await loadSubs();
      if (subs.length === 0) return { sent: 0, removed: 0 };
      // Orders and halts wake the phone; everything else can wait for a poll.
      const tag = payload.tag ?? "";
      const urgency = tag === "halt" || tag.startsWith("order-") ? "high" : "normal";
      const body = JSON.stringify(payload);
      let sent = 0;
      const dead: string[] = [];
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await deliver(
              { endpoint: sub.endpoint, keys: sub.keys },
              body,
              {
                TTL: TTL_SECONDS,
                urgency,
                timeout: SEND_TIMEOUT_MS,
                vapidDetails: {
                  subject: deps.subject,
                  publicKey: keys.publicKey,
                  privateKey: keys.privateKey,
                },
              },
            );
            sent += 1;
          } catch (error) {
            const status = statusCodeOf(error);
            if (status === 404 || status === 410) {
              dead.push(sub.endpoint);
            } else {
              log.warn("push delivery failed", { host: endpointHost(sub.endpoint) });
            }
          }
        }),
      );
      let removed = 0;
      if (dead.length > 0) {
        const rest = subs.filter((row) => !dead.includes(row.endpoint));
        removed = subs.length - rest.length;
        await saveSubs(rest);
        log.info("push pruned dead subscriptions", { removed });
      }
      return { sent, removed };
    },
  };
}
