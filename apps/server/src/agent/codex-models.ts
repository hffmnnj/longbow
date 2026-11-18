import type { Provider } from "@earendil-works/pi-ai/models";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

/** gpt-6.2-sol until pi-ai catalogs it; request metadata mirrors gpt-6.1-sol. */
export const CODEX_SOL_MODEL_ID = "gpt-6.2-sol";
const CODEX_SOL_FALLBACK_ID = "gpt-6.1-sol";

function hasSolModel(models: readonly { id?: string }[]): boolean {
  return models.some((model) => model.id === CODEX_SOL_MODEL_ID);
}

/**
 * Appends gpt-6.2-sol to the Codex catalog when the bundled pi-ai lacks it.
 * No-op for other providers and once pi-ai ships the model itself.
 */
export function withCodexSolModel(provider: Provider): Provider {
  if (provider.id !== "openai-codex") return provider;
  if (hasSolModel(provider.getModels())) return provider;
  // gpt-6.1-sol is a chat model, so the chat list carries everything the clone needs.
  const template = provider.getModels().find((model) => model.id === CODEX_SOL_FALLBACK_ID);
  if (template === undefined) return provider;
  const sol = { ...template, id: CODEX_SOL_MODEL_ID, name: "GPT-6.2 Sol" };
  return {
    ...provider,
    getModels: () => {
      const models = provider.getModels();
      return hasSolModel(models) ? models : [...models, sol];
    },
    ...(provider.getAllModels === undefined ? {} : {
      getAllModels: () => {
        const models = provider.getAllModels!();
        return hasSolModel(models) ? models : [...models, sol];
      },
    }),
  };
}

/** Codex provider with the gpt-6.2-sol entry when the catalog lacks it. */
export function codexProvider(): Provider {
  return withCodexSolModel(openaiCodexProvider());
}
