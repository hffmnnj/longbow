import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { McpOAuthState, McpOAuthStateStore } from "@earendil-works/pi-mcp/oauth";

export async function privateWrite(directory: string, name: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = join(directory, `.${name}.${randomUUID()}`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, join(directory, name));
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

/** PKCE and callback state are intentionally never serialized. */
export class TokenStore implements McpOAuthStateStore {
  readonly directory: string;
  private writes: Promise<void> = Promise.resolve();
  constructor(dataDirectory: string) { this.directory = join(dataDirectory, "robinhood"); }
  async load(): Promise<McpOAuthState | undefined> {
    await this.writes;
    try {
      await chmod(this.directory, 0o700);
      await chmod(join(this.directory, "oauth.json"), 0o600);
      const value: unknown = JSON.parse(await readFile(join(this.directory, "oauth.json"), "utf8"));
      if (!value || typeof value !== "object" || !("serverUrl" in value) || typeof value.serverUrl !== "string") {
        throw new Error("Invalid stored Robinhood credentials");
      }
      return value as McpOAuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Unable to read Robinhood credentials");
    }
  }
  save(state: McpOAuthState): Promise<void> {
    const { codeVerifier: _verifier, oauthState: _state, ...durable } = structuredClone(state);
    const write = this.writes.then(() => privateWrite(this.directory, "oauth.json", durable));
    this.writes = write.catch(() => {});
    return write;
  }
}
