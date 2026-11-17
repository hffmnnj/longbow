import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { apkPath, publishRelease, readRelease } from "../src/releases/store.ts";
import { SoftwareReleaseSchema } from "@rh/shared";

// Usage: node scripts/publish-release.ts release.json [app-release.apk]
const [metadataPath, sourceApk, ...extra] = process.argv.slice(2);
if (metadataPath === undefined || extra.length > 0) throw new Error("Usage: publish-release.ts release.json [app-release.apk]");
const dataDir = loadConfig().DATA_DIR;
const downloads = join(dataDir, "downloads");
mkdirSync(downloads, { recursive: true, mode: 0o700 });
const lock = join(downloads, ".publish-lock");
mkdirSync(lock); // Refuse concurrent publishers rather than racing version checks.
let temporary: string | undefined;
try {
  const metadata: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));
  const release = SoftwareReleaseSchema.parse(metadata);
  if (release.android !== undefined) throw new Error("Android metadata is inspected from the APK, not supplied in JSON");
  if (sourceApk === undefined) {
    publishRelease(dataDir, release);
  } else {
    temporary = mkdtempSync(join(downloads, ".apk-"));
    const snapshot = join(temporary, "release.apk");
    copyFileSync(sourceApk, snapshot);
    if (statSync(snapshot).size > 150 * 1024 * 1024) throw new Error("APK exceeds 150 MiB");
    const badging = execFileSync("aapt", ["dump", "badging", snapshot], { encoding: "utf8" });
    const match = /^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'/m.exec(badging);
    if (match === null || match[1] !== "com.hffmnnj.longbow") throw new Error("APK package metadata is invalid");
    const signature = (path: string): string => {
      const output = execFileSync("apksigner", ["verify", "--print-certs", path], { encoding: "utf8" });
      const certs = [...output.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)$/gm)].map((m) => m[1]?.toLowerCase()).sort();
      if (certs.length === 0) throw new Error("APK has no verified signing certificate");
      return certs.join(",");
    };
    const signer = signature(snapshot);
    const previous = readRelease(dataDir);
    const previousApk = previous?.android !== undefined
      ? apkPath(dataDir, previous.android.versionCode)
      : join(downloads, "longbow.apk");
    if (existsSync(previousApk)) {
      if (signer !== signature(previousApk)) {
        throw new Error("APK signing certificate differs from the installed release");
      }
      const priorBadging = execFileSync("aapt", ["dump", "badging", previousApk], { encoding: "utf8" });
      const priorCode = /^package: name='com\.hffmnnj\.longbow' versionCode='([0-9]+)'/m.exec(priorBadging);
      if (priorCode === null || Number(match[2]) <= Number(priorCode[1])) {
        throw new Error("APK version must increase from the previously published APK");
      }
    }
    if (previous?.android !== undefined && !existsSync(previousApk)) throw new Error("Previous APK is missing");
    const bytes = readFileSync(snapshot);
    const android = {
      versionCode: Number(match[2]),
      versionName: match[3]!,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    publishRelease(dataDir, { ...release, android }, snapshot);
  }
  console.log(`Published release ${release.id}`);
} finally {
  if (temporary !== undefined) {
    try { unlinkSync(join(temporary, "release.apk")); } catch { /* Copy may not have completed. */ }
    rmdirSync(temporary);
  }
  rmdirSync(lock);
}
