import { z } from "zod";
import { replayLongPuts } from "./put-replay.ts";

/**
 * Offline candidate-hedge holdout.
 *
 * Scores explicitly dated, non-overlapping windows of observed data. Stock
 * values, option cash sleeves, quotes and order intents are supplied as data;
 * this module never fetches prices, invents an unobserved path, optimizes
 * parameters, or places an order. A window whose option position has no
 * observed closeout is reported as unscorable, never as a zero result.
 */

const cents = z.number().int().min(0).max(1_000_000_000);
const positiveCents = cents.min(1);
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/);
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/).refine((text) => {
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text;
}, "Invalid calendar date");
const time = z.string().max(24).regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/).refine((text) => {
  const parsed = Date.parse(text);
  const normal = text.includes(".") ? text : text.replace(/Z$/, ".000Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normal;
}, "Invalid UTC timestamp");

const quoteSchema = z.strictObject({
  at: time,
  contractId: id,
  bidCents: cents,
  askCents: positiveCents,
  bidSize: z.number().int().min(0).max(100_000),
  askSize: z.number().int().min(0).max(100_000),
});

const orderSchema = z.strictObject({
  at: time,
  contractId: id,
  side: z.enum(["buy", "sell"]),
  quantity: z.number().int().min(1).max(100),
  limitCents: positiveCents,
});

const provenanceSchema = z.strictObject({
  /** Label for the observed tape's source, for example a vendor or export name. */
  source: z.string().trim().min(1).max(200),
  /** Calendar date the quote tape was observed or retrieved. */
  quoteDate: day,
  kind: z.enum(["observed", "fixture"]),
});

const windowSchema = z.strictObject({
  id,
  startDate: day,
  endDate: day,
  startingEquityCents: positiveCents,
  optionCashSleeveCents: positiveCents,
  stock: z.strictObject({
    startValueCents: cents,
    endValueCents: cents.optional(),
    /** Alternative to endValueCents: shares plus unspent option cash at the end. */
    endStockOnlyEquityCents: z.number().int().min(0).max(2_000_000_000).optional(),
  }),
  feePerContractCents: cents.max(10_000),
  /** One standard fixed-expiry long put for this window. */
  put: z.strictObject({
    id,
    underlying: z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/),
    strikeCents: positiveCents,
    expiresAt: time,
    multiplier: z.literal(100),
  }),
  quotes: z.array(quoteSchema).min(1).max(50_000),
  orders: z.array(orderSchema).min(1).max(2_000),
  quoteProvenance: provenanceSchema,
});

const holdoutSchema = z.strictObject({
  windows: z.array(windowSchema).min(1).max(50),
});

type ParsedWindow = z.output<typeof windowSchema>;
type NormalizedWindow = ParsedWindow & { stockEndValueCents: number };
type ReplayResult = ReturnType<typeof replayLongPuts>;
type OrderOutcome = ReplayResult["orders"][number]["outcome"];

type ScoredWindowResult = {
  id: string;
  status: "scored";
  tradeLabel: "no-trade" | "option-traded";
  noTrade: boolean;
  startDate: string;
  endDate: string;
  quoteProvenance: ParsedWindow["quoteProvenance"];
  put: ParsedWindow["put"];
  feePerContractCents: number;
  startingEquityCents: number;
  optionCashSleeveCents: number;
  stock: { startValueCents: number; endValueCents: number };
  cashOnly: { endingEquityCents: number; netDeltaCents: number };
  sharesOnly: { endingEquityCents: number; netDeltaCents: number };
  hedged: { endingEquityCents: number; netDeltaCents: number };
  pairedNetDeltaCents: number;
  pairedNetDeltaUsd: number;
  optionCash: {
    endingCents: number;
    settledCents: number;
    unsettledProceedsCents: number;
    feesCents: number;
    peakPremiumAtRiskCents: number;
    fillCount: number;
    unfilledOrderCount: number;
    fills: ReplayResult["fills"];
    orderOutcomes: {
      at: string;
      side: "buy" | "sell";
      quantity: number;
      limitCents: number;
      outcome: OrderOutcome;
    }[];
  };
};

