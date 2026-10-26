<script lang="ts">
  import type { Snippet } from "svelte";
  import { openSymbol } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let { symbol, class: className = "", children }: { symbol: string; class?: string; children?: Snippet } = $props();

  function open(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    openSymbol(symbol);
  }
</script>

<!-- A span so it can sit inside collapsible row triggers, which are buttons themselves. -->
<span
  role="button"
  tabindex="0"
  class={cn(
    "num hover:text-primary focus-visible:text-primary decoration-muted-foreground/40 -mx-1 inline-block cursor-pointer rounded px-1 font-semibold underline-offset-4 transition-colors hover:underline",
    className,
  )}
  aria-label={`Open ${symbol} chart`}
  onclick={open}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") open(e);
  }}
>
  {#if children}{@render children()}{:else}{symbol}{/if}
</span>
