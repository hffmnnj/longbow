import type { SoftwareRelease } from "@rh/shared";

/** Legacy same-origin APK while no release metadata is published yet. */
export const LEGACY_APK_HREF = "/download/longbow.apk";

/**
 * Fixed download path for a published release. The server serves the APK at
 * /download/releases/longbow-<versionCode>.apk; without android metadata the
 * legacy build URL is the fallback so the button never points nowhere.
 */
export function releaseApkHref(release: SoftwareRelease | null | undefined): string {
  const code = release?.android?.versionCode;
  return Number.isInteger(code) ? `/download/releases/longbow-${code}.apk` : LEGACY_APK_HREF;
}
