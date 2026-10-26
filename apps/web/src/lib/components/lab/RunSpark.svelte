<script lang="ts">
  import type { SimRun } from "@rh/shared";
  import { cn } from "$lib/utils.js";

  let { run, class: className = "" }: { run: SimRun; class?: string } = $props();

  const W = 120;
  const H = 36;
  const model = $derived.by(() => {
    const base = run.config.startingCash;
    const eq = [base, ...run.equity.map((p) => p.equity)];
    const bm = [base, ...run.equity.map((p) => p.benchmark)];
    const all = [...eq, ...bm];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo || 1;
    const total = Math.max(run.progress.days, eq.length - 1, 1);
    const path = (v: number[]) =>
      v.map((y, i) => `${i ? "L" : "M"}${((i / total) * W).toFixed(1)} ${(H - 3 - ((y - lo) / span) * (H - 6)).toFixed(1)}`).join(" ");
    return { eq: path(eq), bm: path(bm), up: eq.at(-1)! >= base, points: eq.length };
  });
</script>

<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class={cn("h-9 w-full", className)} role="img" aria-label="Equity against SPY">
  {#if model.points > 1}
    <path d={model.bm} fill="none" stroke="var(--muted-foreground)" stroke-width="1.25" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" opacity="0.75" />
    <path d={model.eq} fill="none" stroke={model.up ? "var(--gain)" : "var(--loss)"} stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  {:else}
    <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
  {/if}
</svg>
