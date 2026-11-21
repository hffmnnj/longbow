import { MarketCache, MarketError, TTL } from "../cache.ts";

/**
 * SEC EDGAR company data: ticker→CIK map, submissions (filings), and XBRL
 * company facts. Rate-limited client-side to stay under 10 requests/second.
 * Remote JSON is untrusted data; only the fields named here are parsed.
 */

/** SEC fair-access policy requires a contact in the User-Agent; set SEC_CONTACT to "Your Name you@example.com". */
export const SEC_HEADERS: Record<string, string> = {
  "User-Agent": process.env["SEC_CONTACT"]?.trim() || "robinhood-harness set-SEC_CONTACT@example.com",
  Accept: "application/json",
};

export interface SecFiling {
  form: string;
  filedAt: string;
  url: string;
  description: string;
}

export interface SecCompanyInfo {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  filings: SecFiling[];
}

export interface SecFactPoint {
  period: string;
  end: string;
  value: number;
  form: string;
  /** SEC filing date YYYY-MM-DD when this value was published (falls back to `end`). */
  filed: string;
}

export type SecFacts = Record<string, SecFactPoint[]>;

/** us-gaap tags with fallbacks, in preference order, per fact group. */
const FACT_TAGS: Record<string, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "TotalRevenues"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  epsDiluted: ["EarningsPerShareDiluted"],
  sharesOutstanding: ["CommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  longTermDebt: ["LongTermDebt", "LongTermDebtNoncurrent"],
};

let lastSecRequestAt = 0;

/** Serialize SEC requests with at least a 150ms gap (limit: 10/sec). */
export async function secThrottle(): Promise<void> {
  const gap = 150;
  const wait = lastSecRequestAt + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSecRequestAt = Date.now();
}

/** Ticker (uppercased) → zero-padded 10-digit CIK. */
export async function fetchTickerMap(cache: MarketCache): Promise<Map<string, string>> {
  return cache.getOrFetch("sec-tickers", TTL.secTickersMs, async () => {
    await secThrottle();
    const text = await cache.fetchText("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketError("bad_response", "sec ticker map returned invalid JSON");
    }
    if (typeof payload !== "object" || payload === null) {
      throw new MarketError("bad_response", "sec ticker map returned an unexpected shape");
    }
    const entries: [string, string][] = [];
    for (const value of Object.values(payload as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const { cik_str, ticker } = value as { cik_str?: unknown; ticker?: unknown };
      if (typeof cik_str !== "number" || typeof ticker !== "string") continue;
      entries.push([ticker.toUpperCase(), String(cik_str).padStart(10, "0")]);
    }
    if (entries.length === 0) throw new MarketError("bad_response", "sec ticker map returned no usable rows");
    return entries;
  }).then((entries) => new Map(entries as [string, string][]));
}

export function filingIndexUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
}

interface SecRecent {
  form?: unknown;
  filingDate?: unknown;
  accessionNumber?: unknown;
  reportDate?: unknown;
  primaryDocument?: unknown;
}

export function parseSubmissions(cik: string, payload: unknown, limit = 15): SecCompanyInfo {
  if (typeof payload !== "object" || payload === null) {
    throw new MarketError("bad_response", "sec submissions returned an unexpected shape");
  }
  const root = payload as {
    name?: unknown;
    sic?: unknown;
    sicDescription?: unknown;
    filings?: { recent?: SecRecent & Record<string, unknown[]> };
  };
  const name = typeof root.name === "string" ? root.name : cik;
  const sic = typeof root.sic === "string" ? root.sic : "";
  const sicDescription = typeof root.sicDescription === "string" ? root.sicDescription : "";
  const recent = root.filings?.recent;
  const filings: SecFiling[] = [];
  if (recent && Array.isArray(recent["form"])) {
    const count = recent["form"].length;
    const filedAtArr = Array.isArray(recent["filingDate"]) ? (recent["filingDate"] as unknown[]) : [];
    const accArr = Array.isArray(recent["accessionNumber"]) ? (recent["accessionNumber"] as unknown[]) : [];
    const repArr = Array.isArray(recent["reportDate"]) ? (recent["reportDate"] as unknown[]) : [];
    const docArr = Array.isArray(recent["primaryDocument"]) ? (recent["primaryDocument"] as unknown[]) : [];
    for (let i = 0; i < count && filings.length < limit; i++) {
      const form = recent["form"][i];
      if (typeof form !== "string" || typeof filedAtArr[i] !== "string" || typeof accArr[i] !== "string") continue;
      const reportDate = repArr[i];
      filings.push({
        form,
        filedAt: filedAtArr[i] as string,
        url: filingIndexUrl(cik, accArr[i] as string),
        description:
          typeof reportDate === "string" && reportDate !== ""
            ? `${form} (report date ${reportDate})`
            : typeof docArr[i] === "string" && (docArr[i] as string) !== ""
              ? `${form} (${docArr[i] as string})`
              : form,
      });
    }
  }
  return { cik, name, sic, sicDescription, filings };
}

