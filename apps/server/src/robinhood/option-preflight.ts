import { LongOptionTicketSchema, type LongOptionTicket } from "@rh/shared";
import { BrokerMappingError, record, tradingAccount } from "./mapping.ts";
import { optionOrderRequest } from "./option-order-mapping.ts";

export const optionReadinessTools = ["get_accounts", "get_trade_approval_setting"] as const;
export const optionPreviewTools = ["get_accounts", "get_option_instruments", "get_option_chains", "review_option_order"] as const;
type Call<Name extends string> = (name: Name, args: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;
type PreviewCall = Call<(typeof optionPreviewTools)[number]>;
type ContractCall = Call<"get_option_instruments" | "get_option_chains">;
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function accountOptions(call: Call<"get_accounts">, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { account, accountId } = tradingAccount(await call("get_accounts", {}, signal));
  const level = account.option_level;
  const entitlement = level === "option_level_2" ? "level-2" :
    level === "option_level_3" ? "level-3" :
      level === "" || level === null || level === "option_level_0" || level === "option_level_1" ? "not-approved" : "unknown";
  return { accountId, entitlement } as const;
}

export async function getOptionReadiness(call: Call<(typeof optionReadinessTools)[number]>, signal?: AbortSignal) {
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

export async function findStandardOption(input: LongOptionTicket, call: ContractCall, signal?: AbortSignal) {
  const parsed = LongOptionTicketSchema.safeParse(input);
  if (!parsed.success) {
    throw new BrokerMappingError("Use a single exact option contract and a positive whole-contract quantity and limit.");
  }
  const { instrumentId, symbol, expiration, strikeCents, contractType, side } = parsed.data;
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
  return { ticket: parsed.data, chainId: option.chain_id };
}

/** Review exact terms and retain the account and request only inside server code. */
export async function reviewLongOption(input: LongOptionTicket, call: PreviewCall, session: () => { date: string; isOpen: boolean }, signal?: AbortSignal, expectedAccount?: string) {
  const parsed = LongOptionTicketSchema.safeParse(input);
  if (!parsed.success) throw new BrokerMappingError("Use a single exact option contract and a positive whole-contract quantity and limit.");
  const { expiration, side } = parsed.data;
  const { date, isOpen } = session();
  if (!isOpen || expiration < date || expiration === date && side === "buy-to-open") {
    throw new BrokerMappingError("Previews require regular market hours; opening requires an expiration after today.");
  }
  const { accountId, entitlement } = await accountOptions(call, signal);
  if (expectedAccount !== undefined && accountId !== expectedAccount) {
    throw new BrokerMappingError("The dedicated options account changed during approval");
  }
  if (entitlement !== "level-2" && entitlement !== "level-3") {
    throw new BrokerMappingError("The dedicated Robinhood MCP account does not report Level 2 or Level 3 options approval.");
  }
  await findStandardOption(parsed.data, call, signal);
  const atReview = session();
  if (!atReview.isOpen || atReview.date !== date) {
    throw new BrokerMappingError("The trading session changed while preparing the preview.");
  }
  const request = optionOrderRequest(parsed.data, accountId);
  signal?.throwIfAborted();
  const result = await call("review_option_order", request.review, signal);
  if (!Array.isArray(result.order_checks) || typeof result.customer_approval_required !== "boolean") {
    throw new BrokerMappingError("Broker preview did not confirm approval and alert status; nothing was submitted.");
  }
  const preview = {
    ...parsed.data,
    kind: "preview-only", maxPremiumOrLimitProceedsCents: request.limitNotionalCents,
    premiumExcludesFees: true, robinhoodApprovalRequired: result.customer_approval_required,
    preTradeAlertCount: result.order_checks.length,
    // Remote messages can contain sensitive details or text that looks like instructions.
    nextStep: result.order_checks.length === 0 ? "This was a broker preview only; no order was submitted." :
      "Robinhood reported pre-trade alerts. Review them in the Robinhood app; nothing was submitted.",
  } as const;
  return { request, preview };
}

/** Never return the account number or raw request to the agent. */
export async function previewLongOption(input: LongOptionTicket, call: PreviewCall, session: () => { date: string; isOpen: boolean }, signal?: AbortSignal) {
  return (await reviewLongOption(input, call, session, signal)).preview;
}