type UnscorableWindowResult = {
  id: string;
  status: "unscorable";
  reason: "incomplete-options-closeout";
  detail: string;
  startDate: string;
  endDate: string;
  quoteProvenance: ParsedWindow["quoteProvenance"];
  put: ParsedWindow["put"];
  feePerContractCents: number;
  startingEquityCents: number;
  optionCashSleeveCents: number;
  stock: { startValueCents: number; endValueCents: number };
  note: string;
};

type WindowResult = ScoredWindowResult | UnscorableWindowResult;

type HoldoutResult = {
  mode: "paper-put-holdout";
  fixture: boolean;
  provenance: {
    kinds: ("observed" | "fixture")[];
    historicalEvidence: "none" | "self-declared";
    cryptographicallyVerified: false;
    statement: string;
  };
  windows: WindowResult[];
  totals: {
    attemptedWindows: number;
    scoredWindows: number;
    unscorableWindows: number;
    denominator: string;
    cashOnly: { endingEquityCents: number | null; netDeltaCents: number | null };
    sharesOnly: { endingEquityCents: number | null; netDeltaCents: number | null };
    hedged: { endingEquityCents: number | null; netDeltaCents: number | null };
    pairedNetDeltaCents: number | null;
    pairedNetDeltaUsd: number | null;
    optionFeesCents: number | null;
    fillCount: number | null;
    unfilledOrderCount: number | null;
    noTradeWindows: number | null;
    incompleteOptionsWindows: number;
  };
  note: string;
};

const invalidWindow = (windowId: string, message: string): never => {
  throw new Error(`Invalid put holdout window ${windowId}: ${message}`);
};

function validateChronology(windows: ParsedWindow[]): void {
  const ids = new Set<string>();
  let previous: ParsedWindow | null = null;
  for (const window of windows) {
    if (ids.has(window.id)) throw new Error(`Duplicate put holdout window id ${window.id}`);
    ids.add(window.id);
    if (window.startDate >= window.endDate) {
      invalidWindow(window.id, "startDate must be before endDate");
    }
    if (previous !== null) {
      if (window.startDate <= previous.startDate) {
        throw new Error(`Put holdout windows must be provided in strictly increasing chronological order; ${window.id} follows ${previous.id}`);
      }
      if (window.startDate <= previous.endDate) {
        throw new Error(`Put holdout windows overlap; ${previous.id} ends ${previous.endDate} and ${window.id} starts ${window.startDate}`);
      }
    }
    previous = window;
  }
}

function normalizeWindow(window: ParsedWindow): NormalizedWindow {
  const hasEndValue = window.stock.endValueCents !== undefined;
  const hasEndOnlyEquity = window.stock.endStockOnlyEquityCents !== undefined;
  if (hasEndValue === hasEndOnlyEquity) {
    invalidWindow(window.id, "provide exactly one of stock.endValueCents or stock.endStockOnlyEquityCents");
  }
  if (window.startingEquityCents !== window.stock.startValueCents + window.optionCashSleeveCents) {
    invalidWindow(window.id, "startingEquityCents must equal stock.startValueCents + optionCashSleeveCents");
  }
  const stockEndValueCents = hasEndValue
    ? window.stock.endValueCents!
    : window.stock.endStockOnlyEquityCents! - window.optionCashSleeveCents;
  if (stockEndValueCents < 0) {
    invalidWindow(window.id, "stock.endStockOnlyEquityCents is below the option cash sleeve");
  }

  const expiresAt = Date.parse(window.put.expiresAt);
  for (const quote of window.quotes) {
    if (quote.contractId !== window.put.id) {
      invalidWindow(window.id, `quote contractId ${quote.contractId} does not match put.id ${window.put.id}`);
    }
    if (quote.at.slice(0, 10) < window.startDate || quote.at.slice(0, 10) > window.endDate) {
      invalidWindow(window.id, `quote at ${quote.at} is outside ${window.startDate}..${window.endDate}`);
    }
    if (Date.parse(quote.at) >= expiresAt) {
      invalidWindow(window.id, `quote at ${quote.at} is at or after put expiry ${window.put.expiresAt}`);
    }
  }
  for (const order of window.orders) {
    if (order.contractId !== window.put.id) {
      invalidWindow(window.id, `order contractId ${order.contractId} does not match put.id ${window.put.id}`);
    }
    if (order.at.slice(0, 10) < window.startDate || order.at.slice(0, 10) > window.endDate) {
      invalidWindow(window.id, `order at ${order.at} is outside ${window.startDate}..${window.endDate}`);
    }
    if (Date.parse(order.at) >= expiresAt) {
      invalidWindow(window.id, `order at ${order.at} is at or after put expiry ${window.put.expiresAt}`);
    }
  }

  return { ...window, stockEndValueCents };
}

