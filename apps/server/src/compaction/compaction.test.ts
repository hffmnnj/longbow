import assert from "node:assert/strict";
import { test } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { BACKGROUND_CONTEXT as CTX } from "@earendil-works/chord/context";
import { InMemoryCredentialStore, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { createRegistry, Harness, MemoryStorage, type Conversation } from "@earendil-works/pi-durable";
import type { Logger } from "../ports.ts";
import { encodeCheckpoint, FALLBACK, replayPayload } from "./checkpoint.ts";
import { nativeCompactionExtension, withCompactionReplay } from "./index.ts";
import { compactRemotely } from "./remote.ts";

const item = { type: "compaction" as const, encrypted_content: "opaque-test-only" };
const messages: Message[] = [{ role: "user", content: "Remember the test portfolio.", timestamp: 1 }];
const modelRef = { provider: "openai-codex", modelId: "gpt-6.1-sol" };
const wrapped = (summary: string): string => `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summary}\n</summary>`;
const markerMessage = (summary: string) => ({ role: "user", content: [{ type: "input_text", text: wrapped(summary) }] });

function sse(events: unknown[]): Response {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      // Exercise pi-ai's actual fragmented SSE parser, not a fake provider event iterator.
      for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

function compactSse(output: unknown[] = [item]): Response {
  return sse([
    ...output.map((value) => ({ type: "response.output_item.done", item: value })),
    { type: "response.completed", response: { status: "completed", output, usage: { input_tokens: 20, output_tokens: 5 } } },
  ]);
}

async function requestBody(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  const bytes = Buffer.from(await new Response(init?.body).arrayBuffer());
  const text = new Headers(init?.headers).get("content-encoding") === "zstd" ? zstdDecompressSync(bytes).toString() : bytes.toString();
  return JSON.parse(text) as Record<string, unknown>;
}

function textSse(): Response {
  const message = { type: "message", role: "assistant", id: "msg_test", status: "completed", content: [{ type: "output_text", text: "Regular text summary", annotations: [] }] };
  return sse([{ type: "response.output_item.done", output_index: 0, item: message }, { type: "response.completed", response: {
    id: "resp_test", status: "completed", output: [message],
    usage: { input_tokens: 20, output_tokens: 5 },
  } }]);
}

async function testModels(fakeFetch?: typeof fetch) {
  const credentials = new InMemoryCredentialStore();
  const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url");
  await credentials.modify("openai-codex", async () => ({ type: "oauth", access: `test.${claims}.test`, refresh: "test", expires: Date.now() + 3_600_000 }));
  await credentials.modify("meta", async () => ({ type: "oauth", access: `test.${claims}.test`, refresh: "test", expires: Date.now() + 3_600_000 }));
  const models = createModels({ credentials });
  const provider = withCompactionReplay(openaiCodexProvider());
  models.setProvider(fakeFetch === undefined ? provider : {
    ...provider,
    streamSimple(model, context, options) {
      return provider.streamSimple(model, context, { ...options, fetch: fakeFetch, transport: "sse" });
    },
  });
  const model = models.getModel(modelRef.provider, modelRef.modelId);
  assert.ok(model);
  return { models, model, credentials };
}

test("remote request uses Codex Responses, a final compaction trigger, and validated single encrypted item", async () => {
  const { models, model } = await testModels();
  let requests = 0;
  const result = await compactRemotely(models, model, messages, { fetch: async (url, init) => {
    requests++;
    assert.equal(String(url), "https://chatgpt.com/backend-api/codex/responses");
    const body = await requestBody(init);
    assert.equal(body["model"], "gpt-6.1-sol");
    assert.equal(body["store"], false);
    assert.equal(body["stream"], true);
    assert.deepEqual(body["input"], [
      { role: "user", content: [{ type: "input_text", text: "Remember the test portfolio." }] },
      { type: "compaction_trigger" },
    ]);
    return compactSse();
  } });
  assert.deepEqual(result, item);
  assert.equal(requests, 1);
});

for (const [name, response] of [
  ["zero items", () => compactSse([])],
  ["multiple items", () => compactSse([item, { ...item, encrypted_content: "another" }])],
  ["empty ciphertext", () => compactSse([{ ...item, encrypted_content: "" }])],
  ["failed completion", () => sse([{ type: "response.completed", response: { status: "failed", output: [item] } }])],
  ["truncated stream", () => sse([{ type: "response.output_item.done", item }])],
  ["HTTP failure", () => new Response("private error body", { status: 503 })],
] as const) {
  test(`remote compaction rejects ${name} without exposing the provider body`, async () => {
    const { models, model } = await testModels();
    await assert.rejects(compactRemotely(models, model, messages, { fetch: async () => response() }), /^Error: compaction_(request_failed|response_invalid)$/);
  });
}

test("replay replaces only the exact wrapped summary and preserves later inputs without mutating stored text", () => {
  const summary = encodeCheckpoint(item);
  const later = { role: "user", content: [{ type: "input_text", text: "Continue" }] };
  const payload = { model: "gpt-6.1-sol", input: [markerMessage(summary), later] };
  assert.deepEqual(replayPayload(payload, true), { ...payload, input: [item, later] });
  assert.equal(payload.input[0]?.content[0]?.text, wrapped(summary));
  assert.deepEqual(replayPayload(payload, false), { ...payload, input: [markerMessage(`${FALLBACK}\n${FALLBACK}`), later] });
});

test("absent sentinels leave the exact payload unchanged; malformed and embedded markers degrade to readable fallback", () => {
  const payload = { input: [{ role: "user", content: [{ type: "input_text", text: "normal" }] }] };
  assert.equal(replayPayload(payload, true), payload);
  assert.equal(replayPayload(payload, false), payload);
  const malformed = { input: [markerMessage(`${FALLBACK}\n[LONGBOW_CODEX_COMPACTION_V1:broken]`)] };
  assert.deepEqual(replayPayload(malformed, true), { input: [markerMessage(`${FALLBACK}\n${FALLBACK}`)] });
  const transcript = { input: [{ role: "user", content: [{ type: "input_text", text: `Transcript: ${wrapped(encodeCheckpoint(item))}` }] }] };
  assert.ok(!JSON.stringify(replayPayload(transcript, true)).includes("LONGBOW_CODEX_COMPACTION"));
});

test("a conversation copied or switched to Meta sends only readable fallback, never the sentinel or opaque item", async () => {
  const { models, credentials } = await testModels();
  await credentials.modify("meta", async () => ({ type: "api_key", key: "test-only-key" }));
  const provider = withCompactionReplay(metaProvider());
  let sent: unknown;
  models.setProvider({ ...provider, streamSimple(model, context, options) {
    return provider.streamSimple(model, context, { ...options, fetch: async (_url, init) => {
      sent = await requestBody(init);
      return textSse();
    } });
  } });
  const meta = models.getModel("meta", "muse-spark-1.3");
  assert.ok(meta);
  const answer = await models.completeSimple(meta, { messages: [{ role: "user", content: wrapped(encodeCheckpoint(item)), timestamp: 1 }] }, { maxRetries: 0 });
  assert.equal(answer.stopReason, "stop");
  assert.ok(sent);
  const serialized = JSON.stringify(sent);
  assert.ok(serialized.includes(FALLBACK));
  assert.ok(!serialized.includes("LONGBOW_CODEX_COMPACTION"));
  assert.ok(!serialized.includes("opaque-test-only"));
});

async function populate(conversation: Conversation): Promise<void> {
  for (let index = 0; index < 3; index++) {
    const submission = await conversation.submit({ type: "write", entry: { kind: "test.history", model: [{ role: "user", content: `History ${index}: ${"portfolio ".repeat(100)}`, timestamp: index }] } }, CTX);
    await submission.wait(CTX);
  }
}

for (const scenario of ["native", "network failure", "invalid response", "meta", "other codex model", "child"] as const) {
  test(`pi-durable compaction integration: ${scenario}`, async () => {
    let triggers = 0;
    let summaries = 0;
    const { models } = await testModels(async (_url, init) => {
      const body = await requestBody(init);
      const input = body["input"];
      assert.ok(Array.isArray(input));
      if (input.at(-1)?.type === "compaction_trigger") {
        triggers++;
        if (triggers === 2) assert.deepEqual(input.filter((entry) => entry.type === "compaction"), [item], "repeated compaction must replay the prior checkpoint");
        if (scenario === "network failure") throw new Error("never log private transport details");
        if (scenario === "invalid response") return compactSse([]);
        return compactSse();
      }
      summaries++;
      assert.ok(!JSON.stringify(body).includes("LONGBOW_CODEX_COMPACTION"));
      return textSse();
    });
    // A Codex-backed test provider lets the real built-in summarizer run for another provider identity.
    if (scenario === "meta") {
      const base = models.getProvider("openai-codex");
      assert.ok(base);
      models.setProvider({ ...base, id: "meta", getModels: () => base.getModels().map((model) => ({ ...model, provider: "meta" })) });
    }
    const warnings: unknown[] = [];
    const infos: unknown[] = [];
    const log: Logger = { info: (_msg, fields) => { infos.push(fields); }, warn: (_msg, fields) => { warnings.push(fields); }, error() {}, child() { return this; } };
    const registry = createRegistry();
    registry.install(nativeCompactionExtension(log));
    const harness = await Harness.open(new MemoryStorage(), { models, registry, settings: { compaction: { enabled: false, keepRecentTokens: 50 } } }, CTX);
    try {
      const root = await harness.root(CTX, { agent: { model: scenario === "meta" ? { ...modelRef, provider: "meta" } : scenario === "other codex model" ? { ...modelRef, modelId: "gpt-5.5" } : modelRef } });
      const conversation = scenario === "child" ? await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: modelRef } }, CTX) : root;
      await populate(conversation);
      const task = await conversation.compact(undefined, CTX);
      const settled = await harness.waitForTask(task, CTX);
      assert.equal(settled.state.outcome.status, "completed", JSON.stringify(settled.state.outcome));
      const view = await conversation.context(CTX);
      const text = JSON.stringify(view.messages);
      if (scenario === "native") {
        assert.equal(triggers, 1);
        assert.equal(summaries, 0);
        assert.ok(text.includes("LONGBOW_CODEX_COMPACTION_V1"));
        assert.equal(infos.length, 1);
        await populate(conversation);
        const repeated = await harness.waitForTask(await conversation.compact(undefined, CTX), CTX);
        assert.equal(repeated.state.outcome.status, "completed");
        assert.equal(triggers, 2);
        assert.equal(summaries, 0);
        assert.equal(infos.length, 2);
      } else {
        const fallback = scenario === "network failure" || scenario === "invalid response";
        assert.equal(triggers, fallback ? 1 : 0);
        assert.equal(summaries, 1);
        assert.ok(text.includes("Regular text summary"));
        assert.ok(!text.includes("LONGBOW_CODEX_COMPACTION"));
        assert.deepEqual(warnings, fallback ? [{ reason: scenario === "network failure" ? "compaction_request_failed" : "compaction_response_invalid" }] : []);
      }
    } finally {
      await harness.close(CTX);
    }
  });
}
