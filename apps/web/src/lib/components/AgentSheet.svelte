<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import StickyScroll from "./StickyScroll.svelte";
  import Transcript from "./Transcript.svelte";
  import { AlertCircleIcon, Tick02Icon } from "$lib/icons";
  import { durationShort } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { ROLE_META } from "$lib/roles";
  import { emptyTranscript } from "$lib/reducer";
  import type { FeedScope } from "$lib/scope";
  import { sim } from "$lib/sim.svelte";
  import { harness } from "$lib/store.svelte";
  import { openAgent, ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let last = $state("");
  let lastSim = $state<string | null>(null);
  $effect(() => {
    if (ui.agent) {
      last = ui.agent;
      lastSim = ui.agentSim;
    }
  });
  const scope: FeedScope = $derived((ui.agent ? ui.agentSim : lastSim) ? sim.scope((ui.agent ? ui.agentSim : lastSim)!) : harness);
  const id = $derived(ui.agent ?? last);
  const run = $derived(scope.feed.subagents.find((r) => r.id === id));
  const meta = $derived(run ? ROLE_META[run.role] : undefined);
  const transcript = $derived(scope.feed.transcripts[id] ?? emptyTranscript());
  const messages = $derived(run?.answer ? transcript.messages.filter((m) => !(m.role === "assistant" && m.text === run.answer)) : transcript.messages);
  const recent = $derived(scope.feed.subagents.slice(0, 8));
  const running = $derived(run?.status === "running");
  const elapsed = $derived(run ? (run.endedAt ?? clock.now) - run.startedAt : 0);

  $effect(() => {
    if (ui.agent) void scope.loadTranscript(ui.agent);
  });
</script>

<Sheet.Root
  open={ui.agent !== null}
  onOpenChange={(o) => {
    if (!o) {
      ui.agent = null;
      ui.agentSim = null;
    }
  }}
>
  <Sheet.Content
    side="right"
    class="data-[side=right]:w-full data-[side=right]:sm:max-w-xl gap-0"
    onOpenAutoFocus={(e) => e.preventDefault()}
  >
    <Sheet.Header class="border-border gap-2 border-b pr-14">
      <div class="flex items-center gap-2">
        {#if meta}<Icon icon={meta.icon} class="text-muted-foreground size-4" />{/if}
        <Sheet.Title class="text-[15px]">{meta?.label ?? "Agent"}</Sheet.Title>
        {#if run?.symbol}<span class="num text-muted-foreground text-[13px]">{run.symbol}</span>{/if}
        {#if run}
          <span class="text-muted-foreground ml-1 flex items-center gap-1.5 text-[12px]">
            {#if running}
              <span class="bg-live soft-pulse size-1.5 rounded-full"></span>Running
            {:else if run.status === "failed"}
              <Icon icon={AlertCircleIcon} class="text-destructive size-3.5" />Failed
            {:else}
              <Icon icon={Tick02Icon} class="size-3.5" />Done
            {/if}
            <span class="num">{durationShort(elapsed)}</span>
          </span>
        {/if}
      </div>
      <Sheet.Description class="sr-only">Transcript of the {meta?.label ?? "agent"} subagent</Sheet.Description>
      {#if recent.length > 1}
        <ul class="-mx-1 flex gap-1.5 no-scrollbar overflow-x-auto px-1 pb-0.5" aria-label="Recent agent runs">
          {#each recent as r (r.id)}
            <li>
              <button
                type="button"
                aria-current={r.id === id}
                onclick={() => openAgent(r.id, scope.simRunId)}
                class={cn(
                  "border-border text-muted-foreground hover:text-foreground flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] whitespace-nowrap",
                  r.id === id && "border-primary/60 text-foreground bg-primary/10",
                )}
              >
                {#if r.status === "running"}<span class="bg-live soft-pulse size-1.5 rounded-full"></span>{/if}
                {ROLE_META[r.role].label}{#if r.symbol}<span class="num opacity-70">{r.symbol}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </Sheet.Header>

    <div class="pb-safe flex min-h-0 flex-1 flex-col">
      {#if !run}
        <p class="text-muted-foreground p-4 text-[13px]">This run is no longer available.</p>
      {:else}
        <StickyScroll label="Agent transcript">
          <div class="border-border bg-muted/40 rounded-lg border px-3 py-2.5">
            <h3 class="label-caps mb-1">Task</h3>
            <p class="text-[13px] leading-relaxed">{run.task}</p>
          </div>
          <Transcript {messages} draft={transcript.draft} calls={transcript.calls} {running} agentLabel={meta?.label ?? "Agent"} />
          {#if run.answer}
            <section class="rise-in border-primary/40 bg-primary/8 rounded-lg border px-3.5 py-3" aria-label="Final answer">
              <h3 class="label-caps text-primary mb-1.5">Final answer</h3>
              <div class="text-[14px]"><Markdown text={run.answer} /></div>
            </section>
          {/if}
        </StickyScroll>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
