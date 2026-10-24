import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { SimService } from "./runner.ts";
import { jsonValue } from "./json.ts";

export function createSimToolsExtension({ sim }: { sim: SimService }): Extension {
  return defineExtension({ name: "simulations", tools: [
    defineTool({ name: "sim_start", description: "Test a strategy with a full Muse agent and the real risk engine in an accelerated historical paper account. One run at a time; no real orders. Allow roughly 1–3 minutes per cycle.",
      parameters: Type.Object({ days: Type.Integer({ minimum: 1, maximum: 20 }), startDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
        cyclesPerDay: Type.Optional(Type.Union([Type.Literal(2), Type.Literal(3), Type.Literal(4)])), strategy: Type.String({ maxLength: 2000 }),
        watchlist: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Z.]{1,10}$" }), { minItems: 1, maxItems: 30 })) }),
      structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String(), estimatedMinutes: Type.Number() }),
      async execute(args) {
        if (sim.list().some((run) => run.status === "running" || run.status === "queued")) throw new Error("A simulation is already active");
        const startDate = args.startDate ?? await sim.defaultStartDate(args.days);
        const run = await sim.start({ days: args.days, startDate, cyclesPerDay: args.cyclesPerDay ?? 2, startingCash: 1200, strategy: args.strategy,
          ...(args.watchlist === undefined ? {} : { watchlist: args.watchlist }) }, "agent");
        const result = { id: run.id, status: run.status, estimatedMinutes: (args.days * (args.cyclesPerDay ?? 2) + 1) * 2 };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) };
      } }),
    defineTool({ name: "sim_results", description: "Read simulation progress, risk-adjusted metrics, equity, fills and the last five journal decisions. Simulations are synthetic paths, not reliable predictions of live performance.",
      parameters: Type.Object({ id: Type.String() }), replay: "safe",
      structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String(), progress: Type.Any(), metrics: Type.Any(), equity: Type.Any(), fills: Type.Array(Type.Any()), journal: Type.Array(Type.String()), error: Type.Union([Type.String(), Type.Null()]) }),
      async execute({ id }) {
        const run = sim.get(id); if (run === undefined) throw new Error("Unknown simulation");
        const result = { id, status: run.status, progress: run.progress, metrics: run.metrics ?? null,
          equity: { first: run.equity[0] ?? null, last: run.equity.at(-1) ?? null, days: run.equity.length }, fills: run.fills,
          journal: sim.journal(id).slice(0, 5).map((entry) => entry.summary), error: run.error ?? null };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) };
      } }),
  ] });
}
