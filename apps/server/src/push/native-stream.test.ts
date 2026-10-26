import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import type { PushPayload } from "@rh/shared";
import { createNativePushHub } from "./native-stream.ts";
import type { PushService } from "./service.ts";

test("every web push payload also reaches connected native clients", async () => {
  const sent: PushPayload[] = [];
  const web = { send: async (p: PushPayload) => (sent.push(p), { sent: 1, removed: 0 }) } as unknown as PushService;
  const hub = createNativePushHub();
  const push = hub.wrap(web);
  const app = new Hono();
  hub.mount(app);

  const res = await app.request("/api/push/native-stream");
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /connected/);
  assert.equal(hub.clients(), 1);

  const payload = { title: "Bought NVDA", body: "1.2 sh at $181.20", url: "/?order=o1", tag: "order-o1" };
  await push.send(payload);
  assert.deepEqual(JSON.parse(decoder.decode((await reader.read()).value).replace(/^data: /, "").trim()), payload);
  assert.deepEqual(sent, [payload], "web push still sends");

  await reader.cancel();
  assert.equal(hub.clients(), 0);
});
