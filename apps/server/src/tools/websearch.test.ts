import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { createWebsearchExtension } from "./websearch.ts";

const silentLog = { info() {}, warn() {}, error() {}, child() { return silentLog; } };
const api = {} as never;
const context = { abortSignal: new AbortController().signal } as never;
function tool(ext: { tools?: readonly unknown[] }, name: string): ToolRegistration {
  const found = (ext.tools ?? []).find((item) => (item as { name: string }).name === name);
  assert.ok(found, `missing ${name}`);
  return found as ToolRegistration;
}
function text(result: { output?: readonly unknown[] }): string {
  return (result.output ?? []).map((part) => (part as { text?: string }).text ?? "").join("\n");
}
function fake(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => handler(String(input), init ?? {});
}
function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200 }); }

describe("Exa websearch", () => {
  it("exposes stable safe tools and financial scope in the search schema", async () => {
    const ext = await createWebsearchExtension({ keyFile: "/nonexistent-exa-key", getEnvKey: () => undefined, log: silentLog });
    for (const name of ["web_search", "open_page", "find_in_page"]) {
      const item = tool(ext, name);
      assert.equal(item.replay, "safe");
      assert.match(item.description ?? "", /untrusted/i);
    }
    const schema = tool(ext, "web_search").parameters as unknown as { required: string[]; properties: Record<string, unknown> };
    assert.deepEqual(schema.required, ["query"]);
    assert.ok(schema.properties["scope"]);
    assert.ok(schema.properties["allowed_domains"]);
  });

  it("uses the key file per call and requests scoped searches without broadening", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exa-test-"));
    const file = join(dir, "key");
    const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
    try {
      await writeFile(file, "first-test-key\n");
      const ext = await createWebsearchExtension({ keyFile: file, getEnvKey: () => undefined, log: silentLog, fetch: fake((url, init) => {
        requests.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return json({ results: [{ title: "ACME filing", url: "https://www.sec.gov/example", highlights: ["Revenue rose."] }, { url: "javascript:alert(1)", title: "bad" }] });
      }) });
      const search = tool(ext, "web_search");
      const first = await search.execute({ query: "ACME results" }, api, context);
      assert.match(text(first), /ACME filing\nhttps:\/\/www\.sec\.gov\/example\nRevenue rose\./);
      assert.doesNotMatch(text(first), /javascript:/);
      await writeFile(file, "second-test-key");
      await search.execute({ query: "ACME", scope: "stocks" }, api, context);
      await search.execute({ query: "ACME", scope: "filings", allowed_domains: ["www.sec.gov"] }, api, context);
      await search.execute({ query: "ACME", scope: "filings" }, api, context);
      await search.execute({ query: "ACME", allowed_domains: ["example.com"] }, api, context);
      const rejected = await search.execute({ query: "ACME", scope: "filings", allowed_domains: ["example.com"] }, api, context);
      const rejectedStocks = await search.execute({ query: "ACME", scope: "stocks", allowed_domains: ["example.com"] }, api, context);
      assert.equal(rejected.isError, true);
      assert.equal(rejectedStocks.isError, true);
      assert.equal(requests.length, 5);
      for (const request of requests) {
        assert.equal(request.url, "https://api.exa.ai/search");
        assert.equal(request.init.method, "POST");
        assert.equal(request.init.redirect, "error");
        assert.deepEqual(request.body["contents"], { highlights: { maxCharacters: 3000 } });
      }
      assert.equal((requests[0]!.init.headers as Record<string, string>)["x-api-key"], "first-test-key");
      assert.equal((requests[1]!.init.headers as Record<string, string>)["x-api-key"], "second-test-key");
      assert.deepEqual(requests[1]!.body["includeDomains"], ["exa.ai/library/markets/stocks"]);
      assert.deepEqual(requests[2]!.body["includeDomains"], ["www.sec.gov"]);
      assert.equal(requests[2]!.body["category"], "financial report");
      assert.deepEqual(requests[3]!.body["includeDomains"], ["sec.gov"]);
      assert.equal(requests[3]!.body["category"], "financial report");
      assert.deepEqual(requests[4]!.body["includeDomains"], ["example.com"]);
    } finally { await unlink(file); await rmdir(dir); }
  });

  it("sends page URLs only to Exa and searches available text case-insensitively", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ext = await createWebsearchExtension({ keyFile: "/missing", getEnvKey: () => "test-key", log: silentLog, fetch: fake((url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return json({ results: [{ url: "https://example.com/report", text: "Quarterly REVENUE increased. More revenue ahead." }] });
    }) });
    const opened = await tool(ext, "open_page").execute({ url: "https://example.com/report" }, api, context);
    assert.match(text(opened), /Quarterly REVENUE increased/);
    const found = await tool(ext, "find_in_page").execute({ url: "https://example.com/report", pattern: "revenue" }, api, context);
    assert.match(text(found), /REVENUE increased/);
    assert.match(text(found), /may be incomplete/);
    const missing = await tool(ext, "find_in_page").execute({ url: "https://example.com/report", pattern: "absent" }, api, context);
    assert.match(text(missing), /No matches in retrieved text/);
    for (const url of ["file:///etc/passwd", "http://127.0.0.1/private", "https://user:pass@example.com/", "not a url"]) {
      assert.equal((await tool(ext, "open_page").execute({ url }, api, context)).isError, true);
    }
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], { url: "https://api.exa.ai/contents", body: { ids: ["https://example.com/report"], text: { maxCharacters: 50000 } } });
  });

  it("reports absent configuration and unavailable content honestly", async () => {
    let calls = 0;
    const fetch = fake(() => { calls++; return json({ results: [] }); });
    const missing = await createWebsearchExtension({ keyFile: "/nonexistent-exa-key", getEnvKey: () => undefined, log: silentLog, fetch });
    for (const [name, args] of [["web_search", { query: "test" }], ["open_page", { url: "https://example.com" }], ["find_in_page", { url: "https://example.com", pattern: "x" }]] as const) {
      const result = await tool(missing, name).execute(args, api, context);
      assert.equal(result.isError, true);
      assert.match(text(result), /not configured/i);
    }
    assert.equal(calls, 0);
    const configured = await createWebsearchExtension({ keyFile: "/missing", getEnvKey: () => "test-key", log: silentLog, fetch });
    const result = await tool(configured, "open_page").execute({ url: "https://example.com" }, api, context);
    assert.equal(result.isError, true);
    assert.match(text(result), /unavailable/i);
  });

  it("reports status without leaking response bodies, secrets, or retries", async () => {
    for (const [status, description] of [[401, /key.*401/i], [402, /payment.*402/i], [429, /rate limit.*429/i]] as const) {
      let calls = 0;
      const ext = await createWebsearchExtension({ keyFile: "/missing", getEnvKey: () => "secret-test-key", log: silentLog, fetch: fake(() => {
        calls++; return new Response("secret-test-key private provider details", { status });
      }) });
      const result = await tool(ext, "web_search").execute({ query: "test" }, api, context);
      assert.equal(result.isError, true);
      assert.match(text(result), description);
      assert.doesNotMatch(text(result), /secret-test-key|private provider details/);
      assert.equal(calls, 1);
    }
  });

  it("prefers the environment key and bounds malformed or oversized provider responses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exa-test-"));
    const file = join(dir, "key");
    try {
      await writeFile(file, "file-key");
      let calls = 0;
      const ext = await createWebsearchExtension({ keyFile: file, getEnvKey: () => "env-key", log: silentLog, fetch: fake((_url, init) => {
        assert.equal((init.headers as Record<string, string>)["x-api-key"], "env-key");
        calls++;
        return calls === 1 ? new Response("not-json") : new Response("x".repeat(2_000_001));
      }) });
      const search = tool(ext, "web_search");
      for (let i = 0; i < 2; i++) {
        const result = await search.execute({ query: "test" }, api, context);
        assert.equal(result.isError, true);
        assert.match(text(result), /invalid response/i);
        assert.doesNotMatch(text(result), /env-key|file-key|not-json/);
      }
      assert.equal(calls, 2);
    } finally { await unlink(file); await rmdir(dir); }
  });

  it("honors cancellation without retrying a paid request", async () => {
    let calls = 0;
    const controller = new AbortController();
    const ext = await createWebsearchExtension({ keyFile: "/missing", getEnvKey: () => "test-key", log: silentLog, fetch: fake(async (_url, init) => {
      calls++;
      controller.abort();
      assert.equal(init.signal?.aborted, true);
      throw new Error("untrusted error");
    }) });
    const result = await tool(ext, "web_search").execute({ query: "test" }, api, { abortSignal: controller.signal } as never);
    assert.equal(result.isError, true);
    assert.match(text(result), /cancelled/i);
    assert.equal(calls, 1);
  });
});
