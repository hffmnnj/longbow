import type { Hono } from "hono";
import { SimRunConfigSchema } from "@rh/shared";
import type { Logger } from "../ports.ts";
import type { SimService } from "../sim/runner.ts";

export function mountSimRoutes(app: Hono, { sim, log }: { sim: SimService; log: Logger }): void {
  app.post("/api/sim/runs", async (c) => {
    try {
      const parsed = SimRunConfigSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid simulation configuration" }, 400);
      return c.json(await sim.start(parsed.data, "user"), 201);
    } catch (error) {
      log.warn("simulation start rejected", { error: String(error) });
      return c.json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
    }
  });
  app.get("/api/sim/runs", (c) => c.json(sim.list()));
  app.get("/api/sim/runs/:id", (c) => { const run = sim.get(c.req.param("id")); return run === undefined ? c.json({ error: "Unknown simulation" }, 404) : c.json(run); });
  app.post("/api/sim/runs/:id/stop", async (c) => { const run = await sim.stop(c.req.param("id")); return run === undefined ? c.json({ error: "Unknown simulation" }, 404) : c.json(run); });
  app.get("/api/sim/runs/:id/messages", async (c) => {
    if (sim.get(c.req.param("id")) === undefined) return c.json({ error: "Unknown simulation" }, 404);
    const limit = Number(c.req.query("limit") ?? "200");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) return c.json({ error: "limit must be 1 to 10000" }, 400);
    try { return c.json(await sim.messages(c.req.param("id"), limit, c.req.query("conversationId"))); }
    catch { return c.json({ error: "Unknown conversation" }, 404); }
  });
  app.get("/api/sim/runs/:id/journal", (c) => sim.get(c.req.param("id")) === undefined ? c.json({ error: "Unknown simulation" }, 404) : c.json(sim.journal(c.req.param("id"))));
  app.get("/api/sim/runs/:id/orders", (c) => sim.get(c.req.param("id")) === undefined ? c.json({ error: "Unknown simulation" }, 404) : c.json(sim.orders(c.req.param("id"))));
}
