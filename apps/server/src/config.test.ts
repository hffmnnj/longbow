import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parseModelSpec } from "./config.ts";

describe("loadConfig", () => {
  it("returns defaults with an empty env", () => {
    const config = loadConfig({});
    assert.equal(config.PORT, 4520);
    assert.deepEqual(config.HOSTS, ["127.0.0.1"]);
    assert.equal(config.PUBLIC_URL, "http://127.0.0.1:4520");
    assert.deepEqual(config.MAIN_MODEL, { provider: "openai-codex", modelId: "gpt-6.1-sol", thinkingLevel: "xhigh" });
    assert.deepEqual(config.SUBAGENT_MODEL, { provider: "meta", modelId: "muse-spark-1.3-contributor", thinkingLevel: "xhigh" });
    assert.equal(config.ROBINHOOD_MCP_URL, "https://agent.robinhood.com/mcp/trading");
    assert.match(config.DATA_DIR, /robinhood-harness$/);
    assert.match(config.MUSE_AUTH_FILE, /muse\/auth\.json$/);
    assert.match(config.WEBSEARCH_CONFIG_FILE, /opencode\.json$/);
    assert.match(config.WEB_DIR, /apps\/web\/build$/);
  });

  it("appends the Tailnet host when set", () => {
    const config = loadConfig({ HARNESS_TAILNET_HOST: "100.101.102.103" });
    assert.deepEqual(config.HOSTS, ["127.0.0.1", "100.101.102.103"]);
  });

  it("lets same-named env vars override every field", () => {
    const config = loadConfig({
      PORT: "4599",
      PUBLIC_URL: "http://example.ts.net:4599",
      DATA_DIR: "/tmp/rh-data",
      MAIN_MODEL: "meta/other-model#low",
      MUSE_AUTH_FILE: "/tmp/auth.json",
      WEBSEARCH_CONFIG_FILE: "/tmp/opencode.json",
      ROBINHOOD_MCP_URL: "https://example.com/mcp",
      WEB_DIR: "/tmp/web",
    });
    assert.equal(config.PORT, 4599);
    assert.equal(config.PUBLIC_URL, "http://example.ts.net:4599");
    assert.equal(config.DATA_DIR, "/tmp/rh-data");
    assert.deepEqual(config.MAIN_MODEL, { provider: "meta", modelId: "other-model", thinkingLevel: "low" });
    assert.equal(config.MUSE_AUTH_FILE, "/tmp/auth.json");
    assert.equal(config.WEBSEARCH_CONFIG_FILE, "/tmp/opencode.json");
    assert.equal(config.ROBINHOOD_MCP_URL, "https://example.com/mcp");
    assert.equal(config.WEB_DIR, "/tmp/web");
  });

  it("falls back on blank or non-numeric PORT", () => {
    assert.equal(loadConfig({ PORT: "" }).PORT, 4520);
    assert.equal(loadConfig({ PORT: "nope" }).PORT, 4520);
  });

  it("parses model specs and rejects malformed ones", () => {
    assert.deepEqual(parseModelSpec("openai-codex/gpt-6.1-sol"), { provider: "openai-codex", modelId: "gpt-6.1-sol", thinkingLevel: "high" });
    assert.throws(() => parseModelSpec("gpt-6.1-sol#xhigh"), /provider\/model/);
    assert.throws(() => parseModelSpec("meta/muse#extreme"), /thinking level/);
  });
});
