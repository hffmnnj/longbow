import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

/**
 * Persistent file-backed pi-ai CredentialStore.
 *
 * JSON at `${DATA_DIR}/credentials/pi-credentials.json`, directory mode 0700,
 * file mode 0600, atomic writes via temp file + rename. Writes are serialized
 * per provider id through a promise chain, like InMemoryCredentialStore.
 * Never logs credential values (this module logs nothing at all).
 */

export function credentialFilePath(dataDir: string): string {
  return join(dataDir, "credentials", "pi-credentials.json");
}

function isCredential(value: unknown): value is Credential {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "api_key" || type === "oauth";
}

export class FileCredentialStore implements CredentialStore {
  readonly filePath: string;
  private chains = new Map<string, Promise<unknown>>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    const signal = options?.signal;
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const queued = (async () => {
      await previous.catch(() => {});
      signal?.throwIfAborted();
      return task();
    })();
    const tail = queued.catch(() => {});
    this.chains.set(providerId, tail);
    void tail.then(() => {
      if (this.chains.get(providerId) === tail) this.chains.delete(providerId);
    });
    return queued;
  }

  /**
   * Always read fresh: the file can change under us (the ops seed script or
   * another process writes it), and a stale cache would pin `needs_login`
   * until restart. Reads are infrequent and the file is tiny.
   */
  private async load(): Promise<Map<string, Credential>> {
    const parsed = new Map<string, Credential>();
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return parsed;
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`Credential file at ${this.filePath} is not valid JSON`);
    }
    if (typeof json === "object" && json !== null) {
      for (const [providerId, value] of Object.entries(json as Record<string, unknown>)) {
        if (isCredential(value)) parsed.set(providerId, value);
      }
    }
    return parsed;
  }

  private async persist(credentials: Map<string, Credential>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(credentials), null, 2), { mode: 0o600 });
    await rename(tmp, this.filePath);
    // Enforce 0600 even when the file already existed with wider permissions.
    await chmod(this.filePath, 0o600);
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return (await this.load()).get(providerId);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return [...(await this.load())].map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(
      providerId,
      async () => {
        const credentials = await this.load();
        const current = credentials.get(providerId);
        const next = await fn(current);
        options?.signal?.throwIfAborted();
        if (next !== undefined) {
          credentials.set(providerId, next);
          await this.persist(credentials);
          return next;
        }
        return current;
      },
      options,
    );
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(
      providerId,
      async () => {
        const credentials = await this.load();
        if (credentials.delete(providerId)) await this.persist(credentials);
      },
      options,
    );
  }
}

interface MuseAuthFile {
  providers?: { meta?: { access_token?: unknown; api_key?: unknown } };
}

/**
 * Seed the `meta` credential from a Muse CLI auth.json: the non-renewable
 * identity token (`providers.meta.access_token`) becomes `refresh`, the API
 * key (`providers.meta.api_key`) becomes `access`, `expires: 0` forces pi-ai
 * to re-mint on first use. Rejects with a safe message (never values).
 */
export async function seedMetaCredential(authPath: string, dataDir: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(authPath, "utf-8");
  } catch {
    throw new Error(`Cannot read Muse auth file at ${authPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Muse auth file at ${authPath} is not valid JSON`);
  }
  const meta = (parsed as MuseAuthFile | null)?.providers?.meta;
  const refresh = meta?.access_token;
  const access = meta?.api_key;
  if (typeof refresh !== "string" || refresh === "" || typeof access !== "string" || access === "") {
    throw new Error("Muse auth file has no usable providers.meta credentials (need access_token and api_key)");
  }
  const store = new FileCredentialStore(credentialFilePath(dataDir));
  await store.modify("meta", async () => ({ type: "oauth", refresh, access, expires: 0 }));
}

/** True when the auth file at `authPath` is newer than the seeded `meta` credential. */
export async function isAuthFileNewer(authPath: string, dataDir: string): Promise<boolean> {
  try {
    const [authStat, credStat] = await Promise.all([stat(authPath), stat(credentialFilePath(dataDir))]);
    return authStat.mtimeMs > credStat.mtimeMs;
  } catch {
    return false;
  }
}

/** True when an error looks like a dead Muse session (mint 401/403, expired identity). */
export function isAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/(^|[^0-9])(401|403)([^0-9]|$)/.test(message)) return true;
  if (/session expired|needs re-?login|sign in again|invalid_grant|unauthorized|expired token/i.test(message)) {
    return true;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "oauth") return true;
  return false;
}
