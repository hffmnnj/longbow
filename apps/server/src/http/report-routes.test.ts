import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Report } from "@rh/shared";
import type { Logger } from "../ports.ts";
import { mountReportRoutes } from "./report-routes.ts";
import { openStore } from "../db/store.ts";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => log };

function report(id: string, kind: Report["kind"], at: number): Report {
  return {
    id,
    kind,
    at,
    periodStart: "2026-10-26",
    periodEnd: "2026-10-26",
    headline: `${kind} headline.`,
    narrative: { kind, headline: `${kind} headline.`, summary: "Summary.", sections: [], lessons: [], nextSteps: [] },
    facts: {
      periodStart: "2026-10-26",
      periodEnd: "2026-10-26",
      equityCurve: [],
      trades: [],
      realizedPnl: 0,
      orders: { submitted: 0, filled: 0, rejected: 0, cancelled: 0, failed: 0 },
      positions: [],
      decisions: [],
    },
  };
}

function appWithReports(): Hono {
  const dir = mkdtempSync(join(tmpdir(), "rh-reports-"));
  const store = openStore(join(dir, "app.sqlite"), { now: () => 0 });
  store.saveReport(report("daily-2026-10-26", "daily", 300));
  store.saveReport(report("weekly-2026-10-19", "weekly", 200));
  store.saveReport(report("trade-NVDA-1", "trade", 100));
  const app = new Hono();
  mountReportRoutes(app, { store, log });
  return app;
}

describe("report routes", () => {
  it("lists_summaries_newest_first_with_a_default_limit", async () => {
    const res = await appWithReports().request("/api/reports");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string }[];
    assert.deepEqual(body.map((r) => r.id), ["daily-2026-10-26", "weekly-2026-10-19", "trade-NVDA-1"]);
  });

  it("filters_by_kind", async () => {
    const app = appWithReports();
    const res = await app.request("/api/reports?kind=trade");
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { id: string }[]).map((r) => r.id), ["trade-NVDA-1"]);
  });

  it("rejects_a_bad_kind_and_a_bad_limit", async () => {
    const app = appWithReports();
    assert.equal((await app.request("/api/reports?kind=monthly")).status, 400);
    assert.equal((await app.request("/api/reports?limit=abc")).status, 400);
    assert.equal((await app.request("/api/reports?limit=0")).status, 400);
    assert.equal((await app.request("/api/reports?limit=5")).status, 200);
  });

  it("serves_a_full_report_and_404s_on_unknown_ids", async () => {
    const app = appWithReports();
    const res = await app.request("/api/reports/daily-2026-10-26");
    assert.equal(res.status, 200);
    const body = (await res.json()) as Report;
    assert.equal(body.headline, "daily headline.");
    assert.ok(Array.isArray(body.facts.trades));
    assert.equal((await app.request("/api/reports/daily-1999-01-01")).status, 404);
  });
});
