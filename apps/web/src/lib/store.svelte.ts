import type { SettingsPatch } from "@rh/shared";
import { toast } from "svelte-sonner";
import { ApiError, loadApi, type Api } from "./api.ts";
import { applyEvent, emptyState, type FeedState } from "./reducer.ts";

export type Connection = "connecting" | "live" | "offline";

function message(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong";
}

class Harness {
  feed = $state<FeedState>(emptyState());
  connection = $state<Connection>("connecting");
  loaded = $state(false);
  loadError = $state<string | null>(null);
  busy = $state<Record<string, boolean>>({});

  status = $derived(this.feed.status);
  messages = $derived(this.feed.messages);
  journal = $derived(this.feed.journal);
  orders = $derived(this.feed.orders);
  draft = $derived(this.feed.draft);
  pending = $derived(this.feed.orders.filter((o) => o.status === "pending_approval"));
  positions = $derived(this.feed.status?.account?.positions ?? []);
  running = $derived(this.feed.status?.agent.state === "running");

  #api: Api | null = null;
  #unsubscribe: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.#api) return;
    this.#api = await loadApi();
    this.#unsubscribe = this.#api.subscribe({
      onEvent: (e) => {
        this.feed = applyEvent(this.feed, e);
      },
      onOpen: () => {
        const wasOffline = this.connection === "offline";
        this.connection = "live";
        if (wasOffline || !this.loaded) void this.refresh();
      },
      onClose: () => {
        this.connection = "offline";
      },
    });
    await this.refresh();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#api = null;
  }

  async refresh(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    try {
      const [status, messages, journal, orders] = await Promise.all([
        api.status(),
        api.messages(200),
        api.journal(100),
        api.orders(100),
      ]);
      this.feed = { ...this.feed, status, messages, journal, orders };
      this.loadError = null;
      this.loaded = true;
    } catch (e) {
      this.loadError = message(e);
      this.loaded = true;
    }
  }

  async #run<T>(key: string, fn: (api: Api) => Promise<T>, fail?: string): Promise<T | undefined> {
    const api = this.#api;
    if (!api || this.busy[key]) return undefined;
    this.busy[key] = true;
    try {
      return await fn(api);
    } catch (e) {
      toast.error(fail ?? message(e), fail ? { description: message(e) } : undefined);
      return undefined;
    } finally {
      this.busy[key] = false;
    }
  }

  async runCycle(): Promise<void> {
    const ok = await this.#run("cycle", (a) => a.runCycle().then(() => true), "Could not start a cycle");
    if (ok) toast.success("Cycle requested");
  }

  async send(text: string): Promise<boolean> {
    const ok = await this.#run("send", (a) => a.sendMessage(text).then(() => true), "Message not sent");
    return ok === true;
  }

  async approve(id: string): Promise<void> {
    await this.#run(`order:${id}`, (a) => a.approve(id), "Could not approve the order");
  }

  async reject(id: string, reason?: string): Promise<void> {
    await this.#run(`order:${id}`, (a) => a.reject(id, reason?.trim() || undefined), "Could not reject the order");
  }

  /** Throws ApiError so the settings form can place field errors inline. */
  async patchSettings(patch: SettingsPatch): Promise<void> {
    const api = this.#api;
    if (!api) throw new Error("Not connected");
    await api.patchSettings(patch);
    await this.refreshStatus();
  }

  async quickPatch(key: string, patch: SettingsPatch, done?: string): Promise<boolean> {
    const ok = await this.#run(key, async (a) => {
      await a.patchSettings(patch);
      return true;
    }, "Could not update settings");
    if (ok) {
      await this.refreshStatus();
      if (done) toast.success(done);
    }
    return ok === true;
  }

  async refreshStatus(): Promise<void> {
    if (!this.#api) return;
    try {
      this.feed = { ...this.feed, status: await this.#api.status() };
    } catch {
      /* the event stream will catch up */
    }
  }

  async connectRobinhood(): Promise<void> {
    const res = await this.#run("connect", (a) => a.connectUrl(), "Could not start Robinhood sign-in");
    if (res?.url) window.location.assign(res.url);
  }

  async disconnectRobinhood(): Promise<void> {
    const ok = await this.#run("disconnect", (a) => a.disconnect().then(() => true), "Could not disconnect");
    if (ok) {
      await this.refreshStatus();
      toast("Robinhood disconnected");
    }
  }
}

export const harness = new Harness();
