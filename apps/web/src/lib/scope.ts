import { getContext, setContext } from "svelte";
import type { FeedState } from "./reducer.ts";
import { harness } from "./store.svelte.ts";

/**
 * The source a feed component reads from: the live account by default, or one simulation run
 * when a parent provides a scope. Keeps the pass-two Feed, work steps and agents lane reusable.
 */
export interface FeedScope {
  readonly feed: FeedState;
  readonly loaded: boolean;
  /** Set for simulation runs; used to route subagent sheets back to the run. */
  readonly simRunId?: string;
  loadTranscript(conversationId: string): Promise<void>;
}

const KEY = Symbol("feed-scope");

export const provideScope = (scope: FeedScope) => setContext(KEY, scope);
export const useScope = (): FeedScope => getContext<FeedScope | undefined>(KEY) ?? harness;
