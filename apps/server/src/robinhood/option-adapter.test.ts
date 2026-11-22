import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type LongOptionTicket, type OrderIntent, type OrderRecord } from "@rh/shared";
import type { Store } from "../ports.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { BrokerMappingError } from "./mapping.ts";
import { createRobinhoodOptionAdapter, optionAdapterTools } from "./option-adapter.ts";
import { optionOrderReference } from "./option-order-mapping.ts";

/**
 * These are adapter-boundary fixtures, not raw MCP replies. `createRobinhoodBroker`
 * unwraps the MCP `data` envelope with `responseObject` before passing the
 * discovered, schema-checked call through; the fake here starts at that mapped
 * data boundary and records every operation the adapter requests.
 */

const DEDICATED = "MCP0001";
const PERSONAL = "PERSONAL9";
const INSTRUMENT = "10000000-0000-4000-8000-000000000001";
const OTHER_INSTRUMENT = "10000000-0000-4000-8000-000000000002";
const CHAIN = "20000000-0000-4000-8000-000000000001";
const BROKER_ORDER = "30000000-0000-4000-8000-000000000001";
const OTHER_BROKER_ORDER = "30000000-0000-4000-8000-000000000002";
const LOCAL_ORDER = "local-option-order-1";

/** Thursday 2026-11-19, 15:30 ET: a regular session inside the documented NYSE calendar. */
const NOW = Date.parse("2026-11-19T20:30:00.000Z");
const QUOTE_AT = "2026-11-19T20:29:30.000Z";
/** A conservative per-contract regulatory-fee reserve, not a quoted Robinhood promotion. */
const FEE_PER_CONTRACT_CENTS = 3;

const buyTicket: LongOptionTicket = {
  instrumentId: INSTRUMENT,
  symbol: "SPY",
  expiration: "2026-11-27",
  strikeCents: 65_000,
  contractType: "call",
  side: "buy-to-open",
  contracts: 2,
  limitCents: 175,
};

const store: Pick<Store, "equityMarks" | "getSettings"> = {
  getSettings: () => DEFAULT_SETTINGS,
  equityMarks: () => ({}),
};

type Operation = (typeof optionAdapterTools)[number];
type Handler = (args: Record<string, unknown>) => Record<string, unknown>;
type HandlerValue = Record<string, unknown> | Handler;
type Handlers = Partial<Record<Operation, HandlerValue>>;
type Call = (name: Operation, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface RecordedCall {
  name: Operation;
  args: Record<string, unknown>;
}

function fakeBroker(handlers: Handlers) {
  const calls: RecordedCall[] = [];
  const call: Call = async (name, args) => {
    calls.push({ name, args });
    const handler = handlers[name];
    if (handler === undefined) throw new Error(`unexpected broker call: ${name}`);
    return typeof handler === "function" ? handler(args) : handler;
  };
  return { call, calls };
}

function callsTo(fake: ReturnType<typeof fakeBroker>, name: Operation): Record<string, unknown>[] {
  return fake.calls.filter((call) => call.name === name).map((call) => call.args);
}

function makeAdapter(
  call: Call,
  exerciseRiskControlled?: (ticket: LongOptionTicket, account: Readonly<Record<string, unknown>>) => Promise<boolean>,
) {
  return createRobinhoodOptionAdapter({
    call,
    clock: { now: () => NOW },
    calendar: createNyseCalendar(),
    store,
    feeReservePerContractCents: FEE_PER_CONTRACT_CENTS,
    ...(exerciseRiskControlled === undefined ? {} : { exerciseRiskControlled }),
  });
}

function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account_number: DEDICATED,
    agentic_allowed: true,
    option_level: "option_level_2",
    unsettled_funds: "500.00",
    ...overrides,
  };
}

function personalAccount(): Record<string, unknown> {
  return account({
    account_number: PERSONAL,
    agentic_allowed: false,
    option_level: "option_level_3",
    unsettled_funds: "0.00",
  });
}

function contract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INSTRUMENT,
    chain_id: CHAIN,
    chain_symbol: "SPY",
    expiration_date: "2026-11-27",
    type: "call",
    strike_price: "650.0000",
    trade_value_multiplier: "100",
    state: "active",
    tradability: "tradable",
    underlying_type: "equity",
    ...overrides,
  };
}

function chain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHAIN,
    symbol: "SPY",
    trade_value_multiplier: "100.0000",
    cash_component: null,
    underlying_instruments: [{ instrument: "underlying-fixture", symbol: "SPY" }],
    can_open_position: true,
    ...overrides,
  };
}

