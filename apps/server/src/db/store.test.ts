import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS, type JournalEntry, type OrderRecord } from "@rh/shared";
import { openStore } from "./store.ts";
import type { Clock } from "../ports.ts";

const clock: Clock = { now: () => 1_700_000_000_000 };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rh-store-"));
});

function dbPath(): string {
  return join(dir, "app.sqlite");
}

describe("store settings", () => {
  it("defaults and merges new default fields on read", () => {
    const store = openStore(dbPath(), clock);
    assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS);
  });

  it("fills risk fields added after a row was saved", () => {
    openStore(dbPath(), clock).getSettings();
    const { minOrderNotionalUsd: _dropped, ...oldRisk } = DEFAULT_SETTINGS.risk;
    void _dropped;
    const db = new DatabaseSync(dbPath());
    db.prepare("UPDATE kv SET value = ? WHERE key = 'settings'").run(
      JSON.stringify({ ...DEFAULT_SETTINGS, mode: "off", risk: { ...oldRisk, maxPositions: 2 } }),
    );
    db.close();
    const settings = openStore(dbPath(), clock).getSettings();
    assert.equal(settings.mode, "off");
    assert.equal(settings.risk.maxPositions, 2);
    assert.equal(settings.risk.minOrderNotionalUsd, DEFAULT_SETTINGS.risk.minOrderNotionalUsd);
  });

  it("merges risk field by field and validates", () => {
    const store = openStore(dbPath(), clock);
    const next = store.patchSettings({ risk: { maxRiskPerTradePct: 2 } });
    assert.equal(next.risk.maxRiskPerTradePct, 2);
    assert.equal(next.risk.maxPositionPct, DEFAULT_SETTINGS.risk.maxPositionPct);
    assert.equal(next.mode, DEFAULT_SETTINGS.mode);
    assert.throws(() => store.patchSettings({ risk: { maxRiskPerTradePct: -1 } }));
  });

  it("persists across opens", () => {
    const store = openStore(dbPath(), clock);
    store.patchSettings({ mode: "off", killSwitch: true });
    const reopened = openStore(dbPath(), clock);
    assert.equal(reopened.getSettings().mode, "off");
    assert.equal(reopened.getSettings().killSwitch, true);
  });
});

describe("store journal", () => {
  const entry = (at: number): Omit<JournalEntry, "id"> => ({
    at,
    action: "hold",
    summary: "steady",
    rationale: "Nothing to do today.",
    evidence: ["portfolio flat"],
  });

  it("lists newest first", () => {
    const store = openStore(dbPath(), clock);
    store.addJournal(entry(100));
    store.addJournal(entry(300));
    store.addJournal(entry(200));
    const rows = store.listJournal(10);
    assert.deepEqual(rows.map((r) => r.at), [300, 200, 100]);
    assert.ok(rows[0]?.id);
  });

  it("respects the limit", () => {
    const store = openStore(dbPath(), clock);
    store.addJournal(entry(1));
    store.addJournal(entry(2));
    assert.equal(store.listJournal(1).length, 1);
  });
});

describe("store orders", () => {
  const order = (at: number): Omit<OrderRecord, "id"> => ({
    createdAt: at,
    updatedAt: at,
    intent: {
      symbol: "SPY",
      side: "buy",
      quantity: 1,
      orderType: "limit",
      limitPrice: 500,
      timeInForce: "day",
      invalidationPrice: 490,
      timeStopDate: "2026-11-30",
      thesis: "Uptrend intact with room to the recent high.",
      probabilityWin: 0.55,
      expectedGainPct: 3,
      expectedLossPct: 2,
      estimatedCostPct: 0.05,
      evidence: ["price above 50-day average"],
    },
    verdict: { approved: true, isExit: false, checks: [] },
    status: "pending_approval",
  });

  it("adds, gets, updates, and lists newest first", () => {
    const store = openStore(dbPath(), clock);
    const a = store.addOrder(order(100));
    const b = store.addOrder(order(200));
    assert.deepEqual(store.getOrder(a.id)?.status, "pending_approval");
    assert.equal(store.getOrder("missing"), undefined);
    const updated = store.updateOrder(a.id, { status: "submitted", updatedAt: 150 });
    assert.equal(updated.status, "submitted");
    assert.equal(updated.createdAt, 100);
    assert.deepEqual(store.listOrders(10).map((o) => o.id), [b.id, a.id]);
    assert.throws(() => store.updateOrder("missing", { status: "rejected_user" }));
  });

  it("ordersSince returns oldest first from the bound", () => {
    const store = openStore(dbPath(), clock);
    store.addOrder(order(100));
    store.addOrder(order(200));
    store.addOrder(order(300));
    assert.deepEqual(store.ordersSince(200).map((o) => o.createdAt), [200, 300]);
  });
});

describe("store equity marks", () => {
  it("keeps the first observation per day and the month peak", () => {
    const store = openStore(dbPath(), clock);
    store.markEquity(1, "2026-10-26", 100_000);
    store.markEquity(2, "2026-10-26", 101_000);
    store.markEquity(3, "2026-10-26", 99_000);
    store.markEquity(4, "2026-10-27", 102_000);
    store.markEquity(5, "2026-11-02", 90_000);
    assert.deepEqual(store.equityMarks("2026-10-26"), { dayStart: 100_000, monthPeak: 102_000 });
    assert.deepEqual(store.equityMarks("2026-10-27"), { dayStart: 102_000, monthPeak: 102_000 });
    assert.deepEqual(store.equityMarks("2026-11-02"), { dayStart: 90_000, monthPeak: 90_000 });
    assert.deepEqual(store.equityMarks("2026-10-28"), { monthPeak: 102_000 });
    assert.deepEqual(store.equitySeries()[0], { etDate: "2026-10-26", dayStart: 100_000, dayHigh: 101_000, dayLast: 99_000 });
  });
});
