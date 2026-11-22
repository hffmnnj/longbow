import assert from "node:assert/strict";
import { test } from "node:test";
import { BrokerMappingError } from "./mapping.ts";
import { getOptionReadiness, optionPreviewTools, previewLongOption } from "./option-preflight.ts";
import { prepareOptionPlacement } from "./option-order-transport.ts";

const instrumentId = "10000000-0000-0000-0000-000000000001";
const chainId = "20000000-0000-0000-0000-000000000001";
const dedicated = "MCP0001";
type CallName = "get_accounts" | "get_trade_approval_setting" | "get_option_instruments" | "get_option_chains" | "review_option_order";
type Call = (name: CallName, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

const account = (overrides: Record<string, unknown> = {}) =>
  ({ account_number: dedicated, agentic_allowed: true, option_level: "option_level_2", ...overrides });
const contract = (overrides: Record<string, unknown> = {}) => ({ id: instrumentId, chain_id: chainId, chain_symbol: "SPY",
  expiration_date: "2026-12-18", type: "call", strike_price: "650.0000", trade_value_multiplier: "100",
  state: "active", tradability: "tradable", underlying_type: "equity", ...overrides });
const valid = { instrumentId, symbol: "SPY", expiration: "2026-12-18", strikeCents: 65_000,
  contractType: "call" as const, side: "buy-to-open" as const, contracts: 3, limitCents: 250 };
const session = () => ({ date: "2026-11-20", isOpen: true });
const chain = (overrides: Record<string, unknown> = {}) => ({ id: chainId, symbol: "SPY", trade_value_multiplier: "100.0000",
  cash_component: null, underlying_instruments: [{ instrument: "fixture", symbol: "" }], can_open_position: true, ...overrides });

function broker(overrides: Partial<Record<CallName, () => Record<string, unknown>>> = {}) {
  const handlers: Record<CallName, () => Record<string, unknown>> = {
    get_accounts: () => ({ accounts: [account()] }),
    get_trade_approval_setting: () => ({ setting: { account_number: dedicated, human_must_approve_trades: false } }),
    get_option_instruments: () => ({ instruments: [contract()] }),
    get_option_chains: () => ({ chains: [chain()] }),
    review_option_order: () => ({ order_checks: [], customer_approval_required: false }),
    ...overrides,
  };
  const calls: Array<[CallName, Record<string, unknown>]> = [];
  const call: Call = async (name, args) => {
    calls.push([name, args]);
    return handlers[name]();
  };
  return { call, calls };
}

async function expectMappingError(action: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof BrokerMappingError, `expected BrokerMappingError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

test("options readiness is redacted, pins the dedicated account, and reports not-approved", async () => {
  const { call, calls } = broker({
    get_accounts: () => ({ accounts: [
      account({ account_number: "PERSONAL9", agentic_allowed: false, option_level: "option_level_3" }),
      account({ option_level: "option_level_0" }),
    ] }),
    get_trade_approval_setting: () => ({ setting: { account_number: dedicated, human_must_approve_trades: true } }),
  });
  const readiness = await getOptionReadiness(call);
  assert.deepEqual(readiness, {
    optionsEntitlement: "not-approved",
    approvalRequiredAtRobinhood: true,
    longbowExecution: "unavailable",
    nextStep: "The owner can apply for options access on the dedicated MCP account in the Robinhood app.",
  });
  assert.deepEqual(calls, [
    ["get_accounts", {}],
    ["get_trade_approval_setting", { account_number: dedicated }],
  ]);
  assert.doesNotMatch(JSON.stringify(readiness), /MCP0001|PERSONAL9|option_level/);
});

test("readiness stays preview-only when entitled and refuses a mismatched approval setting", async () => {
  const entitled = await getOptionReadiness(broker().call);
  assert.equal(entitled.optionsEntitlement, "level-2");
  assert.equal(entitled.longbowExecution, "unavailable");
  assert.equal(entitled.nextStep, "Longbow can preview orders but cannot send live options orders.");
  for (const setting of [
    { account_number: "PERSONAL9", human_must_approve_trades: false },
    { account_number: dedicated, human_must_approve_trades: "false" },
    { account_number: dedicated },
  ]) {
    const { call } = broker({ get_trade_approval_setting: () => ({ setting }) });
    await expectMappingError(getOptionReadiness(call), /no matching trade approval setting/);
  }
});

test("a standard buy-to-open preview sends one exact contract and limit and reports the full premium", async () => {
  const { call, calls } = broker();
  const preview = await previewLongOption(valid, call, session);
  assert.deepEqual(preview, {
    ...valid, kind: "preview-only", maxPremiumOrLimitProceedsCents: 75_000,
    premiumExcludesFees: true, robinhoodApprovalRequired: false, preTradeAlertCount: 0,
    nextStep: "This was a broker preview only; no order was submitted.",
  });
  assert.deepEqual(calls, [
    ["get_accounts", {}],
    ["get_option_instruments", { ids: instrumentId, state: "active" }],
    ["get_option_chains", { ids: chainId }],
    ["review_option_order", {
      account_number: dedicated,
      legs: [{ option_id: instrumentId, side: "buy", position_effect: "open", ratio_quantity: 1 }],
      type: "limit", quantity: "3", price: "2.50", time_in_force: "gfd", market_hours: "regular_hours",
    }],
  ]);
  const documented = new Set<string>(optionPreviewTools);
  assert.ok(calls.every(([name]) => documented.has(name)));
  assert.equal(documented.has("review_option_order"), true);
  assert.equal(calls.some(([name]) => /place|submit|cancel|exercise/.test(name)), false);
});

test("a sell-to-close preview maps close legs and surfaces pre-trade alerts without claiming submission", async () => {
  const { call, calls } = broker({
    review_option_order: () => ({ order_checks: [{ message: "alert" }], customer_approval_required: true }),
  });
  const preview = await previewLongOption({ ...valid, side: "sell-to-close", limitCents: 425 }, call, session);
  const review = calls.find(([name]) => name === "review_option_order")?.[1];
  assert.deepEqual(review?.legs, [
    { option_id: instrumentId, side: "sell", position_effect: "close", ratio_quantity: 1 },
  ]);
  assert.equal(review?.price, "4.25");
  assert.equal(preview.maxPremiumOrLimitProceedsCents, 127_500);
  assert.equal(preview.robinhoodApprovalRequired, true);
  assert.equal(preview.preTradeAlertCount, 1);
  assert.equal(preview.nextStep,
    "Robinhood reported pre-trade alerts. Review them in the Robinhood app; nothing was submitted.");
});

test("missing or unrecognized options approval stops before any contract lookup or review", async () => {
  for (const level of ["option_level_0", "option_level_1", "", null, "option_level_9"]) {
    const { call, calls } = broker({ get_accounts: () => ({ accounts: [account({ option_level: level })] }) });
    await expectMappingError(previewLongOption(valid, call, session),
      /does not report Level 2 or Level 3 options approval/);
    assert.deepEqual(calls, [["get_accounts", {}]]);
  }
});

test("a mismatched or ambiguous contract stops before the broker review", async () => {
  for (const instruments of [
    [contract({ chain_symbol: "QQQ" })],
    [contract({ expiration_date: "2026-12-25" })],
    [contract({ type: "put" })],
    [contract({ strike_price: "655.0000" })],
    [contract({ trade_value_multiplier: "10" })],
    [contract({ state: "inactive" })],
    [contract({ tradability: "untradable" })],
    [contract({ underlying_type: "index" })],
    [contract({ id: "10000000-0000-0000-0000-000000000002" })],
    [contract(), contract()],
    [],
  ]) {
    const { call, calls } = broker({ get_option_instruments: () => ({ instruments }) });
    await expectMappingError(previewLongOption(valid, call, session),
      /did not confirm the exact standard equity option/);
    assert.deepEqual(calls.map(([name]) => name), ["get_accounts", "get_option_instruments"]);
  }
});

test("an unrecognized or ambiguous broker preview reply fails closed", async () => {
  for (const reply of [
    {},
    { customer_approval_required: false },
    { order_checks: [] },
    { order_checks: "none", customer_approval_required: false },
    { order_checks: {}, customer_approval_required: false },
    { order_checks: [], customer_approval_required: "no" },
  ]) {
    const { call, calls } = broker({ review_option_order: () => reply });
    await expectMappingError(previewLongOption(valid, call, session),
      /did not confirm approval and alert status; nothing was submitted/);
    assert.deepEqual(calls.map(([name]) => name),
      ["get_accounts", "get_option_instruments", "get_option_chains", "review_option_order"]);
  }
});

test("preview refuses adjusted, mismatched, or close-only chains before broker review", async () => {
  for (const candidate of [
    chain({ cash_component: "5.00" }),
    chain({ underlying_instruments: [] }),
    chain({ underlying_instruments: [{}, {}] }),
    chain({ symbol: "QQQ" }),
    chain({ can_open_position: false }),
  ]) {
    const { call, calls } = broker({ get_option_chains: () => ({ chains: [candidate] }) });
    await expectMappingError(previewLongOption(valid, call, session), /did not confirm an eligible 100-multiplier chain/);
    assert.deepEqual(calls.map(([name]) => name), ["get_accounts", "get_option_instruments", "get_option_chains"]);
  }
});

test("private placement handle sends pinned terms once; alerts never reach placement", async () => {
  for (const blocked of [true, false]) {
    const mock = broker({ review_option_order: () => ({
      order_checks: blocked ? [{ action: "stop" }] : [], customer_approval_required: false,
    }) });
    const sends: Record<string, unknown>[] = [];
    const prepared = await prepareOptionPlacement(valid, async (name, args) => {
      if (name !== "place_option_order") return mock.call(name, args);
      sends.push(args);
      return { customer_approval_required: false, order: { id: "30000000-0000-0000-0000-000000000001" } };
    }, session);
    assert.equal(sends.length, 0);
    if (blocked) {
      await assert.rejects(prepared.place("persisted-order"), /not eligible/);
      assert.equal(sends.length, 0);
    } else {
      assert.deepEqual(await prepared.place("persisted-order"), { brokerOrderId: "30000000-0000-0000-0000-000000000001" });
      await assert.rejects(prepared.place("persisted-order"), /not eligible/);
      const [{ ref_id: refId, ...terms }] = sends as [Record<string, unknown>];
      assert.match(String(refId), /^[0-9a-f]{64}$/);
      assert.deepEqual(terms, mock.calls.at(-1)?.[1]);
      assert.equal(sends.length, 1);
    }
  }
});

test("replacement MCP account is refused even before the broker review", async () => {
  const mock = broker();
  await assert.rejects(prepareOptionPlacement(valid, async (name, args) => {
    if (name === "place_option_order") return assert.fail("no placement");
    return mock.call(name, args);
  }, session, "original-account"), /account changed during approval/);
  assert.deepEqual(mock.calls, [["get_accounts", {}]]);
});
