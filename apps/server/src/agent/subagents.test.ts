import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type FauxResponseStep, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
  watchEvents,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Logger } from "../ports.ts";
import { createSubagentExtension, DELEGATE_TOOL_NAME } from "./subagents.ts";

const context = BACKGROUND_CONTEXT;

const silentLog: Logger = {
  info() {},
  warn() {},
  error() {},
  child: () => silentLog,
};

const EXCLUDED = ["submit_order", "notes_write", "notes_append", "record_decision", DELEGATE_TOOL_NAME];

const CHILD_TASK = "Build a fact base on SPY covering trend, indicators, earnings date, and news.";
const CHILD_ANSWER =
  "SPY closed at 500.00, above its 50-day average. Volume was average. No earnings within two weeks. Verdict: neutral setup, trend intact.";

const quoteTool = defineTool({
  name: "quote",
  description: "Read-only market quote",
  parameters: Type.Object({ symbol: Type.String() }),
  execute: async (args) => ({
    output: [{ type: "text" as const, text: `${args.symbol} 500.00` }],
  }),
});

const submitOrderTool = defineTool({
  name: "submit_order",
  description: "Write path that subagents must not have",
  parameters: Type.Object({ symbol: Type.String() }),
  execute: async () => ({
    output: [{ type: "text" as const, text: "order placed (should never happen from a subagent)" }],
  }),
});

/** Calls delegate as a nested tool call (like a Code Mode script) and
 * reports the nested result as JSON text. */
const probeTool = defineTool({
  name: "probe",
  description: "Test probe that delegates and reports the nested result",
  parameters: Type.Object({
    role: Type.String(),
    task: Type.String(),
    symbol: Type.Optional(Type.String()),
  }),
  // Reruns after a crash, like a Code Mode script, so the nested delegate
  // call reattaches by key instead of starting over.
  replay: "safe",
  execute: async (args, api, callContext) => {
    const nested = await api.executeTool(
      DELEGATE_TOOL_NAME,
      {
        role: args.role,
        task: args.task,
        ...(args.symbol === undefined ? {} : { symbol: args.symbol }),
      },
      callContext,
    );
    return {
      output: [
        {
          type: "text" as const,
          text: JSON.stringify({
            isError: nested.isError,
            structuredOutput: nested.structuredOutput,
            details: nested.details,
          }),
        },
      ],
    };
  },
});

