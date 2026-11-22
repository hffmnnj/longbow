import { record } from "./mapping.ts";

export const optionResearchTools = ["get_option_instruments", "get_option_quotes"] as const;
type ResearchTool = (typeof optionResearchTools)[number];
type Read = (tool: ResearchTool, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
export type OptionResearchClock = { now: number; date: string; isOpen: boolean; sessionOpen: number };
export const MAX_PUTS = 4;
const FRESH_MS = 2 * 60_000;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function payload(value: unknown, field: string): Record<string, unknown>[] {
  const envelope = record(value);
  const rows = record(envelope.data ?? envelope)[field];
  if (!Array.isArray(rows)) throw new Error("Unexpected Robinhood options response");
  return rows.map(record);
}
function number(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function date(value: string): boolean {
  const at = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

export async function compareRobinhoodPuts(input: { symbol: string; expiration: string; strikes: number[] },
  read: Read, clock: () => OptionResearchClock, signal?: AbortSignal) {
  const { symbol, expiration, strikes } = input;
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || !date(expiration) || expiration < clock().date ||
      strikes.length < 1 || strikes.length > MAX_PUTS || new Set(strikes).size !== strikes.length ||
      strikes.some((strike) => !Number.isFinite(strike) || strike <= 0 || strike > 100_000 || +strike.toFixed(4) !== strike)) {
    throw new Error("Use one symbol, a current or future expiration, and one to four distinct positive strikes.");
  }
  const contracts = await Promise.all(strikes.map(async (strike) => {
    signal?.throwIfAborted();
    const rows = payload(await read("get_option_instruments", {
      chain_symbol: symbol, expiration_dates: expiration, strike_price: strike.toFixed(4), type: "put", state: "active",
    }, signal), "instruments");
    const matches = rows.filter((row) => row.chain_symbol === symbol && row.expiration_date === expiration &&
      row.type === "put" && row.state === "active" && row.tradability === "tradable" &&
      number(row.strike_price) === strike);
    const option = matches.length === 1 ? matches[0] : undefined;
    if (typeof option?.id !== "string" || !uuid.test(option.id)) return { strike, reason: "contract-unavailable-or-ambiguous" } as const;
    if (number(option.trade_value_multiplier) !== 100) return { strike, reason: "nonstandard-multiplier" } as const;
    return { strike, instrumentId: option.id } as const;
  }));
  const ids = contracts.flatMap(({ instrumentId }) => instrumentId === undefined ? [] : [instrumentId]);
  signal?.throwIfAborted();
  const rows = ids.length === 0 ? [] : payload(await read("get_option_quotes", { instrument_ids: ids }, signal), "results");
  const quotes = rows.flatMap((row) => row.quote == null ? [] : [record(row.quote)]);
  const { now, isOpen, sessionOpen } = clock();
  return {
    symbol, expiration, source: "Robinhood", purpose: "research-only",
    contracts: contracts.map((contract) => {
      if (!contract.instrumentId) return contract;
      const matches = quotes.filter((q) => q.instrument_id === contract.instrumentId);
      const quote = matches.length === 1 ? matches[0] : undefined;
      const bid = number(quote?.bid_price), ask = number(quote?.ask_price);
      const bidSize = number(quote?.bid_size), askSize = number(quote?.ask_size);
      const updatedAt = typeof quote?.updated_at === "string" ? Date.parse(quote.updated_at) : NaN;
      const usable = bid !== null && ask !== null && bid > 0 && ask >= bid &&
        bidSize !== null && Number.isInteger(bidSize) && bidSize > 0 &&
        askSize !== null && Number.isInteger(askSize) && askSize > 0;
      const status = !usable ? "incomplete" : !isOpen ? "outside-regular-session" :
        !Number.isFinite(updatedAt) || updatedAt < sessionOpen || updatedAt > now || now - updatedAt > FRESH_MS ? "stale-or-unverified" : "recent";
      return { ...contract, status,
        quoteTime: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : null,
        bidPerShareUsd: bid, askPerShareUsd: ask, bidSize, askSize,
        ...(usable ? {
          estimatedPremiumPerContractUsd: +(ask * 100).toFixed(2),
          spreadPerContractUsd: +((ask - bid) * 100).toFixed(2),
          breakEvenAtExpirationUsd: +(contract.strike - ask).toFixed(4),
        } : {}),
      };
    }),
    limits: "Informational only; quote and displayed size are not a fill guarantee. Premium and break-even exclude fees.",
  };
}