function quote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument_id: INSTRUMENT,
    bid_price: "1.70",
    ask_price: "1.75",
    bid_size: 12,
    ask_size: 20,
    updated_at: QUOTE_AT,
    ...overrides,
  };
}

function portfolio(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total_value: "250000.00",
    cash: "9000.00",
    pending_deposits: "1000.00",
    buying_power: {
      // Available margin must never become spendable option premium.
      buying_power: "50000.00",
      unleveraged_buying_power: "10000.00",
    },
    ...overrides,
  };
}

function buyHandlers(overrides: Handlers = {}): Handlers {
  return {
    get_accounts: { accounts: [personalAccount(), account()] },
    get_option_instruments: { instruments: [contract()] },
    get_option_chains: { chains: [chain()] },
    get_option_quotes: { results: [{ quote: quote() }] },
    get_portfolio: portfolio(),
    ...overrides,
  };
}

function optionOrder(options: {
  id?: string;
  status?: OrderRecord["status"];
  ticket?: LongOptionTicket;
  brokerOrderId?: string;
  filledQuantity?: number;
  createdAt?: number;
} = {}): OrderRecord {
  const ticket = options.ticket ?? buyTicket;
  const createdAt = options.createdAt ?? NOW - 3_600_000;
  const intent: OrderIntent = {
    symbol: ticket.symbol,
    longOption: ticket,
    side: ticket.side === "buy-to-open" ? "buy" : "sell",
    quantity: ticket.contracts,
    orderType: "limit",
    limitPrice: ticket.limitCents / 100,
    timeInForce: "day",
    invalidationPrice: 1,
    timeStopDate: "2026-11-27",
    thesis: "Adapter contract fixture; this is not a trading recommendation.",
    probabilityWin: 0.5,
    expectedGainPct: 50,
    expectedLossPct: 100,
    estimatedCostPct: 1,
    evidence: ["option adapter fixture"],
  };
  return {
    id: options.id ?? LOCAL_ORDER,
    createdAt,
    updatedAt: createdAt,
    intent,
    verdict: { approved: true, isExit: false, checks: [] },
    status: options.status ?? "submitted",
    ...(options.brokerOrderId === undefined ? {} : { brokerOrderId: options.brokerOrderId }),
    ...(options.filledQuantity === undefined ? {} : { filledQuantity: options.filledQuantity }),
  };
}

function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BROKER_ORDER,
    account_number: DEDICATED,
    quantity: "2",
    price: "1.75",
    state: "partially_filled",
    processed_quantity: "1",
    average_price: "1.65",
    ref_id: "not-the-local-reference",
    legs: [{ option_id: INSTRUMENT, side: "buy", position_effect: "open", ratio_quantity: 1 }],
    ...overrides,
  };
}

