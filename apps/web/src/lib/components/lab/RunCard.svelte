<script lang="ts">
  import type { SimRun } from "@rh/shared";
  import Icon from "../Icon.svelte";
  import Pnl from "../Pnl.svelte";
  import RunSpark from "./RunSpark.svelte";
  import RunStatus from "./RunStatus.svelte";
  import { Tick02Icon } from "$lib/icons";
  import { isoShort } from "$lib/format";
  import { isActive, progressFraction, runNumbers, runTitle } from "$lib/sim";
  import { cn } from "$lib/utils.js";

  let { run, active = false, selected = false, onopen, ontoggle }: {
    run: SimRun;
    /** Open in the detail pane. */
    active?: boolean;
    /** Ticked for comparison. */
    selected?: boolean;
    onopen: () => void;
    ontoggle: () => void;
  } = $props();

  const numbers = $derived(runNumbers(run));
  const live = $derived(isActive(run.status));
  const where = $derived(
    live
      ? `Day ${run.progress.day} of ${run.progress.days}${run.currentDate ? ` · ${isoShort(run.currentDate)}` : ""} · cycle ${run.progress.cycle}/${run.progress.cyclesPerDay}`
      : `${run.equity.length} of ${run.progress.days} days · from ${isoShort(run.config.startDate)}`,
  );
</script>

<article
  class={cn(
    "border-border bg-card relative flex rounded-lg border transition-colors",
    active && "border-lab/60 bg-lab-bg",
    selected && !active && "border-lab/40",
  )}
>
  <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    aria-label={`Compare ${runTitle(run)}`}
    onclick={ontoggle}
    class="grid w-11 shrink-0 place-items-start justify-center pt-3.5"
  >
    <span
      class={cn(
        "border-input grid size-[18px] place-items-center rounded-[5px] border transition-colors",
        selected && "bg-lab border-lab text-background",
      )}
    >
      {#if selected}<Icon icon={Tick02Icon} class="size-3.5" strokeWidth={2.6} />{/if}
    </span>
  </button>

  <button
    type="button"
    onclick={onopen}
    aria-current={active}
    class="hover:bg-muted/40 flex min-w-0 flex-1 flex-col gap-2 rounded-r-lg py-3 pr-3 text-left transition-colors"
  >
    <span class="flex items-start gap-2">
      <span class="min-w-0 flex-1 text-[13.5px] leading-snug font-medium">
        <span class="line-clamp-2">{runTitle(run)}</span>
      </span>
      <RunStatus status={run.status} class="mt-0.5" />
    </span>

    <span class="text-muted-foreground num flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
      {where}
      {#if run.startedBy === "agent"}
        <span class="bg-secondary text-foreground rounded px-1.5 py-px font-sans text-[10.5px] font-medium">By agent</span>
      {/if}
    </span>

    {#if live}
      <span class="bg-muted block h-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={run.progress.day} aria-valuemin={0} aria-valuemax={run.progress.days} aria-label="Simulation progress">
        <span class="bg-lab block h-full rounded-full transition-[width] duration-500" style:width={`${progressFraction(run) * 100}%`}></span>
      </span>
    {/if}

    <span class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
      <RunSpark {run} />
      <span class="num grid grid-cols-[auto_auto] items-baseline gap-x-2 gap-y-0.5 text-right text-[11.5px]">
        {#if numbers}
          <span class="text-muted-foreground">Return</span><Pnl percent={numbers.returnPct} class="text-[13px] font-medium" />
          <span class="text-muted-foreground">SPY</span><Pnl percent={numbers.benchmarkReturnPct} />
          <span class="text-muted-foreground">Max DD</span><span>{numbers.maxDrawdownPct.toFixed(2)}%</span>
        {:else}
          <span class="text-muted-foreground col-span-2">No closes yet</span>
        {/if}
      </span>
    </span>
  </button>
</article>
