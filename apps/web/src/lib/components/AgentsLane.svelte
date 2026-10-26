<script lang="ts">
  import type { SubagentRun } from "@rh/shared";
  import {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceDescription,
    TraceIcon,
    TraceLine,
    TraceTitle,
  } from "$lib/components/ui/trace/index.js";
  import Icon from "./Icon.svelte";
  import SubagentTrace from "./SubagentTrace.svelte";
  import { clock } from "$lib/clock.svelte";
  import { viewport } from "$lib/media.svelte";
  import { latestLine, ROLE_META } from "$lib/roles";
  import { useScope } from "$lib/scope";
  import { cn } from "$lib/utils.js";

  const scope = useScope();
  const LINGER_MS = 7000;
  const runs = $derived(
    scope.feed.subagents
      .filter((r) => r.status === "running" || (r.endedAt !== undefined && clock.now - r.endedAt < LINGER_MS))
      .slice()
      .reverse(),
  );

  let userOpen = $state<Record<string, boolean | undefined>>({});
  const isOpen = (run: SubagentRun) => userOpen[run.id] ?? run.status === "running";

  function line(run: SubagentRun): string {
    const t = scope.feed.transcripts[run.id];
    const lastAssistant = t?.messages.findLast((m) => m.role === "assistant")?.text;
    const lastTool = t?.messages.findLast((m) => m.role === "tool");
    return latestLine(
      t?.draft,
      run.status === "done" ? (run.answer ?? lastAssistant) : lastAssistant,
      lastTool ? `${lastTool.toolName ?? "tool"}: ${lastTool.text}` : run.task,
    );
  }
</script>

{#if runs.length > 0}
  <section aria-label="Running agents" class={cn("border-border bg-bar border-t px-3", viewport.desktop ? "py-2.5" : "py-2")}>
    <Trace>
      {#each runs as run (run.id)}
        {@const meta = ROLE_META[run.role]}
        {@const transcript = scope.feed.transcripts[run.id]}
        <TraceCollapsible open={isOpen(run)} onOpenChange={(v) => (userOpen[run.id] = v)}>
          <TraceCollapsibleTrigger
            aria-label={`${meta.label}${run.symbol ? ` on ${run.symbol}` : ""}, ${run.status}. ${line(run)}`}
          >
            <TraceLine status={run.status === "running" ? "running" : run.status === "failed" ? "error" : undefined}>
              <TraceIcon><Icon icon={meta.icon} /></TraceIcon>
              <TraceTitle
                >{meta.label}{#if run.symbol}<span class="num font-normal"> on {run.symbol}</span>{/if}</TraceTitle
              >
              <TraceDescription class="min-w-0 flex-1 truncate text-left">{line(run)}</TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent class="max-h-72 overflow-y-auto">
            {#if transcript}
              <SubagentTrace {run} {transcript} running={run.status === "running"} />
            {:else}
              <p class="text-[12.5px]">No transcript yet.</p>
            {/if}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      {/each}
    </Trace>
  </section>
{/if}