function lastText(message: Message): string {
  if (message.role === "system") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function routeFor(childAnswer: string): FauxResponseStep {
  return (request) => {
    const rest = request.messages.filter((message) => message.role !== "system");
    const last = rest[rest.length - 1]!;
    if (last.role === "toolResult") {
      return fauxAssistantMessage([fauxText("Understood, delegation complete.")]);
    }
    if (lastText(last).includes("Build a fact base")) {
      return fauxAssistantMessage([fauxText(childAnswer)]);
    }
    return fauxAssistantMessage(
      [fauxToolCall("probe", { role: "analyst", task: CHILD_TASK, symbol: "SPY" })],
      { stopReason: "toolUse" },
    );
  };
}

function installTestRegistry(tokensPerSecond?: number) {
  const faux = fauxProvider(tokensPerSecond === undefined ? {} : { tokensPerSecond });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(defineExtension({ name: "trading", tools: [quoteTool, submitOrderTool] }));
  registry.install(defineExtension({ name: "probe-ext", tools: [probeTool] }));
  registry.install(createSubagentExtension({ log: silentLog, excludedTools: EXCLUDED }));
  return { faux, models, registry };
}

async function collectChildIds(harness: Harness, rootId: ConversationId): Promise<{
  ids: ConversationId[];
  stop: () => Promise<void>;
}> {
  const ids: ConversationId[] = [];
  const stream = await watchEvents(harness, rootId, context);
  stream.start(async (events) => {
    for (const event of events) {
      const details =
        event.type === "tool_execution_update"
          ? (event.details as { conversationId?: unknown } | undefined)
          : event.type === "tool_execution_end"
            ? (event.result?.details as { conversationId?: unknown } | undefined)
            : undefined;
      if (typeof details?.conversationId === "number" && !ids.includes(details.conversationId as ConversationId)) {
        ids.push(details.conversationId as ConversationId);
      }
    }
  });
  return { ids, stop: () => stream.stop().then(() => {}) };
}

describe("subagent delegate tool", () => {
  it("creates one owned child with role instructions and without excluded tools", async () => {
    const { faux, models, registry } = installTestRegistry();
    faux.setResponses(Array.from({ length: 20 }, () => routeFor(CHILD_ANSWER)));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
    try {
      const root = await harness.root(context, {
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      });
      const { ids, stop } = await collectChildIds(harness, root.id);
      try {
        const submission = await root.submit(
          { type: "input", content: "Please delegate a fact base on SPY." },
          context,
        );
        const settled = await submission.wait(context);
        assert.equal(settled.status, "done");
        await harness.waitForIdle(context);
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(ids.length, 1, "exactly one child conversation is created");
        const child = await harness.conversation(ids[0]!, context);
        assert.ok(child, "child conversation is reachable");
        const agent = await child.agent(context);
        assert.ok(
          !agent.extensions.some((extension) => extension.name === "subagents"),
          "child has no subagent extension",
        );
        for (const names of [agent.tools.map((tool) => tool.name), agent.callable.map((tool) => tool.name)]) {
          assert.ok(names.includes("quote"), "child keeps the read-only quote tool");
          assert.ok(!names.includes("submit_order"), "child loses the excluded order tool");
          assert.ok(!names.includes("delegate"), "child cannot delegate further");
        }
        assert.equal(agent.thinkingLevel, "medium");
        assert.ok(agent.instructions?.includes("analyst"), "child instructions carry the role brief");
        assert.ok(agent.instructions?.includes("SPY"), "child instructions carry the symbol");

        const pages = await child.entries({}, 100, undefined, context);
        const transcript = pages.items
          .flatMap((entry) => entry.model ?? [])
          .map(lastText)
          .join("\n");
        assert.ok(transcript.includes(CHILD_TASK), "child transcript holds the delegated task");

        const rootPages = await root.entries({ order: "descending" }, 100, undefined, context);
        const probeResult = rootPages.items
          .flatMap((entry) => entry.model ?? [])
          .find((message) => message.role === "toolResult" && message.toolName === "probe");
        assert.ok(probeResult && probeResult.role === "toolResult", "probe tool result is in the transcript");
        const reported = JSON.parse(lastText(probeResult)) as {
          isError: boolean;
          structuredOutput: {
            role: string;
            symbol: string | null;
            conversationId: number;
            answer: string;
            status: string;
          };
          details: { conversationId: number; role: string };
        };
        assert.equal(reported.isError, false);
        assert.equal(reported.structuredOutput.role, "analyst");
        assert.equal(reported.structuredOutput.symbol, "SPY");
        assert.equal(reported.structuredOutput.conversationId, ids[0]);
        assert.equal(reported.structuredOutput.status, "done");
        assert.ok(
          reported.structuredOutput.answer.includes("Verdict:"),
          "structured output carries the child's answer",
        );
        assert.equal(reported.details.conversationId, ids[0]);
        assert.equal(reported.details.role, "analyst");
      } finally {
        await stop();
      }
    } finally {
      await harness.close(context);
    }
  });

  it("reruns reuse the same child conversation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rh-subagents-"));
    try {
      // Phase 1: start a delegation with a slow-streaming child, then stop
      // the process while the child is still working.
      const slowAnswer = `${"Sentence of the slow answer. ".repeat(40)} Verdict: slow setup observed.`;
      const first = installTestRegistry(10);
      first.faux.setResponses(Array.from({ length: 20 }, () => routeFor(slowAnswer)));
      const storagePath = join(directory, "session.sqlite");
      const harness1 = await Harness.open(
        await openNodeSqliteStorage(storagePath),
        { models: first.models, registry: first.registry },
        context,
      );
      const root1 = await harness1.root(context, {
        agent: { model: { provider: "faux", modelId: "faux-1" } },
      });
      const seen1 = await collectChildIds(harness1, root1.id);
      try {
        await root1.submit({ type: "input", content: "Please delegate a fact base on SPY." }, context);
        const deadline = Date.now() + 30_000;
        while (seen1.ids.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(seen1.ids.length, 1, "child exists before the stop");
      } finally {
        await seen1.stop();
        await harness1.close(context);
      }

      // Phase 2: reopen the same storage. The replay-safe delegate rerun
      // must find the same child instead of creating another.
      const second = installTestRegistry();
      second.faux.setResponses(Array.from({ length: 20 }, () => routeFor(CHILD_ANSWER)));
      const harness2 = await Harness.open(
        await openNodeSqliteStorage(storagePath),
        { models: second.models, registry: second.registry },
        context,
      );
      try {
        const root2 = await harness2.root(context, {
          agent: { model: { provider: "faux", modelId: "faux-1" } },
        });
        const seen2 = await collectChildIds(harness2, root2.id);
        try {
          await root2.waitForIdle(context);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.deepEqual([...seen2.ids], [...seen1.ids], "rerun reuses the same child conversation");
          const child = await harness2.conversation(seen1.ids[0]!, context);
          assert.ok(child, "reused child is reachable after reopen");
          const pages = await root2.entries({ order: "descending" }, 100, undefined, context);
          const transcript = pages.items
            .flatMap((entry) => entry.model ?? [])
            .map(lastText)
            .join("\n");
          assert.ok(transcript.includes("delegation complete"), "parent finishes after the rerun");
        } finally {
          await seen2.stop();
        }
      } finally {
        await harness2.close(context);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
