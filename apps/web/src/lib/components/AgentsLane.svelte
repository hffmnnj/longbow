<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import type { SubagentRun } from "@rh/shared";
  import Icon from "./Icon.svelte";
  import { AlertCircleIcon, Tick02Icon } from "$lib/icons";
  import { clock } from "$lib/clock.svelte";
  import { viewport } from "$lib/media.svelte";
  import { ROLE_META, latestLine } from "$lib/roles";
  import { useScope } from "$lib/scope";
  import { openAgent } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  const scope = useScope();
  const LINGER_MS = 7000;
  const runs = $derived(
    scope.feed.subagents
      .filter((r) => r.status === "running" || (r.endedAt !== undefined && clock.now - r.endedAt < LINGER_MS))
      .slice()
      .reverse(),
  );

  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ms = (n: number) => (reduced ? 0 : n);

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
  <section
    aria-label="Running agents"
    class={cn("border-border bg-bar flex shrink-0 gap-2 no-scrollbar overflow-x-auto border-t px-3", viewport.desktop ? "py-2.5" : "py-2")}
    transition:fade={{ duration: ms(160) }}
  >
    {#each runs as run (run.id)}
      {@const meta = ROLE_META[run.role]}
      <button
        type="button"
        onclick={() => openAgent(run.id, scope.simRunId)}
        in:fly={{ y: 8, duration: ms(200) }}
        out:fade={{ duration: ms(300) }}
        class={cn(
          "border-border bg-card hover:border-primary/50 flex min-w-0 flex-1 flex-col gap-1 rounded-lg border text-left transition-colors",
          viewport.desktop ? "min-w-[15rem] max-w-[22rem] px-3 py-2" : "min-w-[10.5rem] max-w-[14rem] px-2.5 py-1.5",
        )}
        aria-label={`${meta.label}${run.symbol ? ` on ${run.symbol}` : ""}, ${run.status}. Open transcript`}
      >
        <span class="flex items-center gap-1.5 text-[12px] font-medium">
          <Icon icon={meta.icon} class="text-muted-foreground size-3.5 shrink-0" />
          {meta.label}
          {#if run.symbol}<span class="num text-muted-foreground font-normal">{run.symbol}</span>{/if}
          <span class="flex-1"></span>
          {#if run.status === "running"}
            <span class="bg-live soft-pulse size-1.5 rounded-full" role="img" aria-label="running"></span>
          {:else if run.status === "failed"}
            <Icon icon={AlertCircleIcon} class="text-destructive size-3.5" />
          {:else}
            <Icon icon={Tick02Icon} class="text-muted-foreground size-3.5" />
          {/if}
        </span>
        <span class="text-muted-foreground block truncate text-[12px]">{line(run)}</span>
      </button>
    {/each}
  </section>
{/if}
