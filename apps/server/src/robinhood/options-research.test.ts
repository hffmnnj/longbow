import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { robinhoodExtension } from "./tools.ts";
import { compareRobinhoodPuts } from "./options-research.ts";

const clock = (isOpen = true) => ({
  now: Date.parse("2026-11-20T16:00:00Z"), date: "2026-11-20", isOpen, sessionOpen: Date.parse("2026-11-20T14:30:00Z"),
});
const input = { symbol: "SPY", expiration: "2026-12-18", strikes: [650] };
const id = "10000000-0000-0000-0000-000000000001";
const instrument = { id, chain_symbol: "SPY", expiration_date: "2026-12-18", type: "put", state: "active",
  tradability: "tradable", strike_price: "650.0000", trade_value_multiplier: "100" };
const quote = { instrument_id: id, bid_price: "1.75", ask_price: "2", bid_size: 3, ask_size: 5,
  updated_at: "2026-11-20T15:59:58.123456789Z" };
const names = ["get_option_instruments", "get_option_quotes", "place_option_order", "exercise_option"];
const tools = names.map((name) => ({ name, inputSchema: { type: "object" as const } }));

test("registered put comparison reads only discovered instruments and quotes and gives full contract costs", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const extension = robinhoodExtension({ tools, marketClock: clock, status: () => ({ state: "connected", tools: names }),
    call: async (name, args) => {
      calls.push([name, args]);
      return { content: [], structuredContent: { data: name === "get_option_instruments"
        ? { instruments: [instrument] } : { results: [{ quote }] }, guide: "untrusted vendor prose" } };
    } });
  const compare = extension.tools?.find((tool) => tool.name === "rh_compare_puts") as ToolRegistration;
  const execute = compare.execute as unknown as (args: typeof input, api: object, ctx: object) =>
    Promise<{ output: { text: string }[]; isError?: boolean }>;
  const result = await execute(input, {}, {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [
    ["get_option_instruments", { chain_symbol: "SPY", expiration_dates: "2026-12-18", strike_price: "650.0000", type: "put", state: "active" }],
    ["get_option_quotes", { instrument_ids: [id] }],
  ]);
  const decoded = JSON.parse(result.output[0]!.text);
  assert.equal(decoded.purpose, "research-only");
  assert.deepEqual(decoded.contracts, [{ strike: 650, instrumentId: id, status: "recent",
    quoteTime: "2026-11-20T15:59:58.123Z", bidPerShareUsd: 1.75, askPerShareUsd: 2, bidSize: 3, askSize: 5,
    estimatedPremiumPerContractUsd: 200, spreadPerContractUsd: 25, breakEvenAtExpirationUsd: 648 }]);
  assert.doesNotMatch(result.output[0]!.text, /untrusted vendor prose/);
  assert.equal(extension.tools?.some((tool) => /^rh_(place|exercise)_/.test(tool.name)), false);
});

test("mixed or invalid broker evidence never becomes a current quote", async () => {
  for (const [q, market, status] of [
    [{ ...quote, updated_at: "2026-11-20T15:00:00Z" }, clock(), "stale-or-unverified"],
    [{ ...quote, updated_at: "2026-11-20T14:29:59Z" }, { ...clock(), now: clock().sessionOpen }, "stale-or-unverified"],
    [quote, clock(false), "outside-regular-session"],
    [{ ...quote, instrument_id: "wrong-contract" }, clock(), "incomplete"],
    [{ ...quote, bid_price: "3" }, clock(), "incomplete"],
  ] as const) {
    const result = await compareRobinhoodPuts(input, async (name) => name === "get_option_instruments"
      ? { data: { instruments: [instrument] } } : { data: { results: [{ quote: q }] } }, () => market);
    const row = result.contracts[0];
    assert.ok(row && "status" in row);
    assert.equal(row.status, status);
  }
  await assert.rejects(compareRobinhoodPuts({ ...input, strikes: [650, 650] },
    async () => assert.fail("No request with invalid strikes"), clock), /distinct/);
});