async function expectMappingError(action: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof BrokerMappingError, `expected BrokerMappingError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

test("option facts pin the MCP account and use settled cash, not margin or uncollected funds", async () => {
  const fake = fakeBroker(buyHandlers({
    get_option_quotes: { results: [
      { quote: quote({ instrument_id: OTHER_INSTRUMENT }) },
      { quote: quote() },
    ] },
  }));
  const orders = [
    optionOrder({ id: "local-buy-3", status: "submitted", ticket: { ...buyTicket, contracts: 3 } }),
    optionOrder({
      id: "local-buy-partial", status: "partially_filled", filledQuantity: 1,
      ticket: { ...buyTicket, contracts: 2, limitCents: 200 },
    }),
    optionOrder({ id: "local-buy-filled", status: "filled", filledQuantity: 1, ticket: { ...buyTicket, contracts: 1 } }),
    optionOrder({ id: "local-sell", status: "submitted", ticket: { ...buyTicket, side: "sell-to-close" } }),
  ];

  const facts = await makeAdapter(fake.call).facts(buyTicket, orders);

  assert.deepEqual(facts, {
    quote: { instrumentId: INSTRUMENT, at: Date.parse(QUOTE_AT), bidCents: 170, askCents: 175, bidSize: 12, askSize: 20 },
    equityCents: 25_000_000,
    accountPin: DEDICATED,
    // cash 900000 - pending 100000 - unsettled 50000 = 750000, versus 1000000
    // unleveraged; reserve (17500 + 3) * 3 + (20000 + 3) * 1 = 72512.
    settledUnreservedCashCents: 677_488,
    sellableContracts: 0,
    expirySession: "2026-11-27",
    sessionsUntilExpiry: 5,
    feeReservePerContractCents: FEE_PER_CONTRACT_CENTS,
    entriesUsed: 3,
    entryHalted: false,
    exerciseRiskControlled: false,
  });
  assert.deepEqual(callsTo(fake, "get_option_instruments"), [{ ids: INSTRUMENT, state: "active" }]);
  assert.deepEqual(callsTo(fake, "get_option_chains"), [{ ids: CHAIN }]);
  assert.deepEqual(callsTo(fake, "get_option_quotes"), [{ instrument_ids: [INSTRUMENT] }]);
  assert.deepEqual(callsTo(fake, "get_portfolio"), [{ account_number: DEDICATED }]);
  assert.deepEqual(callsTo(fake, "get_option_positions"), []);
  assert.equal(fake.calls.some(({ name }) => name === "place_option_order"), false);
});

test("option facts claim exercise protection only when the explicit policy verifies it", async () => {
  const seen: Array<{ ticket: LongOptionTicket; account: Readonly<Record<string, unknown>> }> = [];
  const fake = fakeBroker(buyHandlers());
  const facts = await makeAdapter(fake.call, async (ticket, details) => {
    seen.push({ ticket, account: details });
    return true;
  }).facts(buyTicket, []);

  assert.equal(facts.exerciseRiskControlled, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.ticket.instrumentId, INSTRUMENT);
  assert.equal(seen[0]!.account.account_number, DEDICATED);
});

test("a close reads only broker-sellable contracts and never claims exercise protection", async () => {
  const sellTicket: LongOptionTicket = { ...buyTicket, side: "sell-to-close", limitCents: 425 };
  const fake = fakeBroker({
    get_accounts: { accounts: [personalAccount(), account()] },
    get_option_instruments: { instruments: [contract()] },
    get_option_chains: { chains: [chain()] },
    get_option_quotes: { results: [{ quote: quote({ bid_price: "4.20", ask_price: "4.25" }) }] },
    get_option_positions: { positions: [{
      option_id: INSTRUMENT, type: "long", quantity: "5", quantity_available_for_sells: "2",
    }] },
  });

  const facts = await makeAdapter(fake.call, async () => true).facts(sellTicket, []);

  assert.equal(facts.sellableContracts, 2);
  assert.equal(facts.exerciseRiskControlled, false);
  assert.equal(facts.settledUnreservedCashCents, 0);
  assert.equal(facts.quote.bidCents, 420);
  assert.equal(facts.quote.askCents, 425);
  assert.deepEqual(callsTo(fake, "get_portfolio"), []);
  assert.deepEqual(callsTo(fake, "get_option_positions"), [{
    account_number: DEDICATED, option_ids: INSTRUMENT, type: "long", nonzero: true,
  }]);
});

test("reconcile binds partial and cancelled fills only to the exact broker order ID", async () => {
  const cases = [
    {
      state: "partially_filled", processed: "1",
      expected: { brokerOrderId: BROKER_ORDER, status: "partially_filled", filledQuantity: 1, averageFillPrice: 1.65 },
    },
    {
      state: "cancelled", processed: "1",
      expected: { brokerOrderId: BROKER_ORDER, status: "cancelled", filledQuantity: 1, averageFillPrice: 1.65 },
    },
    {
      state: "cancelled", processed: "0",
      expected: { brokerOrderId: BROKER_ORDER, status: "cancelled", filledQuantity: 0 },
    },
  ] as const;

  for (const item of cases) {
    const order = optionOrder({ brokerOrderId: BROKER_ORDER });
    const fake = fakeBroker({
      get_accounts: { accounts: [personalAccount(), account()] },
      get_option_orders: (args) => {
        assert.deepEqual(args, { account_number: DEDICATED, order_id: BROKER_ORDER });
        return { orders: [orderRow({ id: BROKER_ORDER, state: item.state, processed_quantity: item.processed })] };
      },
    });

    assert.deepEqual(await makeAdapter(fake.call).reconcile(order), item.expected);
    assert.equal(fake.calls.some(({ name }) => name === "place_option_order"), false);
  }
});

test("reconcile adopts an exact echoed agent reference for a partial or cancelled fill", async () => {
  const order = optionOrder({ status: "triggering" });
  const reference = optionOrderReference(order.id);
  const cases = [
    {
      state: "partially_filled",
      expected: { brokerOrderId: BROKER_ORDER, status: "partially_filled", filledQuantity: 1, averageFillPrice: 1.65 },
    },
    {
      state: "cancelled",
      expected: { brokerOrderId: BROKER_ORDER, status: "cancelled", filledQuantity: 1, averageFillPrice: 1.65 },
    },
  ] as const;

  for (const item of cases) {
    const fake = fakeBroker({
      get_accounts: { accounts: [personalAccount(), account()] },
      get_option_orders: (args) => {
        assert.deepEqual(args, {
          account_number: DEDICATED,
          agent_initiated: true,
          created_at_gte: new Date(order.createdAt - 60_000).toISOString(),
        });
        return { orders: [
          orderRow({ id: OTHER_BROKER_ORDER, ref_id: "unrelated-reference" }),
          orderRow({ id: BROKER_ORDER, ref_id: reference, state: item.state, processed_quantity: "1" }),
        ] };
      },
    });

    assert.deepEqual(await makeAdapter(fake.call).reconcile(order), item.expected);
  }
});

test("an identical date, contract and price without the exact identity never reconciles", async () => {
  const identified = optionOrder({ brokerOrderId: BROKER_ORDER });
  const identifiedFake = fakeBroker({
    get_accounts: { accounts: [account()] },
    get_option_orders: { orders: [
      orderRow({
        id: OTHER_BROKER_ORDER, account_number: DEDICATED,
        created_at: new Date(identified.createdAt).toISOString(),
      }),
    ] },
  });
  assert.equal(await makeAdapter(identifiedFake.call).reconcile(identified), undefined);

  const referenced = optionOrder({ status: "triggering" });
  const referencedFake = fakeBroker({
    get_accounts: { accounts: [account()] },
    get_option_orders: { orders: [
      orderRow({ id: OTHER_BROKER_ORDER, ref_id: optionOrderReference("some-other-local-order") }),
    ] },
  });
  assert.equal(await makeAdapter(referencedFake.call).reconcile(referenced), undefined);

  const emptyFake = fakeBroker({
    get_accounts: { accounts: [account()] },
    get_option_orders: { orders: [] },
  });
  assert.equal(await makeAdapter(emptyFake.call).reconcile(identified), undefined);
});

test("cancel acts only after the exact existing order reconciles", async () => {
  const order = optionOrder({ brokerOrderId: BROKER_ORDER });
  const cancelled: Record<string, unknown>[] = [];
  const fake = fakeBroker({
    get_accounts: { accounts: [personalAccount(), account()] },
    get_option_orders: (args) => {
      assert.deepEqual(args, { account_number: DEDICATED, order_id: BROKER_ORDER });
      return { orders: [
        orderRow({ id: OTHER_BROKER_ORDER, state: "confirmed", processed_quantity: "0" }),
        orderRow({ id: BROKER_ORDER, state: "partially_filled", processed_quantity: "1" }),
      ] };
    },
    cancel_option_order: (args) => {
      cancelled.push(args);
      return {};
    },
  });

  await makeAdapter(fake.call).cancel(order);

  assert.deepEqual(cancelled, [{ account_number: DEDICATED, order_id: BROKER_ORDER }]);
  assert.equal(fake.calls.some(({ name }) => name === "place_option_order"), false);
});

test("cancel leaves empty, stranger, filled, cancelled and mismatched rows alone", async () => {
  const order = optionOrder({ brokerOrderId: BROKER_ORDER });
  const noCancelRows: Record<string, unknown>[][] = [
    [],
    [orderRow({ id: OTHER_BROKER_ORDER, state: "confirmed", processed_quantity: "0" })],
    [orderRow({ id: BROKER_ORDER, state: "filled", processed_quantity: "2", average_price: "1.70" })],
    [orderRow({ id: BROKER_ORDER, state: "cancelled", processed_quantity: "0" })],
  ];

  for (const orders of noCancelRows) {
    let cancels = 0;
    const fake = fakeBroker({
      get_accounts: { accounts: [account()] },
      get_option_orders: { orders },
      cancel_option_order: () => {
        cancels += 1;
        return {};
      },
    });
    await makeAdapter(fake.call).cancel(order);
    assert.equal(cancels, 0, JSON.stringify(orders));
  }

  let cancels = 0;
  const mismatched = fakeBroker({
    get_accounts: { accounts: [account()] },
    get_option_orders: { orders: [orderRow({ id: BROKER_ORDER, state: "confirmed", processed_quantity: "0", price: "1.74" })] },
    cancel_option_order: () => {
      cancels += 1;
      return {};
    },
  });
  await expectMappingError(makeAdapter(mismatched.call).cancel(order), /did not match the approved contract and terms/);
  assert.equal(cancels, 0);
});

test("cancel refuses an option order with no durable broker ID before any broker read", async () => {
  const fake = fakeBroker({});
  await expectMappingError(
    makeAdapter(fake.call).cancel(optionOrder({ status: "triggering" })),
    /needs an identified broker order/,
  );
  assert.deepEqual(fake.calls, []);
});