export async function fetchCompanyInfo(cache: MarketCache, cik: string, asOf?: string): Promise<SecCompanyInfo> {
  const info = await cache.getOrFetch(`sec-sub-${asOf === undefined ? "" : "history-"}${cik}`, TTL.secCompanyMs, async () => {
    await secThrottle();
    const text = await cache.fetchText(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: SEC_HEADERS });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketError("bad_response", "sec submissions returned invalid JSON");
    }
    return parseSubmissions(cik, payload, asOf === undefined ? 15 : Infinity);
  });
  if (asOf === undefined) return info;
  return { ...info, filings: info.filings.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.filedAt) && f.filedAt <= asOf).slice(0, 15) };
}

interface XbrlPoint {
  end?: unknown;
  val?: unknown;
  form?: unknown;
  fy?: unknown;
  fp?: unknown;
  filed?: unknown;
}

/** Pick up to eight reported points (oldest first) for the first eligible tag. */
export function pickFactPoints(factsRoot: unknown, tags: string[], asOf?: string): SecFactPoint[] {
  if (typeof factsRoot !== "object" || factsRoot === null) return [];
  const gaap = (factsRoot as { facts?: { "us-gaap"?: Record<string, unknown> } }).facts?.["us-gaap"];
  if (typeof gaap !== "object" || gaap === null) return [];
  for (const tag of tags) {
    const entry = gaap[tag] as { units?: Record<string, XbrlPoint[]> } | undefined;
    const units = entry?.units;
    if (typeof units !== "object" || units === null) continue;
    const points: XbrlPoint[] =
      (Array.isArray(units["USD"]) ? units["USD"] : undefined) ??
      (Array.isArray(units["shares"]) ? units["shares"] : undefined) ??
      firstUnitArray(units);
    const clean: SecFactPoint[] = [];
    for (const p of points) {
      if (typeof p.end !== "string" || typeof p.val !== "number" || !Number.isFinite(p.val)) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.end)) continue;
      const filed = typeof p.filed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.filed) ? p.filed : undefined;
      if (asOf !== undefined && (filed === undefined || filed > asOf || p.end > asOf)) continue;
      clean.push({
        period: typeof p.fp === "string" && typeof p.fy === "number" ? `${p.fp} ${p.fy}` : p.end,
        end: p.end,
        value: p.val,
        form: typeof p.form === "string" ? p.form : "",
        filed: filed ?? p.end,
      });
    }
    if (clean.length === 0) continue;
    clean.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
    return clean.slice(Math.max(0, clean.length - 8));
  }
  return [];
}

function firstUnitArray(units: Record<string, XbrlPoint[]>): XbrlPoint[] {
  for (const arr of Object.values(units)) {
    if (Array.isArray(arr)) return arr;
  }
  return [];
}

export async function fetchCompanyFacts(cache: MarketCache, cik: string, asOf?: string): Promise<SecFacts> {
  async function request(): Promise<unknown> {
    await secThrottle();
    const text = await cache.fetchText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: SEC_HEADERS,
    });
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MarketError("bad_response", "sec company facts returned invalid JSON");
    }
  }
  function select(payload: unknown): SecFacts {
    const out: SecFacts = {};
    for (const [group, tags] of Object.entries(FACT_TAGS)) {
      const points = pickFactPoints(payload, tags, asOf);
      if (points.length > 0) out[group] = points;
    }
    return out;
  }
  if (asOf === undefined) return cache.getOrFetch(`sec-facts-${cik}`, TTL.secCompanyMs, async () => select(await request()));
  // Cache the date-independent source once per CIK, not a new snapshot for each replay day.
  return select(await cache.getOrFetch(`sec-facts-history-${cik}`, TTL.secCompanyMs, request));
}
