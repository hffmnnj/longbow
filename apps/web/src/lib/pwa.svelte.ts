import { toast } from "svelte-sonner";
import { PushSubscriptionSchema } from "@rh/shared";
import { harness } from "./store.svelte.ts";
import { needsHomeScreen, urlBase64ToUint8Array, type PushState } from "./push.ts";

/** Registers the service worker and surfaces a waiting update as a toast with a Reload action. */
export function registerServiceWorker(): void {
  // Dev servers serve changing modules; a worker there would pin stale code.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const announce = (worker: ServiceWorker) =>
    toast("Update ready", {
      id: "sw-update",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Reload", onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
    });

  navigator.serviceWorker
    .register("/service-worker.js", { type: "classic" })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) announce(next);
        });
      });
      // Installed apps stay open for days; look for a new build when the user comes back.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

/** Home Screen badge: halts plus failed orders today. Clears at zero. */
export function setBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* unsupported */
  }
}

export function haptic(ms = 30): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function iosNeedsHomeScreen(): boolean {
  return needsHomeScreen({
    ua: navigator.userAgent,
    touchMac: navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1,
    standalone: isStandalone(),
  });
}

class PushStore {
  state = $state<PushState>("off");
  ready = $state(false);
  busy = $state(false);
  homeScreen = $state(false);

  #supported(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  async refresh(): Promise<void> {
    this.homeScreen = iosNeedsHomeScreen();
    if (!this.#supported()) {
      this.state = "unsupported";
      this.ready = true;
      return;
    }
    if (Notification.permission === "denied") {
      this.state = "blocked";
      this.ready = true;
      return;
    }
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.getRegistration().then((r) => r ?? undefined),
        new Promise<undefined>((r) => setTimeout(r, 1500)),
      ]);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      this.state = sub && Notification.permission === "granted" ? "on" : "off";
    } catch {
      this.state = "off";
    }
    this.ready = true;
  }

  async enable(): Promise<void> {
    if (this.busy || !this.#supported()) return;
    this.busy = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        this.state = permission === "denied" ? "blocked" : "off";
        return;
      }
      const api = harness.requireApi();
      const { publicKey } = await api.pushKey();
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const parsed = PushSubscriptionSchema.safeParse(sub.toJSON());
      if (!parsed.success) throw new Error("The browser returned an incomplete subscription");
      await api.pushSubscribe(parsed.data);
      this.state = "on";
      toast.success("Notifications on");
    } catch (e) {
      toast.error("Could not turn on notifications", { description: e instanceof Error ? e.message : undefined });
      await this.refresh();
    } finally {
      this.busy = false;
    }
  }

  async disable(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await harness.requireApi().pushUnsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      this.state = "off";
    } catch (e) {
      toast.error("Could not turn off notifications", { description: e instanceof Error ? e.message : undefined });
    } finally {
      this.busy = false;
    }
  }

  async test(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await harness.requireApi().pushTest();
      if (res.sent > 0) toast.success(`Sent to ${res.sent} device${res.sent === 1 ? "" : "s"}`);
      else toast.error("Nothing was sent", { description: "No device is subscribed." });
    } catch (e) {
      toast.error("Test failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      this.busy = false;
    }
  }
}

export const push = new PushStore();
