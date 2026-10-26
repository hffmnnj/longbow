import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai/models";
import { isRecord, replayPayload, validateItem, type CompactionItem } from "./checkpoint.ts";

export function isNativeModel(model: { provider: string; id?: string; modelId?: string } | undefined): boolean {
  return model?.provider === "openai-codex" && (model.id ?? model.modelId) === "gpt-6.1-sol";
}

/** Use pi-ai's request construction, OAuth refresh, SSE parser and cancellation rather than duplicating them. */
export async function compactRemotely(
  models: Pick<Models, "streamSimple">,
  model: Model<Api>,
  messages: readonly Message[],
  options: Pick<ModelsSimpleStreamOptions, "fetch" | "signal"> = {},
): Promise<CompactionItem> {
  if (!isNativeModel(model)) throw new Error("unsupported_model");
  const timeout = AbortSignal.timeout(120_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const items = new Map<string, CompactionItem>();
  let completed = false;
  let bytes = 0;
  const collect = (candidate: unknown): void => {
    if (!isRecord(candidate) || candidate["type"] !== "compaction") return;
    const item = validateItem(candidate);
    items.set(JSON.stringify(item), item);
    if (items.size > 1) throw new Error("multiple_compaction_items");
  };
  const events = models.streamSimple(model, { messages: [...messages] }, {
    ...options,
    signal,
    transport: "sse",
    cacheRetention: "none",
    timeoutMs: 120_000,
    maxRetries: 0,
    onPayload(payload) {
      const expanded = replayPayload(payload, true);
      if (!isRecord(expanded) || !Array.isArray(expanded["input"])) throw new Error("invalid_compaction_payload");
      return { ...expanded, input: [...expanded["input"], { type: "compaction_trigger" }] };
    },
    onProviderStreamEvent(event) {
      bytes += Buffer.byteLength(JSON.stringify(event));
      if (bytes > 8 * 1024 * 1024) throw new Error("compaction_response_too_large");
      if (!isRecord(event)) throw new Error("invalid_compaction_event");
      const type = event["type"];
      if (["error", "response.failed", "response.incomplete", "response.cancelled"].includes(String(type))) throw new Error("compaction_provider_failure");
      if (type === "response.output_item.done") collect(event["item"]);
      if (type === "response.completed" || type === "response.done") {
        const response = event["response"];
        if (!isRecord(response) || (response["status"] !== undefined && response["status"] !== "completed")) throw new Error("invalid_compaction_completion");
        if (Array.isArray(response["output"])) for (const item of response["output"]) collect(item);
        completed = true;
      }
    },
  });
  // Never propagate provider error strings: they may contain response bodies or credentials.
  for await (const event of events) if (event.type === "error") throw new Error("compaction_request_failed");
  signal.throwIfAborted();
  const item = items.values().next().value;
  if (!completed || items.size !== 1 || item === undefined) throw new Error("compaction_response_invalid");
  return item;
}