function scoreWindow(window: NormalizedWindow): WindowResult {
  let replay: ReplayResult;
  try {
    replay = replayLongPuts({
      startingCashCents: window.optionCashSleeveCents,
      maxPremiumAtRiskCents: window.optionCashSleeveCents,
      feePerContractCents: window.feePerContractCents,
      contracts: [window.put],
      quotes: window.quotes,
      orders: window.orders,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // replayLongPuts reserves this prefix for a position without an observed closeout.
    if (detail.startsWith("Unscorable replay:")) {
      return {
        id: window.id,
        status: "unscorable",
        reason: "incomplete-options-closeout",
        detail,
        startDate: window.startDate,
        endDate: window.endDate,
        quoteProvenance: window.quoteProvenance,
        put: window.put,
        feePerContractCents: window.feePerContractCents,
        startingEquityCents: window.startingEquityCents,
        optionCashSleeveCents: window.optionCashSleeveCents,
        stock: { startValueCents: window.stock.startValueCents, endValueCents: window.stockEndValueCents },
        note: "Excluded from totals; the replay has no observed closeout for an open option position.",
      };
    }
    throw new Error(`Invalid put holdout window ${window.id}: ${detail}`);
  }

  const sharesOnlyEndingCents = window.stockEndValueCents + window.optionCashSleeveCents;
  const hedgedEndingCents = window.stockEndValueCents + replay.endingCashCents;
  const fillCount = replay.fills.length;
  return {
    id: window.id,
    status: "scored",
    tradeLabel: fillCount === 0 ? "no-trade" : "option-traded",
    noTrade: fillCount === 0,
    startDate: window.startDate,
    endDate: window.endDate,
    quoteProvenance: window.quoteProvenance,
    put: window.put,
    feePerContractCents: window.feePerContractCents,
    startingEquityCents: window.startingEquityCents,
    optionCashSleeveCents: window.optionCashSleeveCents,
    stock: { startValueCents: window.stock.startValueCents, endValueCents: window.stockEndValueCents },
    cashOnly: { endingEquityCents: window.startingEquityCents, netDeltaCents: 0 },
    sharesOnly: {
      endingEquityCents: sharesOnlyEndingCents,
      netDeltaCents: sharesOnlyEndingCents - window.startingEquityCents,
    },
    hedged: {
      endingEquityCents: hedgedEndingCents,
      netDeltaCents: hedgedEndingCents - window.startingEquityCents,
    },
    pairedNetDeltaCents: replay.netPnlCents,
    pairedNetDeltaUsd: replay.netPnlCents / 100,
    optionCash: {
      endingCents: replay.endingCashCents,
      settledCents: replay.endingSettledCashCents,
      unsettledProceedsCents: replay.endingUnsettledProceedsCents,
      feesCents: replay.feesCents,
      peakPremiumAtRiskCents: replay.peakPremiumAtRiskCents,
      fillCount,
      unfilledOrderCount: replay.orders.filter((order) => order.outcome !== "filled").length,
      fills: replay.fills,
      orderOutcomes: replay.orders.map(({ at, side, quantity, limitCents, outcome }) => ({
        at, side, quantity, limitCents, outcome,
      })),
    },
  };
}

/** Score supplied holdout windows; no pricing, lookahead path, optimizer, or broker call. */
export function scorePutHoldout(data: unknown): HoldoutResult {
  const parsed = holdoutSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    throw new Error(`Invalid put holdout input at ${first.path.join(".") || "root"}: ${first.message}`);
  }
  const windows = parsed.data.windows;
  validateChronology(windows);
  const results = windows.map(normalizeWindow).map(scoreWindow);

  let scoredCount = 0;
  let incompleteCount = 0;
  let cashOnlyEndingCents = 0;
  let sharesOnlyEndingCents = 0;
  let hedgedEndingCents = 0;
  let pairedNetDeltaCents = 0;
  let optionFeesCents = 0;
  let fillCount = 0;
  let unfilledOrderCount = 0;
  let noTradeCount = 0;
  for (const result of results) {
    if (result.status === "unscorable") {
      incompleteCount += 1;
      continue;
    }
    scoredCount += 1;
    cashOnlyEndingCents += result.cashOnly.endingEquityCents;
    sharesOnlyEndingCents += result.sharesOnly.endingEquityCents;
    hedgedEndingCents += result.hedged.endingEquityCents;
    pairedNetDeltaCents += result.pairedNetDeltaCents;
    optionFeesCents += result.optionCash.feesCents;
    fillCount += result.optionCash.fillCount;
    unfilledOrderCount += result.optionCash.unfilledOrderCount;
    if (result.noTrade) noTradeCount += 1;
  }
  const hasScores = scoredCount > 0;
  const kinds = [...new Set(windows.map((window) => window.quoteProvenance.kind))].sort();
  const fixture = kinds.includes("fixture");
  const statement = fixture
    ? "Fixture windows are synthetic and are not historical evidence. Quote provenance and fixture labels are self-declared and are not cryptographically verified."
    : "Quote provenance and fixture labels are self-declared and are not cryptographically verified.";

  return {
    mode: "paper-put-holdout",
    fixture,
    provenance: {
      kinds,
      historicalEvidence: fixture ? "none" : "self-declared",
      cryptographicallyVerified: false,
      statement,
    },
    windows: results,
    totals: {
      attemptedWindows: results.length,
      scoredWindows: scoredCount,
      unscorableWindows: results.length - scoredCount,
      denominator: `${scoredCount}/${results.length}`,
      cashOnly: {
        endingEquityCents: hasScores ? cashOnlyEndingCents : null,
        netDeltaCents: hasScores ? 0 : null,
      },
      sharesOnly: {
        endingEquityCents: hasScores ? sharesOnlyEndingCents : null,
        netDeltaCents: hasScores ? sharesOnlyEndingCents - cashOnlyEndingCents : null,
      },
      hedged: {
        endingEquityCents: hasScores ? hedgedEndingCents : null,
        netDeltaCents: hasScores ? hedgedEndingCents - cashOnlyEndingCents : null,
      },
      pairedNetDeltaCents: hasScores ? pairedNetDeltaCents : null,
      pairedNetDeltaUsd: hasScores ? pairedNetDeltaCents / 100 : null,
      optionFeesCents: hasScores ? optionFeesCents : null,
      fillCount: hasScores ? fillCount : null,
      unfilledOrderCount: hasScores ? unfilledOrderCount : null,
      noTradeWindows: hasScores ? noTradeCount : null,
      incompleteOptionsWindows: incompleteCount,
    },
    note: "Offline candidate hedge holdout over supplied windows. Each window's starting equity must equal its starting stock value plus the option cash sleeve; other cash is not supported. The cash-only arm holds that equity as idle cash with no interest or fees. Stock-side trading costs are not modeled. Options are scored only through observed closing quotes; exercise and expiry settlement are not modeled. Paired deltas are the options sleeve's realized net P&L against the same stock value; unscorable windows are excluded from totals and counted in the denominator. This is not a profitability assertion.",
  };
}
