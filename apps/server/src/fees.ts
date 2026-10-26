/**
 * Robinhood equity trading fees, from https://robinhood.com/us/en/support/articles/trading-fees-on-robinhood/
 * (checked 2026-10-25). Commissions are zero; these are the regulatory pass-throughs Robinhood charges.
 * Review the schedule when the SEC publishes a new Section 31 rate or FINRA changes the TAF.
 */

/** SEC Section 31 fee on sells, dollars per dollar sold, by effective ET date (newest last). */
const SEC_RATES: readonly { from: string; rate: number }[] = [
  { from: "0000-01-01", rate: 0 },
  { from: "2026-04-04", rate: 20.6 / 1_000_000 },
];
/** Robinhood does not pass the SEC fee on for equity sales with a notional of $500 or less. */
const SEC_WAIVED_UP_TO_USD = 500;

/** FINRA trading activity fee on sells, per share, rounded to the nearest cent, capped per trade. */
const TAF_PER_SHARE = 0.000195;
const TAF_MAX_USD = 9.79;
/** Robinhood does not pass the TAF on for sales of 50 shares or fewer. */
const TAF_WAIVED_UP_TO_SHARES = 50;
/** FINRA paused the TAF for these ET dates, inclusive. */
const TAF_PAUSES: readonly { from: string; to: string }[] = [{ from: "2026-10-01", to: "2026-12-31" }];

/** Consolidated Audit Trail fee on every listed-equity order, per share; under a cent rounds to zero. */
const CAT_PER_SHARE = 0.000003;

/**
 * Issuers of American depositary receipts charge custody fees, typically $0.01 to $0.03 per share,
 * deducted periodically rather than per trade. Known ADRs among names this harness may trade.
 */
export const ADR_SYMBOLS: ReadonlySet<string> = new Set([
  "TSM", "ASML", "ARM", "BABA", "PDD", "JD", "BIDU", "NVO", "AZN", "SAP", "SONY", "TM", "SHEL", "BP", "UL",
  "HSBC", "RIO", "BHP", "INFY", "SNY", "GSK", "DEO", "BTI", "TTE", "NIO", "SE", "MELI",
]);
/** Annual ADR custody fee assumed per share when estimating a holding's cost. */
export const ADR_FEE_PER_SHARE_YEAR = 0.03;

export interface FeeInput {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  /** ET date of the trade (YYYY-MM-DD); decides which rates and pauses apply. */
  date: string;
}

export interface Fees {
  sec: number;
  taf: number;
  cat: number;
  total: number;
}

const roundUpCent = (usd: number): number => Math.ceil(usd * 100 - 1e-9) / 100;
const roundCent = (usd: number): number => Math.round(usd * 100) / 100;

/** Regulatory fees Robinhood charges on one equity order, in dollars. */
export function equityFees({ side, quantity, price, date }: FeeInput): Fees {
  const notional = Math.abs(quantity * price);
  const shares = Math.abs(quantity);
  let sec = 0;
  let taf = 0;
  if (side === "sell") {
    const rate = SEC_RATES.filter((r) => r.from <= date).at(-1)?.rate ?? 0;
    if (notional > SEC_WAIVED_UP_TO_USD && rate > 0) sec = roundUpCent(notional * rate);
    const paused = TAF_PAUSES.some((p) => date >= p.from && date <= p.to);
    if (shares > TAF_WAIVED_UP_TO_SHARES && !paused) taf = Math.min(TAF_MAX_USD, roundCent(shares * TAF_PER_SHARE));
  }
  const rawCat = shares * CAT_PER_SHARE;
  const cat = rawCat < 0.01 ? 0 : roundCent(rawCat);
  return { sec, taf, cat, total: roundCent(sec + taf + cat) };
}

/**
 * Fees for buying `quantity` at `entry` and selling it at `exit`, as a percent of the entry notional.
 * The exit date is unknown at entry, so the entry date's schedule is used for both legs.
 */
export function roundTripFeePct(quantity: number, entry: number, exit: number, date: string): number {
  const notional = Math.abs(quantity * entry);
  if (notional <= 0) return 0;
  const fees = equityFees({ side: "buy", quantity, price: entry, date }).total + equityFees({ side: "sell", quantity, price: exit, date }).total;
  return (fees / notional) * 100;
}
