import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { JournalEntry, OrderRecord, StatusResponse } from "@rh/shared";
import { HEALTH_WINDOW_MS, buildHealthReport, type HealthInput } from "../src/monitor/health.ts";

/**
 * Read-only hourly health probe. Usage (from apps/server):
 *   node scripts/health-monitor.ts
 *
 * GETs /api/status with a timeout, then reads app.sqlite through a
 * read-only handle (SELECT only; never the store, which would migrate and
 * write). Never POSTs/PATCHes/DELETEs, never touches orders, settings, or
 * sessions. Prints exactly one bounded JSON object to stdout for journald.
 *
 * Environment (all optional):
 *   HARNESS_HEALTH_URL  status base URL, default http://127.0.0.1:4520.
 *                       Non-loopback hosts are rejected: health data must
 *                       never leave this machine.
 *   HARNESS_DATA_DIR    state directory, default ~/.local/share/robinhood-harness.
 */

const FETCH_TIMEOUT_MS = 10_000;
const ROW_LIMIT = 500;
const STOP_SCAN_LIMIT = 5_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const OPEN_STOP_STATUSES: OrderRecord["status"][] = ["held", "submitted", "partially_filled"];

function shortError(error: unknown, max = 200): string {
  const text = error instanceof Error ? error.message : String(error);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function resolveBaseUrl(): string {
  const raw = process.env["HARNESS_HEALTH_URL"] ?? "http://127.0.0.1:4520";
  const url = new URL(raw);
  if (url.protocol !== "http:") throw new Error(`refusing non-http health target ${url.protocol}`);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`refusing non-loopback health target ${url.hostname}; health data must not leave this machine`);
  }
  return url.origin;
}

function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["agent"] === "object" && v["agent"] !== null &&
    typeof v["market"] === "object" && v["market"] !== null &&
    typeof v["settings"] === "object" && v["settings"] !== null
  );
}

async function fetchStatus(base: string): Promise<{ ok: boolean; status: StatusResponse | null; error?: string }> {
  try {
    const response = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
    if (!response.ok) return { ok: false, status: null, error: `HTTP ${response.status}` };
    const body: unknown = await response.json();
    if (!isStatusResponse(body)) return { ok: false, status: null, error: "unexpected status shape" };
    return { ok: true, status: body };
  } catch (error) {
    return { ok: false, status: null, error: shortError(error) };
  }
}

interface DbRows {
  dbOk: boolean;
  dbError?: string;
  journalLastHour: HealthInput["journalLastHour"];
  ordersLastHour: OrderRecord[];
  openStops: HealthInput["openStops"];
}

function readDb(dataDir: string, now: number): DbRows {
  const empty: DbRows = { dbOk: true, journalLastHour: [], ordersLastHour: [], openStops: [] };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(dataDir, "app.sqlite"), { readOnly: true });
    const since = now - HEALTH_WINDOW_MS;
    const journal = db
      .prepare("SELECT at, action, symbol FROM journal WHERE at >= ? ORDER BY at DESC LIMIT ?")
      .all(since, ROW_LIMIT) as { at: number; action: JournalEntry["action"]; symbol: string | null }[];
    empty.journalLastHour = journal.map((row) => ({
      at: row.at,
      action: row.action,
      ...(row.symbol !== null ? { symbol: row.symbol } : {}),
    }));
    const orderRows = db
      .prepare("SELECT body FROM orders WHERE created_at >= ? ORDER BY created_at ASC LIMIT ?")
      .all(since, ROW_LIMIT) as { body: string }[];
    for (const row of orderRows) empty.ordersLastHour.push(JSON.parse(row.body) as OrderRecord);
    const stopRows = db
      .prepare("SELECT body FROM orders ORDER BY created_at DESC LIMIT ?")
      .all(STOP_SCAN_LIMIT) as { body: string }[];
    for (const row of stopRows) {
      const order = JSON.parse(row.body) as OrderRecord;
      if (
        order.intent.side === "sell" &&
        order.intent.orderType === "stop_limit" &&
        (OPEN_STOP_STATUSES as string[]).includes(order.status)
      ) {
        empty.openStops.push({
          symbol: order.intent.symbol,
          status: order.status,
          remainingQuantity: Math.max(0, order.intent.quantity - (order.filledQuantity ?? 0)),
        });
      }
    }
    return empty;
  } catch (error) {
    return { ...empty, dbOk: false, dbError: shortError(error), journalLastHour: [], ordersLastHour: [], openStops: [] };
  } finally {
    db?.close();
  }
}

async function main(): Promise<void> {
  const now = Date.now();
  try {
    const base = resolveBaseUrl();
    const dataDir = process.env["HARNESS_DATA_DIR"] ?? join(homedir(), ".local", "share", "robinhood-harness");
    const fetched = await fetchStatus(base);
    const rows = readDb(dataDir, now);
    const report = buildHealthReport({
      now,
      statusOk: fetched.ok,
      ...(fetched.error !== undefined ? { statusError: fetched.error } : {}),
      status: fetched.status,
      journalLastHour: rows.journalLastHour,
      ordersLastHour: rows.ordersLastHour,
      openStops: rows.openStops,
      dbOk: rows.dbOk,
      ...(rows.dbError !== undefined ? { dbError: rows.dbError } : {}),
    });
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        generatedAt: now,
        ok: false,
        coverage: "unavailable",
        findings: [{ code: "MONITOR_FAILED", severity: "error", message: shortError(error) }],
      }),
    );
    process.exitCode = 2;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
