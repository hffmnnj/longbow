<script lang="ts">
  import { harness } from "$lib/store.svelte";
  import { clock } from "$lib/clock.svelte";
  import { countdown, etClock } from "$lib/format";
  import { cn } from "$lib/utils.js";

  const market = $derived(harness.status?.market);
  const label = $derived(
    market
      ? { regular: "Market open", pre: "Pre-market", post: "After hours", closed: "Market closed" }[market.session]
      : "",
  );
  const next = $derived(
    market
      ? market.isOpen
        ? { verb: market.earlyClose ? "Early close in" : "Closes in", at: market.nextClose }
        : { verb: "Opens in", at: market.nextOpen }
      : null,
  );
</script>

{#if market && next}
  <div class="flex flex-col leading-tight">
    <div class="flex items-center gap-1.5 text-[13px] font-medium">
      <span class={cn("size-1.5 rounded-full", market.isOpen ? "bg-live" : "bg-muted-foreground/60")}></span>
      {label}
      <span class="num text-muted-foreground font-normal">{etClock(clock.now)}</span>
    </div>
    <div class="text-muted-foreground text-[12px]">
      {next.verb} <span class="num text-foreground/85">{countdown(next.at - clock.now)}</span>
    </div>
  </div>
{:else}
  <div class="bg-muted h-8 w-36 animate-pulse rounded"></div>
{/if}
