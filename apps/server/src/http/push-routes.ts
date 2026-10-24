import { Hono } from "hono";
import { PushSubscriptionSchema } from "@rh/shared";
import type { Logger } from "../ports.ts";
import type { PushService } from "../push/service.ts";

export interface PushRouteDeps {
  push: PushService;
  log: Logger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Web push endpoints for the installed app. Mounted inside the app's CSRF
 * and origin protection, so mutating routes need the `x-harness` header.
 */
export function mountPushRoutes(app: Hono, deps: PushRouteDeps): void {
  app.get("/api/push/key", async (c) => {
    try {
      return c.json({ publicKey: await deps.push.publicKey() });
    } catch (error) {
      deps.log.warn("push key failed", { error: errorMessage(error) });
      return c.json({ error: "push unavailable" }, 500);
    }
  });

  app.post("/api/push/subscribe", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = PushSubscriptionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    await deps.push.subscribe(parsed.data);
    return c.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const endpoint =
      typeof body === "object" && body !== null ? (body as { endpoint?: unknown }).endpoint : undefined;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return c.json({ error: "invalid endpoint" }, 400);
    }
    await deps.push.unsubscribe(endpoint);
    return c.json({ ok: true });
  });

  app.post("/api/push/test", async (c) => {
    try {
      const result = await deps.push.send({ title: "Longbow", body: "Notifications are on." });
      return c.json(result);
    } catch (error) {
      deps.log.warn("push test failed", { error: errorMessage(error) });
      return c.json({ error: "push unavailable" }, 500);
    }
  });
}
