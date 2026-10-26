import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { createWebsearchExtension } from "./websearch.ts";

const silentLog = {
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLog;
  },
} as const;

function toolByName(ext: { tools?: readonly unknown[] }, name: string): ToolRegistration {
  const tool = (ext.tools ?? []).find((t) => (t as { name: string }).name === name);
  assert.ok(tool, `expected tool ${name}`);
  return tool as unknown as ToolRegistration;
}

function schemaOf(tool: ToolRegistration): { properties?: Record<string, unknown>; required?: string[] } {
  return tool.parameters as unknown as { properties?: Record<string, unknown>; required?: string[] };
}

const api = {} as never;
const context = { abortSignal: new AbortController().signal } as never;

describe("websearch extension without configuration", () => {
  it("loads_with_a_missing_config_file", async () => {
    const ext = await createWebsearchExtension({
      configFile: "/nonexistent-dir-xyz/opencode.json",
      log: silentLog as never,
    });
    assert.equal(ext.name, "websearch");
    for (const name of ["web_search", "open_page", "find_in_page"]) {
      const tool = toolByName(ext, name);
      assert.equal(tool.replay, "safe");
    }
  });

  it("tools_return_a_not_configured_error_result", async () => {
    const ext = await createWebsearchExtension({
      configFile: "/nonexistent-dir-xyz/opencode.json",
      log: silentLog as never,
    });
    const webSearch = toolByName(ext, "web_search");
    const openPage = toolByName(ext, "open_page");
    const findInPage = toolByName(ext, "find_in_page");

    for (const result of [
      await webSearch.execute({ query: "S&P 500 futures" }, api, context),
      await openPage.execute({ url: "https://example.com" }, api, context),
      await findInPage.execute({ url: "https://example.com", pattern: "earnings" }, api, context),
    ]) {
      assert.equal(result.isError, true);
      const text = (result.output ?? []).map((part) => (part as { text?: string }).text ?? "").join("\n");
      assert.match(text, /not configured/i);
    }
  });

  it("parameter_schemas_mirror_the_remote_tools", async () => {
    const ext = await createWebsearchExtension({
      configFile: "/nonexistent-dir-xyz/opencode.json",
      log: silentLog as never,
    });
    const search = schemaOf(toolByName(ext, "web_search"));
    assert.deepEqual(search.required, ["query"]);
    for (const param of [
      "query",
      "context_size",
      "mode",
      "allowed_domains",
      "content_types",
      "country",
      "region",
      "city",
      "timezone",
      "reasoning_effort",
    ]) {
      assert.ok(param in (search.properties ?? {}), `web_search missing param ${param}`);
    }
    assert.deepEqual(Object.keys(schemaOf(toolByName(ext, "open_page")).properties ?? {}), ["url"]);
    assert.deepEqual(Object.keys(schemaOf(toolByName(ext, "find_in_page")).properties ?? {}).sort(), ["pattern", "url"]);
  });
});
