import { Type, type Static } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { countDayTrades, countSubmittedBuysToday, sevenDaysAgo, countsAsSubmitted } from "./engine.ts";
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
  currentCycleId: () => string | undefined;
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
    description: "Day orders die at the end of the trading day; gtc rests until the time stop.",
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
  evidence: Type.Array(Type.String({ minLength: 3, maxLength: 400 }), {
    description: "Citations to the tool outputs behind this idea: tool name, what it showed, and when. At least one.",
    minItems: 1,
    maxItems: 20,
  }),
});

type SubmitOrderArgs = Static<typeof submitOrderSchema>;

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
      "In approve mode a human must approve the pending order before anything is placed.",
    parameters: submitOrderSchema,
    async execute(args: SubmitOrderArgs) {
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
          evidence: args.evidence,
        },
        currentCycleId(),
      );
      const lines = [
        `order ${order.id}: ${order.status} (${order.intent.symbol} ${order.intent.side} ` +
          `${order.intent.quantity} @ ${order.intent.limitPrice})`,
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
      "today's used entry and day-trade budgets, and pending orders. Call it before proposing orders.",
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
      const pending = store.ordersSince(0).filter((o) => o.status === "pending_approval");
      const brokerState = broker.status();
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
      return {
        output: [{ type: "text", text: lines.join("\n") }],
        details: {
          mode: settings.mode,
          killSwitch: settings.killSwitch,
          halts: haltList,
          entriesUsed,
          dayTradesUsed,
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
