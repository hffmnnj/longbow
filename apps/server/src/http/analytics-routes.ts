import type { Hono } from "hono";
import type { AnalyticsRange } from "@rh/shared";
import type { Logger } from "../ports.ts";
import type { AnalyticsService } from "../analytics/service.ts";

const RANGES: AnalyticsRange[] = ["1m", "3m", "1y", "all"];
const SYMBOL = /^([A-Z.]{1,10}|[A-Z]{2,10}-USD)$/;

/**
 * Read-only dashboard endpoints. Upstream failures (market data, broker reads)
 * return 502 with a short message; nothing from the underlying error,
 * and never a credential, reaches the client.
 */
export function mountAnalyticsRoutes(app: Hono, { analytics, log }: { analytics: AnalyticsService; log: Logger }): void {
  app.get("/api/analytics/equity", async (c) => {
    const range = c.req.query("range") ?? "3m";
    if (!RANGES.includes(range as AnalyticsRange)) return c.json({ error: "invalid range (1m, 3m, 1y, all)" }, 400);
    try {
      return c.json(await analytics.equity(range as AnalyticsRange));
    } catch (error) {
      log.warn("equity endpoint failed", { error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "equity history unavailable" }, 502);
    }
  });

  app.get("/api/analytics/performance", async (c) => {
    try {
      return c.json(await analytics.performance());
    } catch (error) {
      log.warn("performance endpoint failed", { error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "performance summary unavailable" }, 502);
    }
  });

  app.get("/api/market/overview", async (c) => {
    try {
      return c.json(await analytics.marketOverview());
    } catch (error) {
      log.warn("market overview failed", { error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "market overview unavailable" }, 502);
    }
  });

  app.get("/api/symbols/:symbol", async (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    if (!SYMBOL.test(symbol)) return c.json({ error: "invalid symbol" }, 400);
    try {
      return c.json(await analytics.symbolDetail(symbol));
    } catch (error) {
      log.warn("symbol detail failed", { symbol, error: error instanceof Error ? error.message : "unknown" });
      return c.json({ error: "symbol detail unavailable" }, 502);
    }
  });
}
