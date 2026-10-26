<script lang="ts">
  import DitherSpark from "./viz/DitherSpark.svelte";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { symbol, class: className = "" }: { symbol: string; class?: string } = $props();

  $effect(() => {
    void harness.loadHistory(symbol, "1m");
  });

  const entry = $derived(harness.history[`${symbol}:1m`]);
  const closes = $derived(entry?.data?.bars.map((b) => b.close) ?? []);
</script>

{#if closes.length > 1}
  <DitherSpark values={closes} label={`${symbol} one month trend`} class={cn("h-6 w-16", className)} />
{:else if entry?.state === "error"}
  <span class="text-muted-foreground text-[11px]">&mdash;</span>
{:else}
  <span class="bg-muted/70 block h-3 w-16 animate-pulse rounded"></span>
{/if}
