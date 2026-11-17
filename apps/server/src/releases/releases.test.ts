import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { PushPayload } from "@rh/shared";
import type { Logger } from "../ports.ts";
import { createNativePushHub } from "../push/native-stream.ts";
import { createReleaseNotifier } from "./notifier.ts";
import { apkPath, publishRelease, readRelease } from "./store.ts";

const log = { warn() {} } as unknown as Logger;
const release = { id: "r1", version: "1.0", title: "Longbow 1", notes: "New features", publishedAt: 123 };
const android = { versionCode: 7, versionName: "1.0", size: 3, sha256: createHash("sha256").update("apk").digest("hex") };

test("publication keeps APK immutable and server-only updates retain it", () => {
  const dir = mkdtempSync("/var/tmp/james/opencode/release-");
  const input = join(dir, "input.apk");
  writeFileSync(input, "apk");
  assert.equal(readRelease(dir), null);
  publishRelease(dir, { ...release, android }, input);
  assert.equal(readFileSync(apkPath(dir, 7), "utf8"), "apk");
  assert.throws(() => publishRelease(dir, { ...release, id: "r2", android }, input), /version must increase/);
  assert.equal(readRelease(dir)?.id, "r1");
  assert.throws(() => publishRelease(dir, { ...release, id: "r2", android: { ...android, versionCode: 8, sha256: "f".repeat(64) } }, input), /does not match/);
  writeFileSync(apkPath(dir, 8), "existing");
  assert.throws(() => publishRelease(dir, { ...release, id: "r2", android: { ...android, versionCode: 8 } }, input), /EEXIST/);
  assert.equal(readFileSync(apkPath(dir, 8), "utf8"), "existing");
  publishRelease(dir, { ...release, id: "r2" });
  assert.deepEqual(readRelease(dir)?.android, android);
  assert.throws(() => apkPath(dir, -1), /Invalid version/);
  writeFileSync(join(dir, "downloads", "release.json"), '{"id":"../escape"}');
  assert.throws(() => readRelease(dir));
});

test("publisher refuses an invalid APK before writing a manifest", () => {
  const dir = mkdtempSync("/var/tmp/james/opencode/release-");
  const metadata = join(dir, "metadata.json");
  const apk = join(dir, "bad.apk");
  writeFileSync(metadata, JSON.stringify(release));
  writeFileSync(apk, "not an apk");
  const result = spawnSync(process.execPath, ["scripts/publish-release.ts", metadata, apk], {
    cwd: join(import.meta.dirname, "../.."), env: { ...process.env, DATA_DIR: dir }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Command failed: aapt dump badging/);
  assert.equal(readRelease(dir), null);
});

test("announcement serializes concurrent checks, fans out and persists across restart", async () => {
  const dir = mkdtempSync("/var/tmp/james/opencode/release-");
  mkdirSync(join(dir, "downloads"));
  writeFileSync(join(dir, "downloads", "release.json"), JSON.stringify(release));
  const hub = createNativePushHub();
  const app = new Hono();
  hub.mount(app);
  const response = await app.request("/api/push/native-stream");
  const reader = response.body!.getReader();
  await reader.read();
  const sent: unknown[] = [];
  const push = hub.wrap({ send: async (payload: PushPayload) => { sent.push(payload); return { sent: 1, removed: 0 }; } } as never);
  const notifier = createReleaseNotifier({ dataDir: dir, log, push });
  await Promise.all([notifier.check(), notifier.check()]);
  assert.deepEqual(sent, [{ title: "Longbow 1", body: "New features", tag: "release-r1", url: "/?settings=updates" }]);
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /release-r1/);
  await createReleaseNotifier({ dataDir: dir, log, push }).check();
  assert.equal(sent.length, 1);
  await reader.cancel();
});

test("failed delivery and marker writes do not resend in a running server", async () => {
  const dir = mkdtempSync("/var/tmp/james/opencode/release-");
  const downloads = join(dir, "downloads");
  mkdirSync(downloads);
  writeFileSync(join(downloads, "release.json"), JSON.stringify(release));
  let sends = 0;
  const notifier = createReleaseNotifier({ dataDir: dir, log, push: {
    async send() { sends++; mkdirSync(join(downloads, "last-announced-release")); throw new Error("push unavailable"); },
  } });
  await notifier.check();
  rmdirSync(join(downloads, "last-announced-release"));
  await notifier.check();
  await createReleaseNotifier({ dataDir: dir, log, push: {
    async send() { sends++; return { sent: 1, removed: 0 }; },
  } }).check();
  assert.equal(sends, 1);
  assert.equal(readFileSync(join(downloads, "last-announced-release"), "utf8").trim(), "r1");
});
