import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../ports.ts";
import type { PushService } from "../push/service.ts";
import { atomicWrite, readRelease } from "./store.ts";

export function createReleaseNotifier(deps: { dataDir: string; push: Pick<PushService, "send">; log: Logger }): { check(): Promise<void> } {
  const directory = join(deps.dataDir, "downloads");
  const marker = join(directory, "last-announced-release");
  let pending: Promise<void> | undefined;
  let attempted: string | undefined;
  return {
    check() {
      if (pending !== undefined) return pending;
      pending = (async () => {
        try {
          const release = readRelease(deps.dataDir);
          if (release === null) return;
          let last: string | undefined;
          try {
            last = readFileSync(marker, "utf8").trim();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (last === release.id) return;
          if (attempted !== release.id) {
            attempted = release.id;
            try {
              await deps.push.send({
                title: release.title,
                body: release.notes.slice(0, 280),
                tag: `release-${release.id}`,
                url: "/?settings=updates",
              });
            } catch {
              deps.log.warn("release push failed", { id: release.id });
            }
          }
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          atomicWrite(marker, `${release.id}\n`);
        } catch {
          deps.log.warn("release announcement check failed");
        }
      })().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

export function startReleaseNotifier(deps: { dataDir: string; push: Pick<PushService, "send">; log: Logger }): () => void {
  const notifier = createReleaseNotifier(deps);
  void notifier.check();
  const timer = setInterval(() => { void notifier.check(); }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
