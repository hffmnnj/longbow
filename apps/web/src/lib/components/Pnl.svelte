<script lang="ts">
  import { cn } from "$lib/utils.js";
  import { pctSigned, tone, usdSigned } from "$lib/format";

  let { amount, percent, class: className = "", showAmount = true }: {
    amount?: number;
    percent?: number;
    class?: string;
    showAmount?: boolean;
  } = $props();

  const t = $derived(tone(amount ?? percent ?? 0));
</script>

<span
  class={cn(
    "num whitespace-nowrap",
    t === "gain" && "text-gain",
    t === "loss" && "text-loss",
    t === "flat" && "text-muted-foreground",
    className,
  )}
>
  {#if amount !== undefined && showAmount}{usdSigned(amount)}{/if}
  {#if percent !== undefined}
    {#if amount !== undefined && showAmount}<span class="opacity-80">({pctSigned(percent)})</span>{:else}{pctSigned(percent)}{/if}
  {/if}
</span>
