import type {
  AnalyticsRange,
  EquityHistory,
  HistoryRange,
  MarketOverview,
  PerformanceSummary,
  Report,
  ReportSummary,
  SymbolDetail,
  NoteFile,
  PriceHistory,
  SettingsPatch,
  SkillSummary,
} from "@rh/shared";
import { toast } from "svelte-sonner";
import { ApiError, apiMeta, loadApi, type Api } from "./api.ts";
import { etDayKey } from "./format.ts";
import { reportToast } from "./reports.ts";
import { sim } from "./sim.svelte.ts";
import { openReport } from "./ui.svelte.ts";
import {
  addOutbox,
  applyEvent,
  dropOutbox,
  emptyState,
  failOutbox,
  reconcileJournal,
  reconcileMessages,
  reconcileNotes,
  reconcileOrders,
  mergeTranscript,
  type FeedState,
} from "./reducer.ts";

/** Async resource with its own loading and error state. */
export interface Loadable<T> {
  state: "loading" | "ready" | "error";
  data?: T;
  error?: string;
  /** When `data` was fetched; stale data stays on screen while a refresh runs. */
  at?: number;
}

const STALE_MS = 60_000;

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
  /** Set when /api/status came from the service worker cache: the time that snapshot was saved. */
  cachedAt = $state<number | null>(null);

  skills = $state<SkillSummary[]>([]);
  history = $state<Record<string, Loadable<PriceHistory>>>({});
  docs = $state<Record<string, Loadable<string>>>({});
  equity = $state<Record<string, Loadable<EquityHistory>>>({});
  performance = $state<Loadable<PerformanceSummary>>({ state: "loading" });
  reports = $state<Loadable<ReportSummary[]>>({ state: "loading" });
  reportDetail = $state<Record<string, Loadable<Report>>>({});
  market = $state<Loadable<MarketOverview>>({ state: "loading" });
  symbolDetail = $state<Record<string, Loadable<SymbolDetail>>>({});
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
  /** Halts plus orders that failed today (ET): the number on the Home Screen badge. */
  alerts = $derived(
    (this.feed.status?.halts.length ?? 0) +
      this.feed.orders.filter((o) => o.status === "failed" && etDayKey(o.createdAt) === etDayKey(Date.now())).length,
  );
  pending = $derived(this.feed.orders.filter((o) => o.status === "pending_approval"));
  /** Newest published report, for the Portfolio card and the list. */
  latestReport = $derived(this.reports.data?.[0] as ReportSummary | undefined);
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

  // Reactive so views that mounted before the client loaded fetch once it arrives (deep links).
  #api = $state<Api | null>(null);

  requireApi(): Api {
    if (!this.#api) throw new Error("Not connected");
    return this.#api;
  }
  #unsubscribe: (() => void) | null = null;
  /**
   * In-flight refresh and the connection it belongs to: start() and the stream's
   * onOpen overlap, so a second caller on the same connection joins the first
   * instead of racing it. A fresh connection never joins the old one's task.
   * loadApi returns a singleton, so the API identity alone cannot tell
   * connections apart: the explicit generation does.
   */
  #refreshTask: Promise<void> | null = null;
  #refreshApi: Api | null = null;
  #connection = 0;
  #refreshGen: number | null = null;

  async start(): Promise<void> {
    if (this.#api) return;
    // Reserve the generation before awaiting so a stop() during loadApi
    // invalidates this pending connection.
    const gen = this.#connection + 1;
    this.#connection = gen;
    const api = await loadApi();
    if (this.#connection !== gen) return;
    this.#api = api;
    sim.attach(this.#api);
    this.#unsubscribe = this.#api.subscribe({
      onEvent: (e) => {
        if (this.#connection !== gen) return;
        if (e.type === "sim" || e.type === "sim_suite" || ("simRunId" in e && e.simRunId)) {
          sim.apply(e);
          return;
        }
        this.feed = applyEvent(this.feed, e);
        if (e.type === "note") this.#noteChanged(e.note);
        if (e.type === "report") this.#reportArrived(e.report);
      },
      onOpen: () => {
        if (this.#connection !== gen) return;
        const wasOffline = this.connection === "offline";
        this.connection = "live";
        if (wasOffline || !this.loaded) void this.refresh();
      },
      onClose: () => {
        if (this.#connection !== gen) return;
        this.connection = "offline";
      },
    });
    await this.refresh();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#api = null;
    // Invalidate in-flight refresh work: ownership now requires this generation.
    this.#connection += 1;
    sim.attach(null);
  }

  async refresh(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    const gen = this.#connection;
    if (this.#refreshTask && this.#refreshApi === api && this.#refreshGen === gen)
      return this.#refreshTask;
    const task = this.#doRefresh(api, gen);
    this.#refreshTask = task;
    this.#refreshApi = api;
    this.#refreshGen = gen;
    try {
      await task;
    } finally {
      if (this.#refreshTask === task && this.#refreshGen === gen) {
        this.#refreshTask = null;
        this.#refreshApi = null;
        this.#refreshGen = null;
      }
    }
  }

  /**
   * Reconcile REST with the live stream. Each fetch reconciles against the
   * request baseline as it settles instead of replacing the feed, so an SSE
   * message, delta or call that arrives mid-refresh survives while the fetch
   * still updates records nothing touched: a slow fetch never blocks (or
   * wipes) visible messages. A status event that lands mid-refresh is newer
   * than a fetch that started before it, so the event wins. Late responses
   * for a stopped or replaced API are dropped, never published.
   */
  async #doRefresh(api: Api, gen: number): Promise<void> {
    const base = this.feed;
    const owned = () => this.#api === api && this.#connection === gen;
    let messagesError: unknown;
    let otherError: unknown;
    const noteOther = (e: unknown) => {
      otherError ??= e;
    };
    await Promise.all([
      api.status().then(
        (value) => {
          if (!owned()) return;
          if (this.feed.status === base.status) {
            this.cachedAt = apiMeta.statusCachedAt;
            this.feed = { ...this.feed, status: value };
          } else {
            // Live event already showed newer state; the fetch only proves connectivity.
            this.cachedAt = null;
          }
        },
        (e) => {
          if (owned()) noteOther(e);
        },
      ),
      api.messages(200).then(
        (value) => {
          if (!owned()) return;
          this.feed = { ...this.feed, messages: reconcileMessages(base.messages, this.feed.messages, value) };
          // Primary history is ready: the transcript shows without waiting
          // for slow orders/journal/status reads.
          this.loaded = true;
        },
        (e) => {
          if (!owned()) return;
          messagesError ??= e;
          this.loaded = true;
          // Surface primary history failure at once so Retry works while
          // slow orders/journal/status reads are still pending.
          this.loadError = message(e);
        },
      ),
      api.journal(100).then(
        (value) => {
          if (!owned()) return;
          this.feed = { ...this.feed, journal: reconcileJournal(base.journal, this.feed.journal, value) };
        },
        (e) => {
          if (owned()) noteOther(e);
        },
      ),
      api.orders(100).then(
        (value) => {
          if (!owned()) return;
          this.feed = { ...this.feed, orders: reconcileOrders(base.orders, this.feed.orders, value) };
        },
        (e) => {
          if (owned()) noteOther(e);
        },
      ),
    ]);
    if (!owned()) return;
    this.loadError =
      messagesError !== undefined
        ? message(messagesError)
        : otherError !== undefined
          ? message(otherError)
          : null;
    if (messagesError === undefined && otherError === undefined) void this.#refreshExtras(api, gen);
    void sim.loadRuns();
  }

  /** Subagents, notes and skills fail soft: the feed works without them. */
  async #refreshExtras(api: Api, gen: number): Promise<void> {
    const base = this.feed;
    const [runs, notes, skills] = await Promise.allSettled([api.subagents(), api.notes(), api.skills()]);
    if (this.#api !== api || this.#connection !== gen) return;
    const next = { ...this.feed };
    if (runs.status === "fulfilled") {
      const byId = new Map(runs.value.map((r) => [r.id, r]));
      for (const r of this.feed.subagents) if (!byId.has(r.id)) byId.set(r.id, r);
      next.subagents = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
    }
    if (notes.status === "fulfilled") next.notes = reconcileNotes(base.notes, this.feed.notes, notes.value);
    this.feed = { ...this.feed, subagents: next.subagents, notes: next.notes };
    if (skills.status === "fulfilled") this.skills = skills.value;
  }

  #noteChanged(note: NoteFile): void {
    const key = `note:${note.path}`;
    if (!this.docs[key]) return;
    void this.loadDoc("note", note.path, true);
  }

  /** A published report slides to the top of the list; the toast opens it. */
  #reportArrived(report: ReportSummary): void {
    const { title, body } = reportToast(report);
    toast.success(title, {
      description: body,
      action: { label: "Open", onClick: () => openReport(report.id) },
    });
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

  /** Shared stale-while-revalidate loader for the analytics endpoints. */
  async #load<T>(read: () => Loadable<T> | undefined, write: (v: Loadable<T>) => void, fetcher: (api: Api) => Promise<T>, force: boolean): Promise<void> {
    const api = this.#api;
    if (!api) return;
    const cur = read();
    if (!force && cur?.state === "ready" && cur.at !== undefined && Date.now() - cur.at < STALE_MS) return;
    if (cur?.state === "loading" && cur.data === undefined && cur.at === -1) return;
    if (!cur || cur.data === undefined) write({ state: "loading", at: -1 });
    try {
      write({ state: "ready", data: await fetcher(api), at: Date.now() });
    } catch (e) {
      write(cur?.data !== undefined ? { ...cur, error: message(e) } : { state: "error", error: message(e) });
    }
  }

  loadEquity(range: AnalyticsRange, force = false): Promise<void> {
    return this.#load(() => this.equity[range], (v) => (this.equity[range] = v), (a) => a.equity(range), force);
  }

  loadPerformance(force = false): Promise<void> {
    return this.#load(() => this.performance, (v) => (this.performance = v), (a) => a.performance(), force);
  }

  loadReports(force = false): Promise<void> {
    return this.#load(() => this.reports, (v) => (this.reports = v), (a) => a.reports(), force);
  }

  loadReport(id: string, force = false): Promise<void> {
    return this.#load(
      () => this.reportDetail[id],
      (v) => (this.reportDetail[id] = v),
      (a) => a.report(id),
      force,
    );
  }

  loadMarket(force = false): Promise<void> {
    return this.#load(() => this.market, (v) => (this.market = v), (a) => a.marketOverview(), force);
  }

  loadSymbolDetail(symbol: string, force = false): Promise<void> {
    return this.#load(() => this.symbolDetail[symbol], (v) => (this.symbolDetail[symbol] = v), (a) => a.symbolDetail(symbol), force);
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
