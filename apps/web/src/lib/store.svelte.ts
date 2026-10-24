import type {
  HistoryRange,
  NoteFile,
  PriceHistory,
  SettingsPatch,
  SkillSummary,
} from "@rh/shared";
import { toast } from "svelte-sonner";
import { ApiError, loadApi, type Api } from "./api.ts";
import {
  addOutbox,
  applyEvent,
  dropOutbox,
  emptyState,
  failOutbox,
  mergeTranscript,
  type FeedState,
} from "./reducer.ts";

/** Async resource with its own loading and error state. */
export interface Loadable<T> {
  state: "loading" | "ready" | "error";
  data?: T;
  error?: string;
}

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

  skills = $state<SkillSummary[]>([]);
  history = $state<Record<string, Loadable<PriceHistory>>>({});
  docs = $state<Record<string, Loadable<string>>>({});
  #outSeq = 0;

  calls = $derived(this.feed.calls);
  subagents = $derived(this.feed.subagents);
  notes = $derived(this.feed.notes);
  outbox = $derived(this.feed.outbox);
  status = $derived(this.feed.status);
  messages = $derived(this.feed.messages);
  journal = $derived(this.feed.journal);
  orders = $derived(this.feed.orders);
  draft = $derived(this.feed.draft);
  pending = $derived(this.feed.orders.filter((o) => o.status === "pending_approval"));
  positions = $derived(this.feed.status?.account?.positions ?? []);
  running = $derived(this.feed.status?.agent.state === "running");
  /** Tickers worth making clickable: held, watched, or seen in orders and the journal. */
  symbols = $derived(
    new Set<string>([
      ...(this.feed.status?.settings.watchlist ?? []),
      ...this.positions.map((p) => p.symbol),
      ...this.feed.orders.map((o) => o.intent.symbol),
      ...this.feed.journal.flatMap((j) => (j.symbol ? [j.symbol] : [])),
    ]),
  );

  #api: Api | null = null;
  #unsubscribe: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.#api) return;
    this.#api = await loadApi();
    this.#unsubscribe = this.#api.subscribe({
      onEvent: (e) => {
        this.feed = applyEvent(this.feed, e);
        if (e.type === "note") this.#noteChanged(e.note);
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
      void this.#refreshExtras(api);
    } catch (e) {
      this.loadError = message(e);
      this.loaded = true;
    }
  }

  /** Subagents, notes and skills fail soft: the feed works without them. */
  async #refreshExtras(api: Api): Promise<void> {
    const [runs, notes, skills] = await Promise.allSettled([api.subagents(), api.notes(), api.skills()]);
    const next = { ...this.feed };
    if (runs.status === "fulfilled") {
      const byId = new Map(runs.value.map((r) => [r.id, r]));
      for (const r of this.feed.subagents) if (!byId.has(r.id)) byId.set(r.id, r);
      next.subagents = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
    }
    if (notes.status === "fulfilled") next.notes = notes.value.slice().sort((a, b) => a.path.localeCompare(b.path));
    this.feed = { ...this.feed, subagents: next.subagents, notes: next.notes };
    if (skills.status === "fulfilled") this.skills = skills.value;
  }

  #noteChanged(note: NoteFile): void {
    const key = `note:${note.path}`;
    if (!this.docs[key]) return;
    void this.loadDoc("note", note.path, true);
  }

  async loadHistory(symbol: string, range: HistoryRange): Promise<void> {
    const api = this.#api;
    const key = `${symbol}:${range}`;
    if (!api || this.history[key]) return;
    this.history[key] = { state: "loading" };
    try {
      this.history[key] = { state: "ready", data: await api.history(symbol, range) };
    } catch (e) {
      this.history[key] = { state: "error", error: message(e) };
    }
  }

  retryHistory(symbol: string, range: HistoryRange): void {
    delete this.history[`${symbol}:${range}`];
    void this.loadHistory(symbol, range);
  }

  /** Markdown for a note or skill. `force` refetches without flashing the old text away. */
  async loadDoc(kind: "note" | "skill", id: string, force = false): Promise<void> {
    const api = this.#api;
    const key = `${kind}:${id}`;
    if (!api) return;
    const cur = this.docs[key];
    if (cur && !force && cur.state !== "error") return;
    if (!cur || cur.state === "error") this.docs[key] = { state: "loading" };
    try {
      const text = kind === "note" ? (await api.note(id)).content : (await api.skill(id)).body;
      this.docs[key] = { state: "ready", data: text };
    } catch (e) {
      this.docs[key] = { state: "error", error: message(e) };
    }
  }

  async loadTranscript(id: string): Promise<void> {
    const api = this.#api;
    if (!api) return;
    try {
      this.feed = mergeTranscript(this.feed, id, await api.conversationMessages(id, 200));
    } catch (e) {
      toast.error("Could not load the agent transcript", { description: message(e) });
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

  /** Shows the message at once; the committed message from the server replaces it. */
  async send(text: string, retryId?: string): Promise<void> {
    if (retryId) this.feed = dropOutbox(this.feed, retryId);
    const id = `out-${++this.#outSeq}`;
    this.feed = addOutbox(this.feed, { id, text, at: Date.now() });
    const ok = await this.#run(`send:${id}`, (a) => a.sendMessage(text).then(() => true));
    if (ok) setTimeout(() => (this.feed = dropOutbox(this.feed, id)), 20_000);
    else this.feed = failOutbox(this.feed, id);
  }

  discardOutbox(id: string): void {
    this.feed = dropOutbox(this.feed, id);
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
