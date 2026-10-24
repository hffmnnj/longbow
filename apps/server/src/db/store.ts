import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type JournalEntry,
  type OrderRecord,
} from "@rh/shared";
import type { Clock, Store } from "../ports.ts";

/**
 * App state in one SQLite file, synchronous via node:sqlite with WAL.
 * JSON columns hold the shared zod-validated shapes; ids are randomUUIDs.
 */
export function openStore(path: string, _clock: Clock): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journal (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      cycle_id TEXT,
      action TEXT NOT NULL,
      symbol TEXT,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL,
      confidence REAL,
      evidence TEXT NOT NULL,
      order_id TEXT,
      regime TEXT
    );
    CREATE INDEX IF NOT EXISTS journal_at ON journal (at DESC);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
    CREATE TABLE IF NOT EXISTS equity_marks (
      et_date TEXT PRIMARY KEY,
      day_start REAL NOT NULL,
      day_high REAL NOT NULL
    );
  `);
  // Additive migration: the latest observed equity of the day, so charts plot a close rather than the high.
  const markColumns = db.prepare("PRAGMA table_info(equity_marks)").all() as { name: string }[];
  if (!markColumns.some((column) => column.name === "day_last")) db.exec("ALTER TABLE equity_marks ADD COLUMN day_last REAL");

  const getSettings = (): ReturnType<Store["getSettings"]> => {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'settings'").get() as
      | { value: string }
      | undefined;
    if (row === undefined) {
      db.prepare("INSERT INTO kv (key, value) VALUES ('settings', ?)").run(JSON.stringify(DEFAULT_SETTINGS));
      return structuredClone(DEFAULT_SETTINGS);
    }
    const parsed: unknown = JSON.parse(row.value);
    // Merge new default fields over the stored row so upgrades add keys cheaply.
    const stored = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const storedRisk = typeof stored["risk"] === "object" && stored["risk"] !== null ? (stored["risk"] as Record<string, unknown>) : {};
    const merged = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...stored,
      risk: { ...structuredClone(DEFAULT_SETTINGS.risk), ...storedRisk },
    };
    return SettingsSchema.parse(merged);
  };

  const patchSettings: Store["patchSettings"] = (patch) => {
    const current = getSettings();
    const next = SettingsSchema.parse({
      ...current,
      ...patch,
      risk: { ...current.risk, ...(patch.risk ?? {}) },
    });
    db.prepare("INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      JSON.stringify(next),
    );
    return next;
  };

  const rowToJournal = (row: Record<string, unknown>): JournalEntry => ({
    id: row["id"] as string,
    at: row["at"] as number,
    ...(row["cycle_id"] != null ? { cycleId: row["cycle_id"] as string } : {}),
    action: row["action"] as JournalEntry["action"],
    ...(row["symbol"] != null ? { symbol: row["symbol"] as string } : {}),
    summary: row["summary"] as string,
    rationale: row["rationale"] as string,
    ...(row["confidence"] != null ? { confidence: row["confidence"] as number } : {}),
    evidence: JSON.parse(row["evidence"] as string) as string[],
    ...(row["order_id"] != null ? { orderId: row["order_id"] as string } : {}),
    ...(row["regime"] != null ? { regime: row["regime"] as string } : {}),
  });

  return {
    getSettings,
    patchSettings,

    addJournal(entry) {
      const full: JournalEntry = { ...entry, id: randomUUID() };
      db.prepare(
        `INSERT INTO journal (id, at, cycle_id, action, symbol, summary, rationale, confidence, evidence, order_id, regime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        full.id,
        full.at,
        full.cycleId ?? null,
        full.action,
        full.symbol ?? null,
        full.summary,
        full.rationale,
        full.confidence ?? null,
        JSON.stringify(full.evidence),
        full.orderId ?? null,
        full.regime ?? null,
      );
      return full;
    },

    listJournal(limit: number): JournalEntry[] {
      const rows = db
        .prepare("SELECT * FROM journal ORDER BY at DESC LIMIT ?")
        .all(Math.max(0, Math.floor(limit))) as Record<string, unknown>[];
      return rows.map(rowToJournal);
    },

    addOrder(order) {
      const full: OrderRecord = { ...order, id: randomUUID() };
      db.prepare("INSERT INTO orders (id, created_at, body) VALUES (?, ?, ?)").run(
        full.id,
        full.createdAt,
        JSON.stringify(full),
      );
      return full;
    },

    updateOrder(id, patch) {
      const current = this.getOrder(id);
      if (current === undefined) throw new Error(`Order not found: ${id}`);
      const next: OrderRecord = { ...current, ...patch, id: current.id, createdAt: current.createdAt };
      db.prepare("UPDATE orders SET body = ? WHERE id = ?").run(JSON.stringify(next), id);
      return next;
    },

    getOrder(id: string): OrderRecord | undefined {
      const row = db.prepare("SELECT body FROM orders WHERE id = ?").get(id) as
        | { body: string }
        | undefined;
      return row === undefined ? undefined : (JSON.parse(row.body) as OrderRecord);
    },

    listOrders(limit: number): OrderRecord[] {
      const rows = db
        .prepare("SELECT body FROM orders ORDER BY created_at DESC LIMIT ?")
        .all(Math.max(0, Math.floor(limit))) as { body: string }[];
      return rows.map((row) => JSON.parse(row.body) as OrderRecord);
    },

    ordersSince(since: number): OrderRecord[] {
      const rows = db
        .prepare("SELECT body FROM orders WHERE created_at >= ? ORDER BY created_at ASC")
        .all(since) as { body: string }[];
      return rows.map((row) => JSON.parse(row.body) as OrderRecord);
    },

    markEquity(_at: number, etDate: string, equity: number): void {
      const row = db.prepare("SELECT day_start, day_high FROM equity_marks WHERE et_date = ?").get(etDate) as
        | { day_start: number; day_high: number }
        | undefined;
      if (row === undefined) {
        db.prepare("INSERT INTO equity_marks (et_date, day_start, day_high, day_last) VALUES (?, ?, ?, ?)").run(
          etDate,
          equity,
          equity,
          equity,
        );
      } else {
        // First observation of the day stays the day start; the high only rises; the last always moves.
        db.prepare("UPDATE equity_marks SET day_high = MAX(day_high, ?), day_last = ? WHERE et_date = ?").run(equity, equity, etDate);
      }
    },

    equityMarks(etDate: string): { dayStart?: number; monthPeak?: number } {
      const row = db.prepare("SELECT day_start FROM equity_marks WHERE et_date = ?").get(etDate) as
        | { day_start: number }
        | undefined;
      const month = etDate.slice(0, 7);
      const peak = db
        .prepare("SELECT MAX(day_high) AS peak FROM equity_marks WHERE et_date LIKE ?")
        .get(`${month}%`) as { peak: number | null } | undefined;
      return {
        ...(row !== undefined ? { dayStart: row.day_start } : {}),
        ...(peak?.peak != null ? { monthPeak: peak.peak } : {}),
      };
    },

    equitySeries(): { etDate: string; dayStart: number; dayHigh: number; dayLast: number }[] {
      const rows = db
        .prepare("SELECT et_date, day_start, day_high, day_last FROM equity_marks ORDER BY et_date ASC")
        .all() as { et_date: string; day_start: number; day_high: number; day_last: number | null }[];
      return rows.map((row) => ({
        etDate: row.et_date,
        dayStart: row.day_start,
        dayHigh: row.day_high,
        dayLast: row.day_last ?? row.day_high,
      }));
    },
  };
}
