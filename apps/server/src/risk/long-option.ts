import { type LongOptionTicket, type MarketClock, type RiskVerdict, type Settings } from "@rh/shared";
import { optionContractMultiplier } from "../robinhood/option-order-mapping.ts";

type OptionQuote = {
  instrumentId: string;
  at: number;
  bidCents: number;
  askCents: number;
  bidSize: number;
  askSize: number;
};

/** Facts come from the broker and durable gate, never from a model ticket. */
export interface LongOptionRiskInputs {
  market: MarketClock;
  settings: Settings;
  quote: OptionQuote;
  equityCents: number;
  settledUnreservedCashCents: number;
  sellableContracts: number;
  expirySession: string;
  sessionsUntilExpiry: number;
  feeReservePerContractCents: number;
  entriesUsed: number;
  entryHalted: boolean;
  /** True only when exercise consequences can be enforced and reconciled by the gate. */
  exerciseRiskControlled: boolean;
}

const whole = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
const MAX_QUOTE_AGE_MS = 120_000;
const MIN_ENTRY_SESSIONS_TO_EXPIRY = 5;

export function evaluateLongOption(ticket: LongOptionTicket, facts: LongOptionRiskInputs): RiskVerdict {
  const { market, settings, quote } = facts;
  const isExit = ticket.side === "sell-to-close";
  const checks: RiskVerdict["checks"] = [];
  const check = (rule: string, ok: boolean, detail: string) => checks.push({ rule, ok, detail });
  check("options_mode", settings.mode !== "off" && !settings.killSwitch, "Mode must permit orders and kill switch must be off.");
  check("options_hours", market.isOpen && market.session === "regular" && market.now >= market.nextOpen && market.now < market.nextClose,
    "Options orders require the current regular equity session.");
  const quoteOk = quote.instrumentId === ticket.instrumentId && quote.at >= market.nextOpen && quote.at <= market.now &&
    market.now - quote.at <= MAX_QUOTE_AGE_MS && whole(quote.bidCents) && quote.bidCents > 0 &&
    whole(quote.askCents) && quote.askCents >= quote.bidCents &&
    whole(quote.bidSize) && whole(quote.askSize) && quote.bidSize > 0 && quote.askSize > 0;
  check("options_quote", quoteOk, "Exact contract needs a positive, uncrossed regular-session bid/ask and displayed size within two minutes.");
  check("options_expiry", facts.expirySession === ticket.expiration &&
    whole(facts.sessionsUntilExpiry) && (isExit || facts.sessionsUntilExpiry >= MIN_ENTRY_SESSIONS_TO_EXPIRY),
    "Opening requires at least five regular sessions before the verified expiry. A close may reduce exposure on expiry day.");

  if (isExit) {
    check("options_sellable", whole(facts.sellableContracts) && ticket.contracts <= facts.sellableContracts,
      "Contracts available to close must exclude live orders and unresolved attempts.");
    return { isExit, approved: checks.every((c) => c.ok), checks };
  }

  const risk = settings.risk;
  const legPremium = ticket.limitCents * optionContractMultiplier;
  const fee = facts.feeReservePerContractCents;
  const maxRiskCents = Math.floor(facts.equityCents * (risk.maxRiskPerTradePct / 100));
  const maxNotionalCents = Math.floor(risk.maxOrderNotionalUsd * 100);
  const costPerContract = legPremium + fee;
  const cashAndFeeKnown = whole(facts.settledUnreservedCashCents) && whole(facts.equityCents) && facts.equityCents > 0 &&
    whole(fee) && whole(costPerContract) && costPerContract > 0;
  const maxQuantity = cashAndFeeKnown
    ? Math.floor(Math.min(facts.settledUnreservedCashCents, maxRiskCents, maxNotionalCents) / costPerContract)
    : 0;
  check("options_premium_at_risk", cashAndFeeKnown && maxQuantity >= ticket.contracts,
    "One or more whole contracts must fit settled unreserved cash, order notional and loss limits at the full premium plus fees.");
  check("options_exercise", facts.exerciseRiskControlled, "An unfilled exit cannot guarantee that the broker will not exercise the option.");
  check("options_entry_halt", !facts.entryHalted && !settings.drawdownHalted, "Entry halts must be clear.");
  check("options_entry_budget", whole(facts.entriesUsed) && facts.entriesUsed < risk.maxEntriesPerDay,
    "Options entries share the existing daily entry budget.");
  check("options_entry_session", market.now >= market.nextOpen + risk.noTradeOpenMinutes * 60_000 &&
    market.now < market.nextClose - risk.noTradeCloseMinutes * 60_000, "Existing entry time buffers apply.");
  const spreadBps = (quote.askCents - quote.bidCents) * 20_000 / (quote.askCents + quote.bidCents);
  check("options_entry_spread", quoteOk && spreadBps <= risk.maxSpreadBps,
    "The quoted option spread must fit the existing configured risk limit.");
  check("options_entry_limit", quoteOk && ticket.limitCents <= quote.askCents && ticket.contracts <= quote.askSize,
    "An opening limit must not exceed the verified ask; displayed ask size must cover this count.");
  return { isExit, approved: checks.every((c) => c.ok), checks, maxQuantity };
}
