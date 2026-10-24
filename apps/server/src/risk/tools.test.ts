import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { DEFAULT_SETTINGS, type HaltReason, type OrderRecord } from "@rh/shared";
import { createRiskExtension } from "./tools.ts";
import { createNyseCalendar } from "./calendar.ts";
import type { Broker, Clock, OrderGate, Store } from "../ports.ts";

const NOW = Date.UTC(2026, 10, 2, 15, 5, 0);

function outputText(result: { output?: readonly unknown[] }): string {
  const blocks = (result.output ?? []) as { type: string; text?: string }[];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

function cannedOrder(status: OrderRecord["status"]): OrderRecord {
  return {
    id: "order-7",
    createdAt: NOW,
    updatedAt: NOW,
    cycleId: "cycle-9",
    intent: {
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      orderType: "limit",
      limitPrice: 150,
      timeInForce: "day",
      invalidationPrice: 140,
      timeStopDate: "2026-12-02",
      thesis: "breakout above resistance on strong volume",
      probabilityWin: 0.6,
      expectedGainPct: 10,
      expectedLossPct: 5,
      estimatedCostPct: 0.5,
      evidence: ["robinhood quote showed tight spread this morning"],
    },
    verdict: {
      approved: false,
      isExit: false,
      checks: [
        { rule: "position_size", ok: false, detail: "existing $3000 + order $15000 vs $5000" },
        { rule: "mode", ok: true, detail: 'mode is "approve"; orders may flow' },
      ],
      maxQuantity: 13,
    },
    status,
  };
}

describe("risk extension", () => {
  it("exposes submit_order (unsafe) and get_risk_state (safe)", () => {
    const gate = {
      submit: async () => cannedOrder("pending_approval"),
      approve: async () => cannedOrder("submitted"),
      reject: async () => cannedOrder("rejected_user"),
      halts: async () => [] as HaltReason[],
    } satisfies OrderGate;
    const ext = createRiskExtension({
      gate,
      store: {} as Store,
      calendar: createNyseCalendar(),
      clock: { now: () => NOW } satisfies Clock,
      broker: {} as Broker,
      currentCycleId: () => undefined,
    });
    assert.equal(ext.name, "risk");
    assert.deepEqual(
      ext.tools?.map((t) => t.name).sort(),
      ["get_risk_state", "submit_order"],
    );
    assert.equal(ext.tools?.find((t) => t.name === "submit_order")?.replay, undefined);
    assert.equal(ext.tools?.find((t) => t.name === "get_risk_state")?.replay, "safe");
  });

  it("submit_order reports the id, status, failed checks, and max quantity", async () => {
    let seenCycleId: string | undefined;
    const gate = {
      submit: async (_intent: unknown, cycleId?: string) => {
        seenCycleId = cycleId;
        return cannedOrder("pending_approval");
      },
      approve: async () => cannedOrder("submitted"),
      reject: async () => cannedOrder("rejected_user"),
      halts: async () => [] as HaltReason[],
    } as unknown as OrderGate;
    const ext = createRiskExtension({
      gate,
      store: {} as Store,
      calendar: createNyseCalendar(),
      clock: { now: () => NOW } satisfies Clock,
      broker: {} as Broker,
      currentCycleId: () => "cycle-9",
    });
    const tool = ext.tools?.find((t) => t.name === "submit_order");
    assert.ok(tool);
    const result = await tool.execute(
      {
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        orderType: "limit",
        limitPrice: 150,
        timeInForce: "day",
        invalidationPrice: 140,
        timeStopDate: "2026-12-02",
        thesis: "breakout above resistance on strong volume",
        probabilityWin: 0.6,
        expectedGainPct: 10,
        expectedLossPct: 5,
        estimatedCostPct: 0.5,
        evidence: ["robinhood quote showed tight spread this morning"],
      },
      undefined as unknown as ToolExecutionApi,
      undefined as unknown as Context,
    );
    assert.equal(seenCycleId, "cycle-9");
    const text = outputText(result);
    assert.match(text, /order-7/);
    assert.match(text, /pending_approval/);
    assert.match(text, /position_size/);
    assert.match(text, /max quantity allowed by the sizing rules: 13/);
    assert.match(text, /a human must approve/);
  });

  it("get_risk_state summarizes mode, halts, budgets, and pending orders", async () => {
    const pending = cannedOrder("pending_approval");
    const store = {
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      ordersSince: () => [
        { ...pending, id: "order-8", status: "submitted" as const },
        pending,
      ],
    } as unknown as Store;
    const gate = {
      submit: async () => cannedOrder("pending_approval"),
      approve: async () => cannedOrder("submitted"),
      reject: async () => cannedOrder("rejected_user"),
      halts: async () => ["daily_loss"] as HaltReason[],
    } as unknown as OrderGate;
    const broker = { status: () => ({ state: "connected", tools: [] }) } as unknown as Broker;
    const ext = createRiskExtension({
      gate,
      store,
      calendar: createNyseCalendar(),
      clock: { now: () => NOW } satisfies Clock,
      broker,
      currentCycleId: () => undefined,
    });
    const tool = ext.tools?.find((t) => t.name === "get_risk_state");
    assert.ok(tool);
    const result = await tool.execute(
      {},
      undefined as unknown as ToolExecutionApi,
      undefined as unknown as Context,
    );
    const text = outputText(result);
    assert.match(text, /mode: approve/);
    assert.match(text, /daily_loss/);
    assert.match(text, /entries today: 1\/2/);
    assert.match(text, /day trades \(5d\): 0\/3/);
    assert.match(text, /order-7/);
  });
});
