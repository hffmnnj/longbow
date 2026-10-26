import type { ProviderRequestOptions } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import { AgentDoc, CompactionTask, ROOT_CONVERSATION_ID, hook, type CompactionHooks, type Extension } from "@earendil-works/pi-durable";
import type { Logger } from "../ports.ts";
import { encodeCheckpoint, replayPayload } from "./checkpoint.ts";
import { compactRemotely, isNativeModel } from "./remote.ts";

/** pi-durable's durable stream settings cannot store callbacks; install them at the provider boundary. */
function replayOptions<T extends ProviderRequestOptions | undefined>(options: T) {
  const onPayload: NonNullable<ProviderRequestOptions["onPayload"]> = async (payload, model) => {
    const next = await options?.onPayload?.(payload, model) ?? payload;
    return replayPayload(next, isNativeModel(model));
  };
  return Object.assign({}, options, { onPayload });
}

export function withCompactionReplay(provider: Provider): Provider {
  return {
    ...provider,
    stream(model, context, options) {
      return provider.stream(model, context, replayOptions(options));
    },
    streamSimple(model, context, options) {
      return provider.streamSimple(model, context, replayOptions(options));
    },
  };
}

export function nativeCompactionHook(log: Logger): CompactionHooks["beforeCompact"] {
  return async (compaction, api, context) => {
    // Children inherit extensions, but must always use pi-durable's regular text compaction.
    if (api.conversationId !== ROOT_CONVERSATION_ID) return undefined;
    try {
      const agent = await api.snapshot(AgentDoc, api.conversationId, context);
      if (!isNativeModel(agent?.model)) return undefined;
      const model = api.models.getModel("openai-codex", "gpt-6.1-sol");
      if (model === undefined) throw new Error("model_unavailable");
      const messages = compaction.instructions === undefined ? compaction.messages : [
        ...compaction.messages,
        { role: "user" as const, content: compaction.instructions, timestamp: Date.now() },
      ];
      const item = await compactRemotely(api.models, model, messages, { signal: context.abortSignal });
      const summary = encodeCheckpoint(item);
      log.info("native Codex compaction", { messages: compaction.messages.length, itemBytes: Buffer.byteLength(JSON.stringify(item)) });
      return { summary };
    } catch (error) {
      const safeReasons = ["model_unavailable", "compaction_request_failed", "compaction_response_invalid", "invalid_compaction_item"];
      const reason = error instanceof Error && safeReasons.includes(error.message) ? error.message : "native_request_or_checkpoint_failed";
      log.warn("native Codex compaction fell back to text", { reason });
      // In pi-durable 1.3, { decline: true } CANCELS compaction; undefined invokes the built-in summarizer.
      return undefined;
    }
  };
}

export function nativeCompactionExtension(log: Logger): Extension {
  return { name: "longbow.native-codex-compaction", hooks: [hook(CompactionTask, { beforeCompact: nativeCompactionHook(log) })] };
}
