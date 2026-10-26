<script lang="ts">
  import type { SimSuite } from "@rh/shared";
  import { isActive, suiteProgress } from "$lib/sim";
  import type { SimRun } from "@rh/shared";
  import RunStatus from "./RunStatus.svelte";
  import { cn } from "$lib/utils.js";

  let { suite, runs, active = false, onopen }: {
    suite: SimSuite;
    runs: readonly SimRun[];
    active?: boolean;
    onopen: () => void;
  } = $props();

  const progress = $derived(suiteProgress(suite, runs));
  const live = $derived(isActive(suite.status));
  const variants = $derived(suite.config.variants.map((v) => v.label).join(" vs "));
</script>

<article
  class={cn(
    "border-border bg-card relative flex rounded-lg border transition-colors",
    active && "border-lab/60 bg-lab-bg",
  )}
>
  <button
    type="button"
    onclick={onopen}
    aria-current={active}
    class="hover:bg-muted/40 flex min-w-0 flex-1 flex-col gap-2 rounded-lg py-3 pr-3 pl-3 text-left transition-colors"
  >
    <span class="flex items-start gap-2">
      <span class="min-w-0 flex-1 text-[13.5px] leading-snug font-medium">
        <span class="line-clamp-2">{suite.config.name}</span>
      </span>
      <RunStatus status={suite.status} class="mt-0.5" />
    </span>

    <span class="text-muted-foreground num flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
      {progress.done} of {progress.total} runs done · {variants}
      {#if suite.startedBy === "agent"}
        <span class="bg-secondary text-foreground rounded px-1.5 py-px font-sans text-[10.5px] font-medium">By agent</span>
      {/if}
    </span>

    {#if live && progress.total > 0}
      <span class="bg-muted block h-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total} aria-label="Suite progress">
        <span class="bg-lab block h-full rounded-full transition-[width] duration-500" style:width={`${(progress.done / progress.total) * 100}%`}></span>
      </span>
    {/if}

    {#if suite.comparison}
      {@const d = suite.comparison.meanDiff}
      {@const tone = d > 0 ? "text-gain" : d < 0 ? "text-loss" : "text-muted-foreground"}
      {@const leader = d === 0 ? "Tied" : d > 0 ? suite.config.variants[1]?.label : suite.config.variants[0]?.label}
      {@const trailer = d === 0 ? "" : d > 0 ? suite.config.variants[0]?.label : suite.config.variants[1]?.label}
      <span class="num text-[12px]">
        <span class={cn("font-medium", tone)}>{leader}{trailer ? ` +${Math.abs(d).toFixed(1)}` : ""}{trailer ? ` vs ${trailer}` : ""}</span>
        <span class="text-muted-foreground"> · excess, 95% {suite.comparison.ci95[0].toFixed(1)} to {suite.comparison.ci95[1].toFixed(1)}</span>
      </span>
    {/if}
  </button>
</article>
