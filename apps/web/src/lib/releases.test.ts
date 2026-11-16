import { describe, expect, it } from "vitest";
import { LEGACY_APK_HREF, releaseApkHref } from "./releases.ts";
import type { SoftwareRelease } from "@rh/shared";

const base: SoftwareRelease = {
  id: "r-42",
  version: "1.4.2",
  title: "Faster fills view",
  notes: "Fixes the stalled orders list.",
  publishedAt: 1_793_000_000_000,
};

describe("releaseApkHref", () => {
  it("points at the versioned path when android metadata is published", () => {
    expect(releaseApkHref({ ...base, android: { versionCode: 42, versionName: "1.4.2", size: 1_024, sha256: "a".repeat(64) } })).toBe(
      "/download/releases/longbow-42.apk",
    );
  });

  it("falls back to the legacy build when no android metadata is published", () => {
    expect(releaseApkHref(base)).toBe(LEGACY_APK_HREF);
    expect(releaseApkHref(base)).toBe("/download/longbow.apk");
  });

  it("falls back to the legacy build when no release exists yet", () => {
    expect(releaseApkHref(null)).toBe(LEGACY_APK_HREF);
    expect(releaseApkHref(undefined)).toBe(LEGACY_APK_HREF);
  });
});
