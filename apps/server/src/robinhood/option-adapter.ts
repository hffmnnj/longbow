import { type OrderRecord, type LongOptionTicket } from "@rh/shared";
import type { Clock, MarketCalendar, Store } from "../ports.ts";
import type { OrderGateDeps } from "../risk/gate.ts";
import { countSubmittedBuysToday } from "../risk/engine.ts";
import { BrokerMappingError, record, tradingAccount } from "./mapping.ts";
import { findStandardOption, optionPreviewTools } from "./option-preflight.ts";
import { prepareOptionPlacement } from "./option-order-transport.ts";
import { optionOrderRows, reconcileOptionOrder } from "./option-order-state.ts";

export const optionAdapterTools = [
  ...optionPreviewTools, "get_portfolio", "get_option_quotes", "get_option_orders",
  "get_option_positions", "place_option_order", "cancel_option_order",
] as const;
// Reserve the highest disclosed XSP contract fee, regulatory/clearing and exchange fees.
const XSP_FEE_RESERVE_CENTS = 65;
type Operation = (typeof optionAdapterTools)[number];
type Call = (name: Operation, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Exact nonnegative decimal to cents. Fractional cents may round down for cash, never for quotes. */
function money(value: unknown, floor = false): number {
  if (typeof value !== "string" && typeof value !== "number") throw new BrokerMappingError("Missing broker monetary amount");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!m || (!floor && /[1-9]/.test((m[2] ?? "").slice(2)))) throw new BrokerMappingError("Invalid broker monetary amount");
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new BrokerMappingError("Invalid broker monetary amount");
  return cents;
}

function units(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number" || !/^\d+(?:\.0+)?$/.test(String(value))) {
    throw new BrokerMappingError("Invalid broker contract count");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new BrokerMappingError("Invalid broker contract count");
  return n;
}

function parseQuote(data: Record<string, unknown>, id: string) {
  const quotes = Array.isArray(data.results)
    ? data.results.map(record).filter((row) => row.quote != null).map((row) => record(row.quote)).filter((q) => q.instrument_id === id)
    : [];
  if (quotes.length !== 1) throw new BrokerMappingError("Robinhood returned no unique option quote");
  const q = quotes[0]!;
  const at = typeof q.updated_at === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(q.updated_at) ? Date.parse(q.updated_at) : NaN;
  if (!Number.isFinite(at)) throw new BrokerMappingError("Robinhood option quote had no verified timestamp");
  return { instrumentId: id, at, bidCents: money(q.bid_price), askCents: money(q.ask_price),
    bidSize: units(q.bid_size), askSize: units(q.ask_size) };
}

function requireComplete(data: Record<string, unknown>, rows: string): Record<string, unknown>[] {
  if (!Array.isArray(data[rows]) || data.next != null && data.next !== "") {
    throw new BrokerMappingError(`Incomplete Robinhood ${rows} response`);
  }
  return data[rows].map(record);
}

function availableToClose(data: Record<string, unknown>, id: string): number {
  const positions = requireComplete(data, "positions");
  if (!positions.length) return 0;
  // Broker-reported sellable quantity is required: total quantity includes
  // pending closing orders. An unverified spelling must not unlock a sale.
  if (positions.length !== 1 || positions[0]!.option_id !== id || positions[0]!.type !== "long") {
    throw new BrokerMappingError("Robinhood returned no unique long option position");
  }
  const p = positions[0]!;
  return Math.min(units(p.quantity), units(p.quantity_available_for_sells));
}

function additionallyReservedBuyCents(orders: readonly OrderRecord[], fee: number): number {
  let reserved = 0;
  for (const order of orders) {
    const ticket = order.intent.longOption;
    if (!ticket || ticket.side !== "buy-to-open" || !["submitted", "triggering", "partially_filled"].includes(order.status)) continue;
    reserved += (ticket.limitCents * 100 + fee) * Math.max(0, ticket.contracts - (order.filledQuantity ?? 0));
  }
  if (!Number.isSafeInteger(reserved)) throw new BrokerMappingError("Invalid unsettled option premium");
  return reserved;
}

function xspEntryAvailable(orders: readonly OrderRecord[]): boolean {
  const net = new Map<string, number>();
  for (const order of [...orders].sort((a, b) => a.createdAt - b.createdAt)) {
    const ticket = order.intent.longOption;
    if (["triggering", "submitted", "partially_filled"].includes(order.status) &&
        (ticket || order.intent.side === "buy")) return false;
    if (ticket?.symbol !== "XSP") continue;
    const filled = order.filledQuantity ?? 0;
    if (!Number.isSafeInteger(filled) || filled < 0 || filled > ticket.contracts ||
        order.status === "filled" && filled !== ticket.contracts) return false;
    // A close of a broker-side position must not offset a later local entry.
    if (filled > 0) net.set(ticket.instrumentId, Math.max(0, (net.get(ticket.instrumentId) ?? 0) +
      filled * (ticket.side === "buy-to-open" ? 1 : -1)));
  }
  // An expiry or a broker-side action can remove a position from the inventory
  // without telling us what it settled for. That is not proof of a closed lot.
  return [...net.values()].every((quantity) => quantity === 0);
}

