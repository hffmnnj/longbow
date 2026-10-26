<script lang="ts">
  import type { SubagentRun } from "@rh/shared";
  import Markdown from "./Markdown.svelte";
  import TranscriptView from "./Transcript.svelte";
  import { ROLE_META } from "$lib/roles";
  import type { Transcript } from "$lib/reducer";

  /**
   * A subagent run as its own Trace of tool calls plus its result
   * (AI Elements Subagent pattern). Shared by the agents lane expansion
   * and the agent sheet, so both show the same Trace.
   */
  let { run, transcript, running }: { run: SubagentRun; transcript: Transcript; running: boolean } = $props();

  const meta = $derived(ROLE_META[run.role]);
  const messages = $derived(
    run.answer ? transcript.messages.filter((m) => !(m.role === "assistant" && m.text === run.answer)) : transcript.messages,
  );
</script>

<TranscriptView {messages} draft={transcript.draft} calls={transcript.calls} {running} agentLabel={meta.label} />
{#if run.answer}
  <section class="rise-in border-primary/40 bg-primary/8 rounded-lg border px-3.5 py-3" aria-label="Final answer">
    <h3 class="label-caps text-primary mb-1.5">Final answer</h3>
    <div class="text-[14px]"><Markdown text={run.answer} /></div>
  </section>
{/if}
