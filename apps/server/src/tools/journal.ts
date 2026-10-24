import { Type, type Static } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { Clock, EventBus, Store } from "../ports.ts";

/** Every cycle ends with exactly one of these, including holds. */
export interface JournalDeps {
  store: Store;
  bus: EventBus;
  clock: Clock;
  currentCycleId: () => string | undefined;
}

const recordDecisionSchema = Type.Object({
  action: Type.Union(
    [Type.Literal("hold"), Type.Literal("buy"), Type.Literal("sell"), Type.Literal("watch"), Type.Literal("none")],
    { description: "The decision: hold, buy, sell, watch, or none." },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker the decision concerns.", minLength: 1, maxLength: 10 })),
  summary: Type.String({ description: "One-line headline of the decision.", minLength: 1, maxLength: 140 }),
  rationale: Type.String({ description: "Why this decision follows the protocol.", minLength: 1, maxLength: 4000 }),
  confidence: Type.Optional(Type.Number({ description: "Confidence in the decision, 0 to 1.", minimum: 0, maximum: 1 })),
  evidence: Type.Array(Type.String({ minLength: 1, maxLength: 400 }), {
    description: "Citations to tool outputs: tool name plus what it showed and when. At least one.",
    minItems: 1,
    maxItems: 20,
  }),
  orderId: Type.Optional(Type.String({ description: "Harness order id, when this decision submitted an order.", minLength: 1 })),
  regime: Type.Optional(Type.String({ description: 'Market regime tag, e.g. "risk-on trend" or "high-vol chop".', minLength: 1, maxLength: 80 })),
});

type RecordDecisionArgs = Static<typeof recordDecisionSchema>;

export function createJournalExtension(deps: JournalDeps): Extension {
  const recordDecision = defineTool({
    name: "record_decision",
    description:
      "Journal the cycle's decision: call exactly once per cycle with the decision, including holds, and after every submitted order.",
    parameters: recordDecisionSchema,
    async execute(args: RecordDecisionArgs) {
      const entry = deps.store.addJournal({
        at: deps.clock.now(),
        cycleId: deps.currentCycleId(),
        action: args.action,
        symbol: args.symbol,
        summary: args.summary,
        rationale: args.rationale,
        confidence: args.confidence,
        evidence: [...args.evidence],
        orderId: args.orderId,
        regime: args.regime,
      });
      deps.bus.publish({ type: "journal", entry });
      return { output: [{ type: "text" as const, text: `Recorded journal entry ${entry.id} (${args.action}).` }] };
    },
  });

  return defineExtension({ name: "journal", tools: [recordDecision] });
}
