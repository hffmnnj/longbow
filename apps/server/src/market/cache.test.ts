import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock, Logger } from "../ports.ts";
import { MarketCache, MarketError } from "./cache.ts";

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
};

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "market-cache-"));
  let now = 1_790_000_000_000;
  const clock: Clock = { now: () => now };
  const advance = (ms: number): void => {
    now += ms;
  };
  return { dataDir, clock, advance };
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (url: unknown) => handler(String(url))) as typeof fetch;
}

describe("MarketCache.getOrFetch", () => {
  it("caches_within_ttl_and_refetches_after", async () => {
    const { dataDir, clock, advance } = setup();
    const cache = new MarketCache(dataDir, silent, clock);
    let calls = 0;
    const load = (): Promise<string> => {
      calls++;
      return Promise.resolve(`v${calls}`);
    };
    assert.equal(await cache.getOrFetch("k", 60_000, load), "v1");
    assert.equal(await cache.getOrFetch("k", 60_000, load), "v1");
    assert.equal(calls, 1);
    advance(61_000);
    assert.equal(await cache.getOrFetch("k", 60_000, load), "v2");
    assert.equal(calls, 2);
  });
  it("deduplicates_concurrent_identical_requests", async () => {
    const { dataDir, clock } = setup();
    const cache = new MarketCache(dataDir, silent, clock);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const load = async (): Promise<string> => {
      calls++;
      await gate;
      return "shared";
    };
    const pending = Promise.all([
      cache.getOrFetch("k", 60_000, load),
      cache.getOrFetch("k", 60_000, load),
    ]);
    while (calls === 0) await new Promise((r) => setTimeout(r, 1));
    release();
    const [a, b] = await pending;
    assert.equal(a, "shared");
    assert.equal(b, "shared");
    assert.equal(calls, 1);
  });
});

describe("MarketCache.fetchText", () => {
  it("retries_once_on_5xx_then_returns_text", async () => {
    const { dataDir, clock } = setup();
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls++;
      return calls === 1 ? new Response("oops", { status: 500 }) : new Response("fine", { status: 200 });
    });
    const cache = new MarketCache(dataDir, silent, clock, fetchImpl);
    assert.equal(await cache.fetchText("https://example.com/x"), "fine");
    assert.equal(calls, 2);
  });
  it("fails_short_on_404_without_a_body", async () => {
    const { dataDir, clock } = setup();
    const fetchImpl = fakeFetch(() => new Response("secret body", { status: 404 }));
    const cache = new MarketCache(dataDir, silent, clock, fetchImpl);
    const error = await cache.fetchText("https://example.com/missing/nasdaq").catch((e: unknown) => e);
    assert.ok(error instanceof MarketError);
    assert.equal(error.code, "bad_response");
    assert.ok(!error.message.includes("secret body"));
  });
  it("wraps_repeated_network_failures", async () => {
    const { dataDir, clock } = setup();
    const fetchImpl = fakeFetch(() => Promise.reject(new Error("boom")));
    const cache = new MarketCache(dataDir, silent, clock, fetchImpl);
    const error = await cache.fetchText("https://example.com/down").catch((e: unknown) => e);
    assert.ok(error instanceof MarketError);
    assert.equal(error.code, "network");
  });
});
