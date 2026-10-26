/**
 * Bridge to the native Android shell (`apps/mobile`).
 *
 * The app wraps this web app in a WebView and registers a `LongbowBridge`
 * JavaScript channel. The web sends `LongbowBridge.postMessage(
 * JSON.stringify({ id, method, args }))`; native replies by running
 * `window.__longbowReply(<id>, <json>)` where json is
 * `{ "ok": true, "value": ... }` or `{ "ok": false, "error": "..." }`.
 * Every browser-only API the WebView lacks (haptics, badge, push, print,
 * clipboard) goes through here so the app matches Chrome feature for
 * feature. Outside the app every helper below degrades to the web default.
 */

export type HapticKind = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

export type NotificationStatus = "on" | "off" | "blocked";

interface LongbowBridge {
  postMessage(message: string): void;
}

interface LongbowWindow {
  LongbowBridge?: LongbowBridge;
  __longbowReply?: (id: number, json: string) => void;
}

function bridgeWindow(): LongbowWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as LongbowWindow;
}

/** True inside the native Android app, where the WebView exposes the channel. */
export function isNativeApp(): boolean {
  const w = bridgeWindow();
  return !!w?.LongbowBridge && typeof w.LongbowBridge.postMessage === "function";
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingCall>();
let nextId = 1;

/**
 * Calls a native method and resolves with its value. Rejects when outside
 * the app, when native reports an error, or after a 10-second timeout.
 */
export function nativeCall<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
  const w = bridgeWindow();
  const bridge = w?.LongbowBridge;
  if (!w || !bridge || typeof bridge.postMessage !== "function") {
    return Promise.reject(new Error(`Not in the native app (no bridge for "${method}")`));
  }
  if (!w.__longbowReply) {
    w.__longbowReply = (id: number, json: string) => {
      const slot = pending.get(id);
      if (!slot) return;
      pending.delete(id);
      clearTimeout(slot.timer);
      let parsed: { ok: boolean; value?: unknown; error?: unknown };
      try {
        parsed = JSON.parse(json) as { ok: boolean; value?: unknown; error?: unknown };
      } catch {
        slot.reject(new Error(`Native call ${id} returned unparsable JSON`));
        return;
      }
      if (parsed.ok) slot.resolve(parsed.value as T);
      else slot.reject(new Error(typeof parsed.error === "string" && parsed.error ? parsed.error : `Native call "${method}" failed`));
    };
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Native call "${method}" timed out`));
    }, 10_000);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    bridge.postMessage(JSON.stringify({ id, method, args: args ?? {} }));
  });
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs a section change inside a short crossfade view transition when the
 * browser supports it and the user does not prefer reduced motion.
 */
export function runSectionTransition(run: () => void): void {
  const doc =
    typeof document === "undefined"
      ? undefined
      : (document as Document & { startViewTransition?: (callback: () => void) => unknown });
  if (doc && typeof doc.startViewTransition === "function" && !prefersReducedMotion()) {
    try {
      doc.startViewTransition(run);
      return;
    } catch {
      // Fall through to the instant change.
    }
  }
  run();
}
