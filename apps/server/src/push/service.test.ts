import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PushPayload } from "@rh/shared";
import { createPushService, type PushServiceDeps } from "./service.ts";
import type { Logger } from "../ports.ts";

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

interface Call {
  endpoint: string;
  payload: string;
  ttl?: number;
  urgency?: string;
}

const calls: Call[] = [];
const failures = new Map<string, number>();

const fakeSender: NonNullable<PushServiceDeps["sendNotification"]> = async (
  subscription,
  payload,
  options,
) => {
  calls.push({
    endpoint: subscription.endpoint,
    payload: String(payload),
    ttl: options?.TTL,
    urgency: options?.urgency,
  });
  const status = failures.get(subscription.endpoint);
  if (status !== undefined) throw Object.assign(new Error(`push ${status}`), { statusCode: status });
  return { statusCode: 201, body: "", headers: {} };
};

function sub(endpoint: string, p256dh = "p256dh-key", auth = "auth-secret") {
  return { endpoint, keys: { p256dh, auth } };
}

describe("push service", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "push-"));
    calls.length = 0;
    failures.clear();
  });

  const make = () =>
    createPushService({ dataDir, log, subject: "mailto:test@example.com", sendNotification: fakeSender });

  it("generates VAPID keys once and reuses them across instances", async () => {
    const first = await make().publicKey();
    assert.match(first, /^[A-Za-z0-9_-]+$/);
    const second = await make().publicKey();
    assert.equal(second, first);
    const path = join(dataDir, "push", "vapid.json");
    assert.equal((statSync(path).mode & 0o777).toString(8), "600");
    const stored = JSON.parse(readFileSync(path, "utf8")) as { publicKey: string; privateKey: string };
    assert.equal(stored.publicKey, first);
    assert.ok(stored.privateKey.length > 0);
  });

  it("deduplicates subscriptions by endpoint and caps the list at 20", async () => {
    const push = make();
    await push.subscribe(sub("https://fcm.googleapis.com/fcm/send/one"));
    await push.subscribe(sub("https://fcm.googleapis.com/fcm/send/one", "new-p256dh", "new-auth"));
    for (let i = 0; i < 25; i += 1) {
      await push.subscribe(sub(`https://fcm.googleapis.com/fcm/send/extra-${i}`));
    }
    const stored = JSON.parse(readFileSync(join(dataDir, "push", "subscriptions.json"), "utf8")) as Array<{
      endpoint: string;
    }>;
    assert.equal(stored.length, 20);
    const firstStored = stored[0];
    assert.ok(firstStored);
    assert.equal(firstStored.endpoint, "https://fcm.googleapis.com/fcm/send/extra-5");
    assert.equal((statSync(join(dataDir, "push", "subscriptions.json")).mode & 0o777).toString(8), "600");
  });

  it("sends with a 1h TTL and high urgency for orders, and removes 410 answers", async () => {
    const push = make();
    await push.subscribe(sub("https://fcm.googleapis.com/fcm/send/good"));
    await push.subscribe(sub("https://fcm.googleapis.com/fcm/send/gone"));
    failures.set("https://fcm.googleapis.com/fcm/send/gone", 410);

    const payload: PushPayload = { title: "Bought 1 SPY", body: "Limit $500.00", tag: "order-o1" };
    const first = await push.send(payload);
    assert.deepEqual(first, { sent: 1, removed: 1 });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.ttl, 3600);
      assert.equal(call.urgency, "high");
      assert.equal(JSON.parse(call.payload).title, "Bought 1 SPY");
    }

    const second = await push.send({ title: "Day review", body: "Flat day.", tag: "review" });
    assert.deepEqual(second, { sent: 1, removed: 0 });
    const lastCall = calls[calls.length - 1];
    assert.ok(lastCall);
    assert.equal(lastCall.endpoint, "https://fcm.googleapis.com/fcm/send/good");
    assert.equal(lastCall.urgency, "normal");
  });

  it("keeps subscriptions that fail with a transient error", async () => {
    const push = make();
    await push.subscribe(sub("https://fcm.googleapis.com/fcm/send/flaky"));
    failures.set("https://fcm.googleapis.com/fcm/send/flaky", 503);
    const result = await push.send({ title: "t", body: "b", tag: "halt" });
    assert.deepEqual(result, { sent: 0, removed: 0 });
    failures.delete("https://fcm.googleapis.com/fcm/send/flaky");
    const retry = await push.send({ title: "t", body: "b", tag: "halt" });
    assert.deepEqual(retry, { sent: 1, removed: 0 });
  });

  it("unsubscribes by endpoint", async () => {
    const push = make();
    await push.subscribe(sub("https://fcm.googleapis.com/fcm/send/one"));
    assert.equal(await push.unsubscribe("https://fcm.googleapis.com/fcm/send/one"), true);
    assert.equal(await push.unsubscribe("https://fcm.googleapis.com/fcm/send/one"), false);
    assert.deepEqual(await push.send({ title: "t", body: "b" }), { sent: 0, removed: 0 });
    assert.equal(calls.length, 0);
  });
});
