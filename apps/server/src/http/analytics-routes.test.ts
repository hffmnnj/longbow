import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Logger } from "../ports.ts";
import { mountAnalyticsRoutes } from "./analytics-routes.ts";
import type { AnalyticsService } from "../analytics/service.ts";

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

function appWith(service: Partial<AnalyticsService>): Hono {
  const app = new Hono();
  mountAnalyticsRoutes(app, { analytics: service as AnalyticsService, log });
  return app;
}

describe("analytics routes", () => {
  it("serves equity history with a default range", async () => {
    let seenRange: unknown;
    const app = appWith({
      equity: (async (range) => {
        seenRange = range;
        return { points: [], holdingsReplay: [] };
      }) as AnalyticsService["equity"],
    });
    const res = await app.request("/api/analytics/equity");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { points: [], holdingsReplay: [] });
    assert.equal(seenRange, "3m");
  });

  it("rejects an invalid equity range", async () => {
    const app = appWith({ equity: (async () => ({ points: [], holdingsReplay: [] })) as AnalyticsService["equity"] });
    const res = await app.request("/api/analytics/equity?range=2y");
    assert.equal(res.status, 400);
  });

  it("serves the performance summary", async () => {
    const app = appWith({
      performance: (async () => ({
        trades: [],
        realizedPnl: 0,
        calibration: [],
        exposure: [],
        sectors: [],
        ordersByStatus: {},
      })) as AnalyticsService["performance"],
    });
    const res = await app.request("/api/analytics/performance");
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { realizedPnl: number }).realizedPnl, 0);
  });

  it("serves the market overview", async () => {
    const app = appWith({
      marketOverview: (async () => ({
        asOf: 1,
        regime: "Sideways",
        indices: [],
        sectors: [],
        volatility: { vix: 15, contango: true, history: [] },
        yields: [],
        tenYearHistory: [],
        breadth: { aboveSma50: 0, total: 11 },
        calendar: [],
        earnings: [],
      })) as AnalyticsService["marketOverview"],
    });
    const res = await app.request("/api/market/overview");
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { regime: string }).regime, "Sideways");
  });

  it("serves symbol detail and rejects bad tickers", async () => {
    const app = appWith({
      symbolDetail: (async (symbol) => ({
        symbol,
        history: { symbol, bars: [], source: "test", asOf: 1 },
        indicators: {},
        orders: [],
        journal: [],
      })) as AnalyticsService["symbolDetail"],
    });
    assert.equal((await app.request("/api/symbols/aapl")).status, 200);
    assert.equal((await app.request("/api/symbols/TOOLONGTICKER")).status, 400);
    assert.equal((await app.request("/api/symbols/aa!")).status, 400);
  });

  it("maps upstream failures to 502 without internals", async () => {
    const failing = {
      equity: async () => {
        throw new Error("secret-token nasdaq timeout https://example.com");
      },
    } as unknown as AnalyticsService;
    const app = appWith(failing);
    const res = await app.request("/api/analytics/equity");
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /unavailable/);
    assert.ok(!body.error.includes("secret-token"));
  });
});
