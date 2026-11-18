import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { CODEX_SOL_MODEL_ID, codexProvider, withCodexSolModel } from "./codex-models.ts";

describe("codex 6.2-sol catalog shim", () => {
  it("appends gpt-6.2-sol cloned from gpt-6.1-sol when the catalog lacks it", () => {
    const provider = codexProvider();
    const sol = provider.getModels().find((model) => model.id === CODEX_SOL_MODEL_ID);
    assert.ok(sol, "gpt-6.2-sol resolves through pi-ai Models");
    assert.equal(sol.api, "openai-codex-responses");
    const previous = provider.getModels().find((model) => model.id === "gpt-6.1-sol");
    assert.ok(previous);
    assert.equal(sol.provider, previous.provider);
  });

  it("leaves providers with the model or from another provider untouched", () => {
    const base = openaiCodexProvider();
    if (base.getModels().some((model) => model.id === CODEX_SOL_MODEL_ID)) {
      assert.equal(withCodexSolModel(base), base, "no-op once pi-ai ships the model");
    }
    const other = { ...base, id: "meta" };
    assert.equal(withCodexSolModel(other), other);
  });
});
