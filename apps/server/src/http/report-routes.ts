import type { Hono } from "hono";
import { isReportKind } from "../reports/ids.ts";
import type { Logger, Store } from "../ports.ts";

/** Read-only report endpoints. No CSRF header needed. */
export function mountReportRoutes(app: Hono, { store, log }: { store: Store; log: Logger }): void {
  app.get("/api/reports", (c) => {
    try {
      const kindRaw = c.req.query("kind");
      if (kindRaw !== undefined && !isReportKind(kindRaw)) {
        return c.json({ error: "invalid kind (daily, weekly, trade)" }, 400);
      }
      const limitRaw = c.req.query("limit");
      const limit = limitRaw === undefined ? 30 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1) return c.json({ error: "invalid limit" }, 400);
      return c.json(store.reports({ ...(kindRaw === undefined ? {} : { kind: kindRaw }), limit: Math.min(limit, 100) }));
    } catch (error) {
      log.warn("reports list failed", { error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "reports unavailable" }, 502);
    }
  });

  app.get("/api/reports/:id", (c) => {
    try {
      const report = store.report(c.req.param("id"));
      if (report === undefined) return c.json({ error: "unknown report" }, 404);
      return c.json(report);
    } catch (error) {
      log.warn("report read failed", { error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "report unavailable" }, 502);
    }
  });
}
