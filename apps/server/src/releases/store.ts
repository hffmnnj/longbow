import { createHash, randomUUID } from "node:crypto";
import { linkSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SoftwareReleaseSchema, type SoftwareRelease } from "@rh/shared";

export function apkPath(dataDir: string, code: number): string {
  if (!Number.isSafeInteger(code) || code < 1 || code > 2_100_000_000) throw new Error("Invalid version code");
  return join(dataDir, "downloads", "releases", `longbow-${code}.apk`);
}

export function readRelease(dataDir: string): SoftwareRelease | null {
  const path = join(dataDir, "downloads", "release.json");
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return SoftwareReleaseSchema.parse(JSON.parse(contents) as unknown);
}

export function atomicWrite(path: string, contents: string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, contents, { flag: "wx", mode: 0o600 });
  renameSync(temp, path);
}

/** Called only with metadata inspected from the copied APK by the publisher. */
export function publishRelease(dataDir: string, release: SoftwareRelease, apk?: string): void {
  const downloads = join(dataDir, "downloads");
  mkdirSync(join(downloads, "releases"), { recursive: true, mode: 0o700 });
  const previous = readRelease(dataDir);
  if (previous?.id === release.id) throw new Error("Release ID already published");
  const next = SoftwareReleaseSchema.parse({ ...release, android: release.android ?? previous?.android });
  if (apk !== undefined) {
    if (next.android === undefined) throw new Error("APK metadata required");
    if (previous?.android !== undefined && next.android.versionCode <= previous.android.versionCode) {
      throw new Error("APK version must increase");
    }
    const info = lstatSync(apk);
    if (!info.isFile() || info.size !== next.android.size) throw new Error("APK size does not match inspected metadata");
    const bytes = readFileSync(apk);
    if (bytes.length !== next.android.size || createHash("sha256").update(bytes).digest("hex") !== next.android.sha256) {
      throw new Error("APK does not match inspected metadata");
    }
    const target = apkPath(dataDir, next.android.versionCode);
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, target);
    } finally {
      unlinkSync(temporary);
    }
  } else if (release.android !== undefined) {
    throw new Error("Cannot supply Android metadata without an APK");
  }
  atomicWrite(join(downloads, "release.json"), `${JSON.stringify(next)}\n`);
}

export function regularApk(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
