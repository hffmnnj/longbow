<script lang="ts">
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { symbol, class: className = "" }: { symbol: string; class?: string } = $props();

  $effect(() => {
    void harness.loadHistory(symbol, "1m");
  });

  const entry = $derived(harness.history[`${symbol}:1m`]);
  const closes = $derived(entry?.data?.bars.map((b) => b.close) ?? []);
  const W = 64;
  const H = 22;
  const path = $derived.by(() => {
    if (closes.length < 2) return "";
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    const span = hi - lo || 1;
    return closes
      .map((c, i) => `${i ? "L" : "M"}${((i / (closes.length - 1)) * W).toFixed(1)} ${(H - 2 - ((c - lo) / span) * (H - 4)).toFixed(1)}`)
      .join(" ");
  });
  const up = $derived(closes.length > 1 && closes[closes.length - 1]! >= closes[0]!);
</script>

{#if path}
  <svg viewBox={`0 0 ${W} ${H}`} class={cn("h-[22px] w-16", up ? "text-gain" : "text-loss", className)} role="img" aria-label={`${symbol} one month trend`}>
    <path d={path} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
{:else if entry?.state === "error"}
  <span class="text-muted-foreground text-[11px]">&mdash;</span>
{:else}
  <span class="bg-muted/70 block h-3 w-16 animate-pulse rounded"></span>
{/if}
