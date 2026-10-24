import { Type, type Static } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { countDayTrades, countSubmittedBuysToday, sevenDaysAgo } from "./engine.ts";
import type { Broker, Clock, MarketCalendar, OrderGate, Store } from "../ports.ts";

/**
 * The model's only route to orders. `submit_order` runs the full risk gate
 * (it is not replay-safe: interrupted calls are never retried automatically).
 * `get_risk_state` is a read-only summary and is replay-safe.
 */

export interface RiskToolsDeps {
  gate: OrderGate;
  store: Store;
  calendar: MarketCalendar;
  clock: Clock;
  broker: Broker;
  currentCycleId: () => string | undefined;
}

const submitOrderSchema = Type.Object({
  symbol: Type.String({
    description: "Uppercase ticker to trade, such as AAPL. No options, crypto, or multi-leg orders.",
    pattern: "^[A-Z.]{1,10}$",
    minLength: 1,
    maxLength: 10,
  }),
  side: Type.Union([Type.Literal("buy"), Type.Literal("sell")], {
    description: "Buy to open a long, or sell shares you already hold. Shorting is never allowed.",
  }),
  quantity: Type.Number({
    description: "Number of shares, fractional to 4 decimal places (for example 3.7894). Must fit the per-trade risk, position, and notional caps.",
    exclusiveMinimum: 0,
  }),
  orderType: Type.Union([Type.Literal("limit"), Type.Literal("stop_limit")], {
    description: "Limit orders rest at limitPrice. Stop-limit orders also need stopPrice.",
  }),
  limitPrice: Type.Number({
    description: "Limit price in USD. Must sit within maxSlippageBps of the mid price.",
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
        lines.push("the order failed to submit to Robinhood; nothing was placed.");
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
      const recent = store.ordersSince(sevenDaysAgo(now)).filter((o) => o.status === "submitted");
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

  return defineExtension({ name: "risk", tools: [submitOrder, getRiskState] });
}
