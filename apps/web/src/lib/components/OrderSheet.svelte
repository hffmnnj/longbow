<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import OrderCard from "./OrderCard.svelte";
  import RiskChecks from "./RiskChecks.svelte";
  import SideBadge from "./SideBadge.svelte";
  import Ticker from "./Ticker.svelte";
  import { etStamp, priceFor, qtyFor, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { notional, STATUS_LABEL } from "$lib/orders";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";

  const order = $derived(harness.orders.find((o) => o.id === ui.order));
  let last = $state<typeof order>();
  $effect(() => {
    if (order) last = order;
  });
  const shown = $derived(order ?? last);
</script>

<Sheet.Root open={ui.order !== null} onOpenChange={(o) => !o && (ui.order = null)}>
  <Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg gap-0">
    <Sheet.Header class="border-border border-b pr-14">
      <Sheet.Title class="flex items-center gap-2">
        {#if shown}<SideBadge side={shown.intent.side} /><Ticker symbol={shown.intent.symbol} />{:else}Order{/if}
      </Sheet.Title>
      <Sheet.Description class="num">
        {#if shown}{STATUS_LABEL[shown.status]} · {etStamp(shown.createdAt, clock.now)}{:else}Not found{/if}
      </Sheet.Description>
    </Sheet.Header>
    <div class="pb-safe min-h-0 flex-1 overflow-y-auto p-4">
      {#if !shown}
        <p class="text-muted-foreground text-[13px]">This order is no longer in the recent list.</p>
      {:else if shown.status === "pending_approval"}
        <OrderCard order={shown} />
      {:else}
        <div class="flex flex-col gap-4 text-[13px]">
          <dl class="num grid grid-cols-2 gap-3">
            <div><dt class="label-caps">Size</dt><dd>{qtyFor(shown.intent.symbol, shown.intent.quantity)} @ {priceFor(shown.intent.symbol, shown.intent.limitPrice)}</dd></div>
            <div><dt class="label-caps">Notional</dt><dd>{usd(notional(shown.intent))}</dd></div>
            <div><dt class="label-caps">Invalidation</dt><dd>{priceFor(shown.intent.symbol, shown.intent.invalidationPrice)}</dd></div>
            <div><dt class="label-caps">Time stop</dt><dd>{shown.intent.timeStopDate}</dd></div>
            {#if shown.averageFillPrice !== undefined}
              <div><dt class="label-caps">Filled</dt><dd>{qtyFor(shown.intent.symbol, shown.filledQuantity ?? 0)} @ {priceFor(shown.intent.symbol, shown.averageFillPrice)}</dd></div>
            {/if}
          </dl>
          <p class="leading-relaxed">{shown.intent.thesis}</p>
          {#if shown.error}<p class="text-destructive">{shown.error}</p>{/if}
          {#if shown.review}<p class="text-muted-foreground">{shown.review}</p>{/if}
          <RiskChecks verdict={shown.verdict} />
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
