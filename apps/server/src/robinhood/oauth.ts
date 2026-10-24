import { randomBytes } from "node:crypto";
import { McpOAuthProvider, authorizeMcp, type McpOAuthStateStore, type OAuthFlowOptions } from "@earendil-works/pi-mcp/oauth";
import type { Clock } from "../ports.ts";

export const MCP_URL = "https://agent.robinhood.com/mcp/trading";
export const DISCOVERY = {
  authorizationServerUrl: "https://robinhood.com",
  authorizationServerMetadata: {
    issuer: "https://robinhood.com", authorization_endpoint: "https://robinhood.com/oauth",
    token_endpoint: "https://api.robinhood.com/oauth2/token/",
    registration_endpoint: "https://agent.robinhood.com/oauth/trading/register",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
    scopes_supported: ["internal"],
  },
  resourceMetadata: { resource: MCP_URL, authorization_servers: ["https://robinhood.com"], scopes_supported: ["internal"] },
};

class EphemeralProvider extends McpOAuthProvider {
  private verifier?: string;
  override async state(): Promise<string> { return randomBytes(32).toString("hex"); }
  override async saveCodeVerifier(verifier: string): Promise<void> { this.verifier = verifier; }
  override async codeVerifier(): Promise<string> {
    if (!this.verifier) throw new Error("Missing Robinhood PKCE verifier");
    return this.verifier;
  }
  clearVerifier(): void { this.verifier = undefined; }
}

export type Authorize = typeof authorizeMcp;
export class RobinhoodOAuth {
  readonly provider: EphemeralProvider;
  private readonly pending = new Map<string, { verifier: string; expires: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private redirect?: URL;
  private allowRedirect = false;
  private readonly clock: Clock;
  private readonly authorize: Authorize;
  private readonly options: OAuthFlowOptions;

  constructor(options: { store: McpOAuthStateStore; redirectUrl: string; clock: Clock; authorize?: Authorize }) {
    this.clock = options.clock;
    this.authorize = options.authorize ?? authorizeMcp;
    this.options = { serverUrl: MCP_URL, scope: "internal" };
    this.provider = new EphemeralProvider({
      serverUrl: MCP_URL, redirectUrl: options.redirectUrl, store: options.store,
      clientMetadata: { client_name: "Robinhood Harness", token_endpoint_auth_method: "none", scope: "internal" },
      onRedirect: (url) => {
        if (!this.allowRedirect) throw new Error("Robinhood sign-in required");
        if (url.origin !== "https://robinhood.com" || url.pathname !== "/oauth") throw new Error("Invalid authorization endpoint");
        this.redirect = url;
      },
    });
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private async run(options: Partial<OAuthFlowOptions> = {}) {
    // Pin the verified endpoints; neither persisted nor remote discovery may redirect credentials.
    await this.provider.saveDiscoveryState(DISCOVERY);
    return this.authorize(this.provider, { ...this.options, ...options, signal: AbortSignal.timeout(30_000) });
  }
  private authorizationRedirect(): URL | undefined { return this.redirect; }
  beginConnect(): Promise<string> {
    return this.exclusive(async () => {
      this.allowRedirect = true;
      this.redirect = undefined;
      try {
        await this.run({ skipRefresh: true });
        const url = this.authorizationRedirect();
        if (!url?.searchParams.get("state")) throw new Error("Missing OAuth state");
        for (const [state, pending] of this.pending) if (pending.expires <= this.clock.now()) this.pending.delete(state);
        if (this.pending.size >= 20) this.pending.delete(this.pending.keys().next().value!);
        this.pending.set(url.searchParams.get("state")!, { verifier: await this.provider.codeVerifier(), expires: this.clock.now() + 600_000 });
        return url.href;
      } catch { throw new Error("Unable to start Robinhood sign-in"); }
      finally { this.allowRedirect = false; this.provider.clearVerifier(); }
    });
  }
  completeConnect(params: URLSearchParams): Promise<void> {
    return this.exclusive(async () => {
      const state = params.get("state");
      const pending = state ? this.pending.get(state) : undefined;
      if (state) this.pending.delete(state); // Consume before any await, including unsuccessful exchanges.
      if (!pending || pending.expires <= this.clock.now()) throw new Error("Invalid or expired Robinhood OAuth state");
      if (params.get("error") || !params.get("code") || params.getAll("code").length !== 1 || params.getAll("state").length !== 1) {
        throw new Error("Robinhood authorization was not completed");
      }
      try {
        await this.provider.saveCodeVerifier(pending.verifier);
        const result = await this.run({ authorizationCode: params.get("code")!, iss: params.get("iss") ?? undefined });
        if (result !== "AUTHORIZED") throw new Error("Authorization incomplete");
      } catch { throw new Error("Unable to complete Robinhood sign-in"); }
      finally { this.provider.clearVerifier(); }
    });
  }
  refresh(): Promise<void> {
    return this.exclusive(async () => {
      try {
        if (!(await this.provider.tokens())?.refresh_token || await this.run() !== "AUTHORIZED") throw new Error("No refresh grant");
      } catch {
        await this.provider.invalidateCredentials("tokens");
        throw new Error("Robinhood sign-in required");
      } finally { this.provider.clearVerifier(); }
    });
  }
  clear(): Promise<void> {
    return this.exclusive(async () => { this.pending.clear(); this.provider.clearVerifier(); await this.provider.invalidateCredentials("tokens"); });
  }
}