export function createRobinhoodOptionAdapter(deps: {
  call: Call; clock: Clock; calendar: MarketCalendar;
  store: Pick<Store, "equityMarks" | "getSettings">;
  /** Conservative ceiling obtained from a verified broker fee schedule. */
  feeReservePerContractCents: number;
  /** Only a broker-verified policy for this exact account and contract may return true. */
  exerciseRiskControlled?: (ticket: LongOptionTicket, account: Readonly<Record<string, unknown>>) => Promise<boolean>;
  /** Used only after verifying XSP on the dedicated account. */
  allowXspOpen?: boolean;
}): NonNullable<OrderGateDeps["options"]> {
  const { call, clock, calendar, store, feeReservePerContractCents } = deps;
  async function account(requireEntitlement = false) {
    const result = tradingAccount(await call("get_accounts", {}));
    if (requireEntitlement && !["option_level_2", "option_level_3"].includes(String(result.account.option_level))) {
      throw new BrokerMappingError("Dedicated MCP account is not approved for calls or puts");
    }
    return result;
  }
  const session = () => ({ date: calendar.etDate(clock.now()), isOpen: calendar.clock(clock.now()).isOpen });
  return {
    async facts(input, orders) {
      const { ticket, settlement } = await findStandardOption(input, call);
      const { account: details, accountId } = await account(true);
      const fee = units(settlement === "xsp-cash" ? XSP_FEE_RESERVE_CENTS : feeReservePerContractCents);
      const buy = ticket.side === "buy-to-open";
      const verifyXspCapacity = buy && deps.allowXspOpen === true && settlement === "xsp-cash" && ticket.contracts === 1;
      const [prices, value, positions, exerciseRiskControlled, working] = await Promise.all([
        call("get_option_quotes", { instrument_ids: [ticket.instrumentId] }),
        buy ? call("get_portfolio", { account_number: accountId }) : undefined,
        verifyXspCapacity ? call("get_option_positions", { account_number: accountId, nonzero: true })
          : buy ? undefined : call("get_option_positions", { account_number: accountId, option_ids: ticket.instrumentId, type: "long", nonzero: true }),
        buy && !verifyXspCapacity ? deps.exerciseRiskControlled?.(ticket, details) ?? false : false,
        verifyXspCapacity ? call("get_option_orders", { account_number: accountId, state_group: "open" }) : undefined,
      ]);
      const now = clock.now();
      const date = calendar.etDate(now);
      const expiry = calendar.clock(Date.parse(`${ticket.expiration}T17:00:00Z`));
      if (expiry.tradingDay !== ticket.expiration || !expiry.isOpen) throw new BrokerMappingError("Could not verify the option expiry session");
      const equityCents = value ? money(value.total_value, true) : 0;
      const settings = store.getSettings();
      const marks = store.equityMarks(date);
      const entryHalted = value !== undefined && (
        marks.dayStart !== undefined && equityCents <= 100 * marks.dayStart * (1 - settings.risk.dailyLossHaltPct / 100) ||
        marks.monthPeak !== undefined && equityCents <= 100 * marks.monthPeak * (1 - settings.risk.monthlyDrawdownHaltPct / 100));
      // Keep cash-backed entries bounded by the stricter value. Portfolio
      // buying_power alone may include leverage, deposits, or unsettled sales.
      const cashCents = value ? Math.min(
        money(record(value.buying_power).unleveraged_buying_power, true),
        money(value.cash, true) - money(value.pending_deposits, true) - money(details.unsettled_funds, true),
      ) : 0;
      const xspCapacity = verifyXspCapacity && requireComplete(positions!, "positions").length === 0 &&
        requireComplete(working!, "orders").length === 0 &&
        xspEntryAvailable(orders);
      return { quote: parseQuote(prices, ticket.instrumentId), equityCents, accountPin: accountId,
        settledUnreservedCashCents: Math.max(0, cashCents - additionallyReservedBuyCents(orders, fee)),
        sellableContracts: !buy && positions ? availableToClose(positions, ticket.instrumentId) : 0,
        expirySession: expiry.tradingDay,
        sessionsUntilExpiry: ticket.expiration === date ? 0 : calendar.tradingDaysBetween(date, ticket.expiration) + 1,
        feeReservePerContractCents: fee,
        entriesUsed: countSubmittedBuysToday(orders, date), entryHalted,
        ...(verifyXspCapacity ? { xspCapacity } : {}),
        exerciseRiskControlled: exerciseRiskControlled === true || verifyXspCapacity };
    },
    review(ticket, accountPin) {
      return prepareOptionPlacement(ticket, call, session, accountPin);
    },
    async reconcile(order) {
      const { accountId } = await account();
      const filter = order.brokerOrderId
        ? { order_id: order.brokerOrderId }
        : { agent_initiated: true, created_at_gte: new Date(order.createdAt - 60_000).toISOString() };
      const data = await call("get_option_orders", { account_number: accountId, ...filter });
      return reconcileOptionOrder(order, accountId, optionOrderRows(data));
    },
    async cancel(order) {
      if (!order.intent.longOption || !order.brokerOrderId) throw new BrokerMappingError("Options cancel needs an identified broker order");
      const { accountId } = await account();
      const data = await call("get_option_orders", { account_number: accountId, order_id: order.brokerOrderId });
      const state = reconcileOptionOrder(order, accountId, optionOrderRows(data));
      if (!state || !["submitted", "partially_filled"].includes(state.status)) return;
      await call("cancel_option_order", { account_number: accountId, order_id: order.brokerOrderId });
    },
  };
}
