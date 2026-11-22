import { BrokerMappingError, record, tradingAccount } from "./mapping.ts";

export const optionReadinessTools = ["get_accounts", "get_trade_approval_setting"] as const;
export const optionPreviewTools = ["get_accounts", "get_option_instruments", "get_option_chains", "review_option_order"] as const;
type PreflightRead = (typeof optionReadinessTools)[number] | (typeof optionPreviewTools)[number];
type Call = (name: PreflightRead, args: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type OptionPreview = {
  instrumentId: string;
  symbol: string;
  expiration: string;
  strikeCents: number;
  contractType: "call" | "put";
  side: "buy-to-open" | "sell-to-close";
  contracts: number;
  limitCents: number;
};

async function accountOptions(call: Call, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { account, accountId } = tradingAccount(await call("get_accounts", {}, signal));
  const level = account.option_level;
  const entitlement = level === "option_level_2" ? "level-2" :
    level === "option_level_3" ? "level-3" :
      level === "" || level === null || level === "option_level_0" || level === "option_level_1" ? "not-approved" : "unknown";
  return { accountId, entitlement } as const;
}

export async function getOptionReadiness(call: Call, signal?: AbortSignal) {
  const { accountId, entitlement } = await accountOptions(call, signal);
  signal?.throwIfAborted();
  const { setting } = await call("get_trade_approval_setting", { account_number: accountId }, signal);
  const status = record(setting);
  if (status.account_number !== accountId || typeof status.human_must_approve_trades !== "boolean") {
    throw new BrokerMappingError("Robinhood returned no matching trade approval setting");
  }
  return {
    optionsEntitlement: entitlement,
    approvalRequiredAtRobinhood: status.human_must_approve_trades,
    longbowExecution: "unavailable",
    nextStep: entitlement === "not-approved" ? "The owner can apply for options access on the dedicated MCP account in the Robinhood app." :
      entitlement === "unknown" ? "Robinhood did not return a recognized options level. Verify the options level in the app." :
        "Longbow can preview orders but cannot send live options orders.",
  } as const;
}

/** Build one standard long contract order. This module has no API capable of placing an order. */
export async function previewLongOption(input: OptionPreview, call: Call, session: () => { date: string; isOpen: boolean }, signal?: AbortSignal) {
  const { instrumentId, symbol, expiration, strikeCents, contractType, side, contracts, limitCents } = input;
  const expiry = Date.parse(`${expiration}T00:00:00Z`);
  if (!idPattern.test(instrumentId) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) ||
      !/^\d{4}-\d\d-\d\d$/.test(expiration) || !Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0, 10) !== expiration ||
      (contractType !== "call" && contractType !== "put") || (side !== "buy-to-open" && side !== "sell-to-close") ||
      !Number.isInteger(contracts) || contracts < 1 || contracts > 100 ||
      !Number.isInteger(limitCents) || limitCents < 1 || limitCents > 1_000_000 ||
      !Number.isInteger(strikeCents) || strikeCents < 1 || strikeCents > 10_000_000) {
    throw new BrokerMappingError("Use a single exact option contract and a positive whole-contract quantity and limit.");
  }
  const { date, isOpen } = session();
  if (!isOpen || expiration <= date) throw new BrokerMappingError("Previews require regular market hours and an expiration after today.");
  const { accountId, entitlement } = await accountOptions(call, signal);
  if (entitlement !== "level-2" && entitlement !== "level-3") {
    throw new BrokerMappingError("The dedicated Robinhood MCP account does not report Level 2 or Level 3 options approval.");
  }
  signal?.throwIfAborted();
  const { instruments } = await call("get_option_instruments", { ids: instrumentId, state: "active" }, signal);
  const option = Array.isArray(instruments) && instruments.length === 1 ? record(instruments[0]) : {};
  if (option.id !== instrumentId || option.chain_symbol !== symbol || option.expiration_date !== expiration ||
      option.type !== contractType || Number(option.strike_price) !== strikeCents / 100 ||
      Number(option.trade_value_multiplier) !== 100 || option.state !== "active" || option.tradability !== "tradable" ||
      option.underlying_type !== "equity" || typeof option.chain_id !== "string" || !idPattern.test(option.chain_id)) {
    throw new BrokerMappingError("Robinhood did not confirm the exact standard equity option.");
  }
  signal?.throwIfAborted();
  const { chains } = await call("get_option_chains", { ids: option.chain_id }, signal);
  const chain = Array.isArray(chains) && chains.length === 1 ? record(chains[0]) : {};
  if (chain.id !== option.chain_id || chain.symbol !== symbol || Number(chain.trade_value_multiplier) !== 100 ||
      chain.cash_component !== null || !Array.isArray(chain.underlying_instruments) || chain.underlying_instruments.length !== 1 ||
      (side === "buy-to-open" && chain.can_open_position !== true)) {
    throw new BrokerMappingError("Robinhood did not confirm an eligible 100-multiplier chain with one underlying and no cash deliverable.");
  }
  const atReview = session();
  if (!atReview.isOpen || atReview.date !== date || expiration <= atReview.date) {
    throw new BrokerMappingError("The trading session changed while preparing the preview.");
  }
  const buy = side === "buy-to-open";
  signal?.throwIfAborted();
  const result = await call("review_option_order", {
    account_number: accountId,
    legs: [{ option_id: instrumentId, side: buy ? "buy" : "sell", position_effect: buy ? "open" : "close", ratio_quantity: 1 }],
    type: "limit", quantity: String(contracts), price: (limitCents / 100).toFixed(2),
    time_in_force: "gfd", market_hours: "regular_hours",
  }, signal);
  if (!Array.isArray(result.order_checks) || typeof result.customer_approval_required !== "boolean") {
    throw new BrokerMappingError("Broker preview did not confirm approval and alert status; nothing was submitted.");
  }
  return {
    instrumentId, symbol, expiration, strikeCents, contractType, side, contracts, limitCents,
    kind: "preview-only", maxPremiumOrLimitProceedsCents: limitCents * 100 * contracts,
    premiumExcludesFees: true, robinhoodApprovalRequired: result.customer_approval_required,
    preTradeAlertCount: result.order_checks.length,
    // Remote messages can contain sensitive details or text that looks like instructions.
    nextStep: result.order_checks.length === 0 ? "This was a broker preview only; no order was submitted." :
      "Robinhood reported pre-trade alerts. Review them in the Robinhood app; nothing was submitted.",
  } as const;
}
