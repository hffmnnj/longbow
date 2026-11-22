import { Type, type Static } from "typebox";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { LongOptionTicketSchema, type AccountSnapshot } from "@rh/shared";
import { countDayTrades, countSubmittedBuysToday, sevenDaysAgo, countsAsSubmitted } from "./engine.ts";
import { recordedEntryReviews } from "./review-dates.ts";
import type { Broker, Clock, MarketCalendar, OrderGate, Store } from "../ports.ts";

/**
 * The model's only route to orders. `submit_order` runs the full risk gate
 * (it is not replay-safe: interrupted calls are never retried automatically).
 * `get_risk_state` is a read-only summary and is replay-safe.
 */

export interface RiskToolsDeps {
  gate: OrderGate;
  cancelOrder?: (id: string) => Promise<import("@rh/shared").OrderRecord>;
  store: Store;
  calendar: MarketCalendar;
  clock: Clock;
  broker: Broker;
  getAccount?: () => AccountSnapshot | null;
  currentCycleId: () => string | undefined;
  /** When a real option gate is not wired, keep this absent, including in ordinary paper simulations. */
  optionTickets?: true | "close-only";
}

const submitOrderSchema = Type.Object({
  symbol: Type.String({
    description: "Uppercase ticker to trade, such as AAPL, or a crypto pair from the crypto sleeve, such as BTC-USD (load the crypto-sleeve skill first). No options or multi-leg orders.",
    pattern: "^([A-Z.]{1,10}|[A-Z]{2,10}-USD)$",
    minLength: 1,
    maxLength: 14,
  }),
  side: Type.Union([Type.Literal("buy"), Type.Literal("sell")], {
    description: "Buy to open a long, or sell shares you already hold. Shorting is never allowed.",
  }),
  quantity: Type.Number({
    description: "Number of shares, fractional to 4 decimal places (for example 3.7894), or coins for a crypto pair, to 8 decimals (for example 0.0005). Entries must fit the per-trade risk, position, and notional caps. A reducing sell, including a protective stop, is exempt from those entry caps but cannot exceed the held quantity; all other applicable gate checks still apply.",
    exclusiveMinimum: 0,
  }),
  orderType: Type.Union([Type.Literal("limit"), Type.Literal("stop_limit")], {
    description: "Whole-share limits rest at limitPrice. Fractional equity limits do not rest: they execute as market orders only when the fresh ask is at or below a buy ceiling, or the fresh bid is at or above a sell floor, during regular hours. Market execution does not guarantee the limit price. Fractional sell stops are held and watched every minute by the harness. Crypto limits and stop_limit sells rest natively at Robinhood (limits last 90 days) and trade around the clock.",
  }),
  limitPrice: Type.Number({
    description: "Limit price in USD. Must satisfy the applicable maxSlippageBps rule. For a fractional equity limit, deliberately choose a buy ceiling covering the fresh ask or a sell floor at or below the fresh bid only if acceptable after spread, slippage, costs and sizing, within owner constraints and engine limits. Any buffer must be in the original intent; market execution does not guarantee the limit price.",
    exclusiveMinimum: 0,
  }),
  stopPrice: Type.Optional(
    Type.Number({
      description: "Trigger price in USD. Required for stop_limit. Buys stop at or above the current price, sells at or below it.",
      exclusiveMinimum: 0,
    }),
  ),
  timeInForce: Type.Union([Type.Literal("day"), Type.Literal("gtc")], {
    description: "Day orders expire at the end of the trading day. A GTC order remains active until filled, cancelled or expired; the thesis review date does not cancel it.",
  }),
  invalidationPrice: Type.Number({
    description: "Price at which the thesis is wrong. Below the limit for buys, above it for sells. Sizes the trade's risk.",
    exclusiveMinimum: 0,
  }),
  timeStopDate: Type.String({
    description: "ET date (YYYY-MM-DD) by which the thesis must have worked. After today, within 60 days.",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  }),
  thesis: Type.String({
    description: "Why this trade should work, in your own words. At least a full sentence or two.",
    minLength: 20,
    maxLength: 2000,
  }),
  probabilityWin: Type.Number({
    description: "Your probability (0 to 1) that the trade reaches its target before invalidation.",
    minimum: 0,
    maximum: 1,
  }),
  expectedGainPct: Type.Number({
    description: "Expected gain to target in percent, a positive number such as 8 for 8%.",
    minimum: 0,
  }),
  expectedLossPct: Type.Number({
    description: "Expected loss to invalidation in percent, a positive number such as 4 for 4%.",
    minimum: 0,
  }),
  estimatedCostPct: Type.Number({
    description: "Estimated round-trip costs (spread, slippage, fees) in percent. Must cover the current spread.",
    minimum: 0,
  }),
  sector: Type.Optional(
    Type.String({
      description: "Sector of the company, such as Technology. Used for the sector cap when the broker does not label it.",
      maxLength: 60,
    }),
  ),
  ownerInstruction: Type.Optional(Type.String({
    description: "Only for a trade explicitly ordered by the owner: quote the owner's own chat words verbatim. This routes the order to human approval, not automatic execution. Misuse is a scored integrity failure.",
    minLength: 3,
    maxLength: 500,
  })),
  evidence: Type.Array(Type.String({ minLength: 3, maxLength: 400 }), {
    description: "Citations to the tool outputs behind this idea: tool name, what it showed, and when. At least one.",
    minItems: 1,
    maxItems: 20,
  }),
});

