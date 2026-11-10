import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { createMuseProvider } from "pi-muse-code-adapter";
import { withCompactionReplay } from "../compaction/index.ts";
import { credentialFilePath, FileCredentialStore, seedMetaCredential } from "./credential-store.ts";

async function removeIfPresent(action: () => Promise<void>): Promise<void> {
  try { await action(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

test("the meta adapter refreshes seeded credentials and sends the minted key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "longbow-muse-test-"));
  const originalFetch = globalThis.fetch;
  try {
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify({ providers: { meta: { access_token: "identity", api_key: "old-key" } } }));
    await seedMetaCredential(authPath, dir);
    const credentials = new FileCredentialStore(credentialFilePath(dir));
    const requests: string[] = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.url);
      if (request.url === "https://api.meta.ai/muse-code/key") {
        assert.equal(request.headers.get("authorization"), "Bearer identity");
        return Response.json({ api_key: "minted-key" });
      }
      assert.equal(request.url, "https://api.meta.ai/v1/responses");
      assert.equal(request.headers.get("authorization"), "Bearer minted-key");
      const text = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] };
      const events = [
        { type: "response.output_item.added", output_index: 0, item: text },
        { type: "response.output_text.delta", output_index: 0, delta: "ok" },
        { type: "response.output_item.done", output_index: 0, item: text },
        { type: "response.completed", response: { id: "resp_1", status: "completed", output: [text], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    };
    const models = createModels({ credentials });
    models.setProvider(withCompactionReplay(createMuseProvider({ providerId: "meta", useCliAuth: false, authPath })));
    const model = models.getModel("meta", "muse-spark-1.3-contributor");
    assert.ok(model);
    const stream = models.streamSimple(model, { messages: [{ role: "user", content: "Hello", timestamp: 1 }] });
    for await (const _event of stream) { /* drain */ }
    const result = await stream.result();
    assert.equal(result.stopReason, "stop");
    assert.ok(result.content.some((part) => part.type === "text" && part.text === "ok"));
    assert.deepEqual(requests, ["https://api.meta.ai/muse-code/key", "https://api.meta.ai/v1/responses"]);
    const refreshed = await credentials.read("meta");
    assert.equal(refreshed?.type, "oauth");
    if (refreshed?.type !== "oauth") throw new Error("Expected OAuth credential");
    assert.equal(refreshed.refresh, "identity");
    assert.equal(refreshed.access, "minted-key");
    assert.ok(refreshed.expires > Date.now());
  } finally {
    globalThis.fetch = originalFetch;
    await removeIfPresent(() => unlink(join(dir, "auth.json")));
    await removeIfPresent(() => unlink(credentialFilePath(dir)));
    await removeIfPresent(() => rmdir(join(dir, "credentials")));
    await rmdir(dir);
  }
});

test("the meta adapter does not use ambient CLI credentials when the store is empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "longbow-muse-test-"));
  try {
    const authPath = join(dir, "auth.json");
    await writeFile(authPath, JSON.stringify({ providers: { meta: { mechanism: "oauth", access_token: "identity" } } }));
    let requested = false;
    const models = createModels({ credentials: new FileCredentialStore(credentialFilePath(dir)) });
    models.setProvider(withCompactionReplay(createMuseProvider({ providerId: "meta", useCliAuth: false, authPath, fetch: async () => { requested = true; throw new Error("Unexpected request"); } })));
    const model = models.getModel("meta", "muse-spark-1.3-contributor");
    assert.ok(model);
    const stream = models.streamSimple(model, { messages: [{ role: "user", content: "Hello", timestamp: 1 }] });
    for await (const _event of stream) { /* drain */ }
    assert.equal((await stream.result()).stopReason, "error");
    assert.equal(requested, false);
  } finally {
    await removeIfPresent(() => unlink(join(dir, "auth.json")));
    await rmdir(dir);
  }
});
