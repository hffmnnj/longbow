import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativeApp, nativeCall } from "./native.ts";

interface FakeWindow {
  LongbowBridge?: { postMessage: (message: string) => void };
  __longbowReply?: (id: number, json: string) => void;
  matchMedia?: (query: string) => { matches: boolean };
}

function stubWindow(fake: FakeWindow): string[] {
  const sent: string[] = [];
  const channel = fake.LongbowBridge
    ? {
        postMessage:
          typeof fake.LongbowBridge.postMessage === "function"
            ? (message: string) => {
                sent.push(message);
              }
            : fake.LongbowBridge.postMessage,
      }
    : undefined;
  vi.stubGlobal("window", { ...fake, LongbowBridge: channel });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isNativeApp", () => {
  it("is false with no channel and true with a posting channel", () => {
    stubWindow({});
    expect(isNativeApp()).toBe(false);
    stubWindow({ LongbowBridge: { postMessage: () => {} } });
    expect(isNativeApp()).toBe(true);
  });

  it("is false when postMessage is not a function", () => {
    stubWindow({ LongbowBridge: { postMessage: undefined as unknown as (m: string) => void } });
    expect(isNativeApp()).toBe(false);
  });
});

describe("nativeCall", () => {
  it("posts { id, method, args } and resolves with the replied value", async () => {
    const sent = stubWindow({ LongbowBridge: { postMessage: () => {} } });
    const call = nativeCall<string>("copy", { text: "https://x/?report=r1" });
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]!) as { id: number; method: string; args: Record<string, unknown> };
    expect(body.method).toBe("copy");
    expect(body.args).toEqual({ text: "https://x/?report=r1" });
    expect(typeof body.id).toBe("number");
    const w = window as unknown as FakeWindow;
    w.__longbowReply!(body.id, JSON.stringify({ ok: true, value: "done" }));
    await expect(call).resolves.toBe("done");
  });

  it("assigns increasing ids across calls", async () => {
    const sent = stubWindow({ LongbowBridge: { postMessage: () => {} } });
    const first = nativeCall("badge", { count: 2 });
    const second = nativeCall("badge", { count: 0 });
    const ids = sent.map((m) => (JSON.parse(m) as { id: number }).id);
    expect(ids[1]).toBeGreaterThan(ids[0]!);
    const w = window as unknown as FakeWindow;
    for (const [i, m] of sent.entries()) {
      w.__longbowReply!((JSON.parse(m) as { id: number }).id, JSON.stringify({ ok: true, value: i }));
    }
    await expect(first).resolves.toBe(0);
    await expect(second).resolves.toBe(1);
  });

  it("rejects with the native error message on { ok: false }", async () => {
    const sent = stubWindow({ LongbowBridge: { postMessage: () => {} } });
    const call = nativeCall("print", { title: "Brief" });
    const id = (JSON.parse(sent[0]!) as { id: number }).id;
    const w = window as unknown as FakeWindow;
    w.__longbowReply!(id, JSON.stringify({ ok: false, error: "no webview" }));
    await expect(call).rejects.toThrow("no webview");
  });

  it("rejects outside the app without posting", async () => {
    stubWindow({});
    await expect(nativeCall("haptic", { kind: "light" })).rejects.toThrow("Not in the native app");
  });

  it("rejects after the timeout when native never replies", async () => {
    vi.useFakeTimers();
    try {
      stubWindow({ LongbowBridge: { postMessage: () => {} } });
      const call = nativeCall("badge", { count: 1 });
      const assertion = expect(call).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores replies for unknown ids", async () => {
    const sent = stubWindow({ LongbowBridge: { postMessage: () => {} } });
    const call = nativeCall<string>("copy", { text: "x" });
    const w = window as unknown as FakeWindow;
    const id = (JSON.parse(sent[0]!) as { id: number }).id;
    w.__longbowReply!(id + 999, JSON.stringify({ ok: true, value: "stray" }));
    w.__longbowReply!(id, JSON.stringify({ ok: true, value: "kept" }));
    await expect(call).resolves.toBe("kept");
  });
});