const optionTicket = Type.Object({
  instrumentId: Type.String({ format: "uuid" }),
  symbol: Type.String({ pattern: "^[A-Z][A-Z0-9.]{0,9}$" }),
  expiration: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  strikeCents: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
  contractType: Type.Union([Type.Literal("call"), Type.Literal("put")]),
  side: Type.Union([Type.Literal("buy-to-open"), Type.Literal("sell-to-close")]),
  contracts: Type.Integer({ minimum: 1, maximum: 100 }),
  limitCents: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
}, { additionalProperties: false, description: "One standard contract identity. Limit is integer cents per underlying share; always waits for owner approval." });
const submitWithOptionSchema = Type.Object({ ...submitOrderSchema.properties, longOption: Type.Optional(optionTicket) });
const closeTicket = Type.Object({ ...optionTicket.properties, side: Type.Literal("sell-to-close") }, { additionalProperties: false });
type SubmitOrderArgs = Static<typeof submitWithOptionSchema>;

const etClockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatEt(instant: number): string {
  return etClockFormat.format(new Date(instant));
}

export function createRiskExtension(deps: RiskToolsDeps): Extension {
  const { gate, store, calendar, clock, broker, currentCycleId } = deps;

  /** Current trading mode; undefined when the store cannot answer (tests). */
  function readMode(): string | undefined {
    try {
      return store.getSettings().mode;
    } catch {
      return undefined;
    }
  }

  const submitOrder = defineTool({
    name: "submit_order",
    description:
      "Propose an order to the deterministic risk gate. It validates the intent, checks every risk rule, " +
      "and either rejects it, holds it for approval in approve mode, or submits it to the broker in auto mode. " +
      "In approve mode a human must approve the pending order before anything is placed. " +
      "Owner-instruction orders always require human approval, including in auto mode." +
      (deps.optionTickets === "close-only" ? " Options are sell-to-close only, for existing long contracts. Include the owner's verbatim request in ownerInstruction. The owner must still approve."
        : deps.optionTickets ? " A standard single-leg options ticket always requires owner approval; no spreads or short positions." : ""),
    parameters: deps.optionTickets
      ? Type.Object({
        ...submitWithOptionSchema.properties,
        ...(deps.optionTickets === "close-only" ? { longOption: Type.Optional(closeTicket) } : {}),
        symbol: Type.String({ ...submitOrderSchema.properties.symbol, description: "Underlying ticker for an options ticket; otherwise the existing equity symbol or crypto pair." }),
        quantity: Type.Number({ exclusiveMinimum: 0, description: "Shares or coins. With longOption, must equal its whole contract count." }),
        limitPrice: Type.Number({ exclusiveMinimum: 0, description: "USD per share. With longOption, must equal limitCents / 100; full premium is 100 shares per contract." }),
      })
      : submitOrderSchema,
    async execute(args: SubmitOrderArgs) {
      // Refuse an unsupported ticket even if a caller bypassed tool-schema validation.
      // Never strip the option and accidentally route the same ticker as shares.
      const option = args.longOption === undefined ? undefined : LongOptionTicketSchema.safeParse(args.longOption);
      if (option && (!deps.optionTickets || !option.success)) {
        return { isError: true, output: [{ type: "text", text: "Option ticket unavailable or invalid; nothing was proposed." }] };
      }
      if (option?.success && deps.optionTickets === "close-only" && option.data.side !== "sell-to-close") {
        return { isError: true, output: [{ type: "text", text: "Option opening orders are disabled. Nothing was proposed." }] };
      }
      const order = await gate.submit(
        {
          symbol: args.symbol,
          side: args.side,
          quantity: args.quantity,
          orderType: args.orderType,
          limitPrice: args.limitPrice,
          ...(args.stopPrice === undefined ? {} : { stopPrice: args.stopPrice }),
          timeInForce: args.timeInForce,
          invalidationPrice: args.invalidationPrice,
          timeStopDate: args.timeStopDate,
          thesis: args.thesis,
          probabilityWin: args.probabilityWin,
          expectedGainPct: args.expectedGainPct,
          expectedLossPct: args.expectedLossPct,
          estimatedCostPct: args.estimatedCostPct,
          ...(args.sector === undefined ? {} : { sector: args.sector }),
          ...(args.ownerInstruction === undefined ? {} : { ownerInstruction: args.ownerInstruction }),
          ...(option?.success ? { longOption: option.data } : {}),
          evidence: args.evidence,
        },
        currentCycleId(),
      );
      const lines = [
        order.intent.longOption
          ? `order ${order.id}: ${order.status} (${order.intent.symbol} ${order.intent.longOption.expiration} ${order.intent.longOption.strikeCents / 100} ${order.intent.longOption.contractType} ${order.intent.longOption.side} ${order.intent.longOption.contracts} contract(s) @ ${order.intent.limitPrice} USD/share)`
          : `order ${order.id}: ${order.status} (${order.intent.symbol} ${order.intent.side} ${order.intent.quantity} @ ${order.intent.limitPrice})`,
      ];
      for (const check of order.verdict.checks.filter((c) => !c.ok)) {
        lines.push(`FAIL ${check.rule}: ${check.detail}`);
      }
      if (order.verdict.maxQuantity !== undefined) {
        lines.push(`max quantity allowed by the sizing rules: ${order.verdict.maxQuantity}`);
      }
      const autoMode = readMode() === "auto";
      if (order.status === "pending_approval") {
        lines.push("note: a human must approve this order before it can be placed.");
      }
      if (order.status === "submitted" && autoMode) {
        lines.push(
          `submitted to Robinhood (broker order id: ${order.brokerOrderId ?? "unknown"}); ` +
            "confirm the fill with Robinhood's order tools.",
        );
      } else if (order.status === "submitted") {
        lines.push(`broker order id: ${order.brokerOrderId ?? "unknown"}`);
      }
      if (order.status === "failed" && autoMode) {
        lines.push("order submission failed; reconcile Robinhood orders before retrying an uncertain response.");
      }
      if (order.error !== undefined) {
        lines.push(`error: ${order.error}`);
      }
      return {
        output: [{ type: "text", text: lines.join("\n") }],
        details: { orderId: order.id, status: order.status },
      };
    },
  });

  const getRiskState = defineTool({
    name: "get_risk_state",
    description:
      "Read the current risk posture: mode, kill switch, active halts, risk limits, market clock, " +
      "today's used entry and day-trade budgets, pending orders, and original review dates for reconciled holdings when known. Call it before proposing orders.",
    parameters: Type.Object({}),
    replay: "safe",
    async execute() {
      const now = clock.now();
      const settings = store.getSettings();
      const market = calendar.clock(now);
      const haltList = await gate.halts();
      const todayEt = calendar.etDate(now);
      const recent = store.ordersSince(sevenDaysAgo(now)).filter(countsAsSubmitted);
      const entriesUsed = countSubmittedBuysToday(recent, todayEt);
      const dayTradesUsed = countDayTrades(recent, todayEt, (a, b) =>
        calendar.tradingDaysBetween(a, b),
      );
      const orders = store.ordersSince(0);
      const pending = orders.filter((o) => o.status === "pending_approval");
      const brokerState = broker.status();
      const account = brokerState.state === "connected" ? deps.getAccount?.() : undefined;
      const reviews = account ? recordedEntryReviews(account.positions, orders, todayEt, account.at) : undefined;
      const lines = [
        `mode: ${settings.mode}, kill switch: ${settings.killSwitch ? "ENGAGED" : "off"}`,
        `halts: ${haltList.length === 0 ? "none" : haltList.join(", ")}`,
        `broker: ${brokerState.state}`,
        `market: ${market.session}${market.isOpen ? " (open)" : ""} ET ${todayEt}, ` +
          `trading day ${market.tradingDay}${market.earlyClose ? " (early close)" : ""}, ` +
          `next open ${formatEt(market.nextOpen)}, next close ${formatEt(market.nextClose)}`,
        `risk limits: ${JSON.stringify(settings.risk)}`,
        `crypto sleeve: ${JSON.stringify(settings.crypto)}`,
        `entries today: ${entriesUsed}/${settings.risk.maxEntriesPerDay}, ` +
          `day trades (5d): ${dayTradesUsed}/${settings.risk.maxDayTrades5d}`,
        pending.length === 0
          ? "pending orders: none"
          : `pending orders:\n${pending.map((o) => `- ${o.id} ${o.intent.symbol} ${o.intent.side} ${o.intent.quantity} @ ${o.intent.limitPrice} (${o.intent.orderType}/${o.intent.timeInForce}, since ${calendar.etDate(o.createdAt)})`).join("\n")}`,
      ];
      if (reviews !== undefined && account && reviews.length > 0) {
        lines.push(`Recorded entry review dates (holdings snapshot ${formatEt(account.at)} ET; original intent, not necessarily the current plan). Check current notes before acting:`);
        for (const review of reviews) {
          if (review.status === "owner") lines.push(`- ${review.symbol}: owner-directed; follow owner instructions.`);
          else if (review.status === "unverified") lines.push(`- ${review.symbol}: original review dates unavailable from reconciled local fills.`);
          else if (review.status === "recorded") lines.push(`- ${review.symbol}: ${review.dates.map((date) => `${date.date} (${date.state}, ${date.quantity} held)`).join(", ")}.`);
        }
      }
      return {
        output: [{ type: "text", text: lines.join("\n") }],
        details: {
          mode: settings.mode,
          killSwitch: settings.killSwitch,
          halts: haltList,
          entriesUsed,
          dayTradesUsed,
          ...(reviews === undefined ? {} : { recordedEntryReviews: reviews, holdingsSnapshotAt: account?.at }),
        },
      };
    },
  });

  const cancel = defineTool({ name: "cancel_order", description: "Cancel a harness-held stop locally or request cancellation of a submitted Robinhood order by our order id. Check the returned status; a broker cancellation may race a fill.", parameters: Type.Object({ orderId: Type.String({ minLength: 1 }) }), replay: "unsafe",
    async execute(args) {
      if (!deps.cancelOrder) throw new Error("Cancellation is unavailable for this broker");
      const order = await deps.cancelOrder(args.orderId);
      return { output: [{ type: "text", text: `order ${order.id}: ${order.status}` }] };
    },
  });
  return defineExtension({ name: "risk", tools: [submitOrder, getRiskState, cancel] });
}
