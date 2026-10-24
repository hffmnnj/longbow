import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { PushPayload } from "@rh/shared";
import { mountPushRoutes } from "./push-routes.ts";
import type { PushSendResult, PushService } from "../push/service.ts";
import type { Logger } from "../ports.ts";

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

interface FakePush extends PushService {
  subs: string[];
  payloads: PushPayload[];
}

function fakePush(): FakePush {
  const subs: string[] = [];
  const payloads: PushPayload[] = [];
  return {
    subs,
    payloads,
    publicKey: () => Promise.resolve("test-public-key"),
    subscribe: (sub) => {
      subs.push(sub.endpoint);
      return Promise.resolve();
    },
    unsubscribe: (endpoint) => {
      const index = subs.indexOf(endpoint);
      if (index < 0) return Promise.resolve(false);
      subs.splice(index, 1);
      return Promise.resolve(true);
    },
    send: (payload: PushPayload): Promise<PushSendResult> => {
      payloads.push(payload);
      return Promise.resolve({ sent: subs.length, removed: 0 });
    },
  };
}

const SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
  keys: { p256dh: "p256dh-key", auth: "auth-secret" },
};

describe("push routes", () => {
  let push: FakePush;
  let app: Hono;

  beforeEach(() => {
    push = fakePush();
    app = new Hono();
    mountPushRoutes(app, { push, log });
  });

  it("returns the VAPID public key", async () => {
    const res = await app.request("/api/push/key");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { publicKey: "test-public-key" });
  });

  it("subscribes with a valid body and rejects invalid input", async () => {
    const ok = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SUB),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    assert.deepEqual(push.subs, [SUB.endpoint]);

    for (const bad of [{}, { endpoint: "not-a-url" }, { endpoint: SUB.endpoint, keys: {} }, "junk"]) {
      const res = await app.request("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bad),
      });
      assert.equal(res.status, 400, JSON.stringify(bad));
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /.+/);
    }
    assert.deepEqual(push.subs, [SUB.endpoint]);
  });

  it("unsubscribes by endpoint and rejects a missing one", async () => {
    push.subs.push(SUB.endpoint);
    const ok = await app.request("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: SUB.endpoint }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(push.subs, []);

    const bad = await app.request("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(bad.status, 400);
  });

  it("sends a test notification and returns the counts", async () => {
    push.subs.push(SUB.endpoint);
    const res = await app.request("/api/push/test", { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sent: 1, removed: 0 });
    assert.equal(push.payloads.length, 1);
    const payload = push.payloads[0];
    assert.ok(payload);
    assert.equal(payload.title, "Robinhood Harness");
    assert.equal(payload.body, "Notifications are on.");
  });
});
