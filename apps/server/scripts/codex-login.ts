// One-off: device-code ChatGPT (Codex) login into the harness credential store.
import { writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { FileCredentialStore, credentialFilePath } from "../src/agent/credential-store.ts";

const dataDir = process.env.DATA_DIR ?? join(homedir(), ".local", "share", "robinhood-harness");
const status = join(tmpdir(), "codex-login-status.txt");
const models = createModels({ credentials: new FileCredentialStore(credentialFilePath(dataDir)) });
const provider = openaiCodexProvider();
models.setProvider(provider);
await models.login(provider.id, "oauth", {
  prompt: async (p) => {
    if (p.type === "select") return p.options.find((o) => /device/i.test(o.id + o.label))!.id;
    throw new Error(`unexpected prompt ${p.type}`);
  },
  notify: (event) => {
    if (event.type === "device_code") writeFileSync(status, `URL ${event.verificationUri}\nCODE ${event.userCode}\nEXPIRES ${event.expiresInSeconds}s\n`);
  },
}, { agentName: "robinhood-harness" });
writeFileSync(status, `DONE provider=${provider.id}\n`, { flag: "a" });
