<script lang="ts">
  import PriceChart from "./PriceChart.svelte";
  import { usd } from "$lib/format";
  import { harness } from "$lib/store.svelte";

  let { symbol, limit, invalidation }: { symbol: string; limit: number; invalidation: number } = $props();

  $effect(() => {
    void harness.loadHistory(symbol, "3m");
  });

  const entry = $derived(harness.history[`${symbol}:3m`]);
  const bars = $derived(entry?.data?.bars ?? []);
  const lines = $derived([
    { price: limit, label: `Limit ${usd(limit)}`, tone: "primary" as const },
    { price: invalidation, label: `Invalid ${usd(invalidation)}`, tone: "loss" as const },
  ]);
</script>

{#if bars.length > 0}
  <div class="relative">
    <PriceChart {bars} mini {lines} class="h-24 w-full" />
    <div class="num pointer-events-none absolute top-0 left-0 flex gap-3 text-[10.5px]">
      <span class="text-primary flex items-center gap-1"><i class="bg-primary inline-block h-px w-3"></i>Limit {usd(limit)}</span>
      <span class="text-loss flex items-center gap-1"><i class="bg-loss inline-block h-px w-3"></i>Invalidation {usd(invalidation)}</span>
    </div>
  </div>
{:else if entry?.state !== "error"}
  <div class="bg-muted/50 h-24 animate-pulse rounded" aria-hidden="true"></div>
{/if}
