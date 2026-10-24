import { describe, expect, it } from "vitest";
import { needsHomeScreen, urlBase64ToUint8Array } from "./push.ts";

describe("urlBase64ToUint8Array", () => {
  it("maps the url-safe alphabet (-, _) to the bytes standard base64 would give for + and /", () => {
    // "-_8" is "+/8=" in standard base64: 0xfb 0xff.
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([0xfb, 0xff]);
  });

  it("restores the padding that base64url omits, for all three remainders", () => {
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array("AQI")]).toEqual([1, 2]);
    expect([...urlBase64ToUint8Array("AQ")]).toEqual([1]);
  });

  it("decodes a real VAPID public key to a 65 byte uncompressed P-256 point", () => {
    const key = urlBase64ToUint8Array("BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U");
    expect(key.length).toBe(65);
    expect(key[0]).toBe(0x04);
  });
});

describe("needsHomeScreen", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
  it("is true for iOS Safari outside the installed app", () => {
    expect(needsHomeScreen({ ua: iphone, touchMac: false, standalone: false })).toBe(true);
  });
  it("is false once the app runs from the Home Screen", () => {
    expect(needsHomeScreen({ ua: iphone, touchMac: false, standalone: true })).toBe(false);
  });
  it("catches iPadOS, which reports a Mac user agent but has touch", () => {
    expect(needsHomeScreen({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", touchMac: true, standalone: false })).toBe(true);
  });
  it("is false on desktop and Android", () => {
    expect(needsHomeScreen({ ua: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130", touchMac: false, standalone: false })).toBe(false);
  });
});
