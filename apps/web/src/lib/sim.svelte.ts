import type { ServerEvent, SimRun, SimRunConfig, SimScenario, SimSuite, SimSuiteConfig } from "@rh/shared";
import { toast } from "svelte-sonner";
import type { Api } from "./api.ts";
import { ApiError } from "./api.ts";
import {
  emptyState,
  emptyTranscript,
  mergeTranscript,
  upsertJournal,
  upsertMessage,
  upsertOrder,
  type FeedState,
} from "./reducer.ts";
import { applySimEvent, emptySim, upsertSimRun, upsertSuite, type SimState } from "./sim.ts";
import type { FeedScope } from "./scope.ts";

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");

/** Lab data: paper runs and the per-run agent feeds. Fed by the SSE stream and the sim REST routes. */
class SimStore {
  data = $state<SimState>(emptySim());
  loaded = $state(false);
  loadError = $state<string | null>(null);
  starting = $state(false);
  startingSuite = $state(false);
  scenarios = $state<SimScenario[]>([]);
  scenariosLoaded = $state(false);
  /** Run ids whose feed (messages, journal, orders) has been fetched. */
  feedLoaded = $state<Record<string, boolean>>({});
  #api: Api | null = null;

  runs = $derived(this.data.runs);
  suites = $derived(this.data.suites);

  attach(api: Api | null): void {
    this.#api = api;
    if (!api) {
      this.data = emptySim();
      this.loaded = false;
      this.feedLoaded = {};
      this.scenarios = [];
      this.scenariosLoaded = false;
    }
  }

  apply(event: ServerEvent): void {
    this.data = applySimEvent(this.data, event);
  }

  run(id: string | null): SimRun | undefined {
    return id ? this.data.runs.find((r) => r.id === id) : undefined;
  }

  suite(id: string | null): SimSuite | undefined {
    return id ? this.data.suites.find((s) => s.id === id) : undefined;
  }

  feed(id: string): FeedState {
    return this.data.feeds[id] ?? emptyState();
  }

  async loadRuns(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    try {
      const [fetched, fetchedSuites] = await Promise.all([api.simRuns(), api.simSuites().catch(() => [] as SimSuite[])]);
      let runs = this.data.runs;
      // Events that arrived during the fetch are at least as new as the list.
      const live = new Map(runs.map((r) => [r.id, r]));
      runs = fetched.map((r) => live.get(r.id) ?? r);
      for (const r of live.values()) if (!runs.some((x) => x.id === r.id)) runs = upsertSimRun(runs, r);
      let suites = fetchedSuites;
      const liveSuites = new Map(this.data.suites.map((s) => [s.id, s]));
      for (const s of liveSuites.values()) if (!suites.some((x) => x.id === s.id)) suites = upsertSuite(suites, s);
      this.data = { ...this.data, runs: runs.slice().sort((a, b) => b.createdAt - a.createdAt), suites };
      this.loadError = null;
    } catch (e) {
      this.loadError = errorText(e);
    } finally {
      this.loaded = true;
    }
  }

  /** Scenario library for the new-run and new-suite sheets; fails soft to a Custom-dates form. */
  async loadScenarios(): Promise<void> {
    const api = this.#api;
    if (!api || this.scenariosLoaded) return;
    try {
      this.scenarios = await api.simScenarios();
    } catch {
      this.scenarios = [];
    } finally {
      this.scenariosLoaded = true;
    }
  }

  /** Fetch a run's agent feed once; streamed events keep it current afterwards. */
  async loadFeed(id: string, force = false): Promise<void> {
    const api = this.#api;
    if (!api || (this.feedLoaded[id] && !force)) return;
    this.feedLoaded[id] = true;
    const [messages, journal, orders] = await Promise.allSettled([
      api.simMessages(id, 200),
      api.simJournal(id),
      api.simOrders(id),
    ]);
    let feed = this.feed(id);
    if (messages.status === "fulfilled") for (const m of messages.value) feed = { ...feed, messages: upsertMessage(feed.messages, m) };
    if (journal.status === "fulfilled") for (const e of journal.value) feed = { ...feed, journal: upsertJournal(feed.journal, e) };
    if (orders.status === "fulfilled") for (const o of orders.value) feed = { ...feed, orders: upsertOrder(feed.orders, o) };
    this.data = { ...this.data, feeds: { ...this.data.feeds, [id]: feed } };
    if ([messages, journal, orders].every((r) => r.status === "rejected")) this.feedLoaded[id] = false;
  }

  async loadTranscript(runId: string, conversationId: string): Promise<void> {
    const api = this.#api;
    if (!api) return;
    try {
      const msgs = await api.simMessages(runId, 200, conversationId);
      this.data = { ...this.data, feeds: { ...this.data.feeds, [runId]: mergeTranscript(this.feed(runId), conversationId, msgs) } };
    } catch (e) {
      toast.error("Could not load the agent transcript", { description: errorText(e) });
    }
  }

  /** Returns the new run, or the server's message when it refuses the config. */
  async start(config: SimRunConfig): Promise<{ run: SimRun } | { error: string }> {
    const api = this.#api;
    if (!api) return { error: "Not connected" };
    this.starting = true;
    try {
      const run = await api.simStart(config);
      this.data = { ...this.data, runs: upsertSimRun(this.data.runs, run) };
      return { run };
    } catch (e) {
      return { error: errorText(e) };
    } finally {
      this.starting = false;
    }
  }

  async stop(id: string): Promise<void> {
    const api = this.#api;
    if (!api) return;
    try {
      const run = await api.simStop(id);
      if (run) this.data = { ...this.data, runs: upsertSimRun(this.data.runs, run) };
      toast("Stopping simulation");
    } catch (e) {
      toast.error("Could not stop the run", { description: errorText(e) });
    }
  }

  /** Returns the new suite, or the server's message when it refuses the config. */
  async startSuite(config: SimSuiteConfig): Promise<{ suite: SimSuite } | { error: string }> {
    const api = this.#api;
    if (!api) return { error: "Not connected" };
    this.startingSuite = true;
    try {
      const suite = await api.simSuiteStart(config);
      this.data = { ...this.data, suites: upsertSuite(this.data.suites, suite) };
      return { suite };
    } catch (e) {
      return { error: errorText(e) };
    } finally {
      this.startingSuite = false;
    }
  }

  async stopSuite(id: string): Promise<void> {
    const api = this.#api;
    if (!api) return;
    try {
      const suite = await api.simSuiteStop(id);
      if (suite) this.data = { ...this.data, suites: upsertSuite(this.data.suites, suite) };
      toast("Stopping suite");
    } catch (e) {
      toast.error("Could not stop the suite", { description: errorText(e) });
    }
  }

  /** A FeedScope for components that render one run's agent. */
  scope(id: string): FeedScope {
    const store = this;
    return {
      get feed() {
        return store.feed(id);
      },
      get loaded() {
        return store.feedLoaded[id] === true;
      },
      simRunId: id,
      loadTranscript: (convId) => store.loadTranscript(id, convId),
    };
  }
}

export const sim = new SimStore();
export { emptyTranscript };
