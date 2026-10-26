<script lang="ts">
  import { isCryptoSymbol, type OrderRecord } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import RiskChecks from "./RiskChecks.svelte";
  import MiniChart from "./MiniChart.svelte";
  import SideBadge from "./SideBadge.svelte";
  import Ticker from "./Ticker.svelte";
  import { ago, pctSigned, priceFor, qtyFor, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { expectedValuePct, notional } from "$lib/orders";
  import { harness } from "$lib/store.svelte";

  let { order }: { order: OrderRecord } = $props();
  const i = $derived(order.intent);
  const ev = $derived(expectedValuePct(i));
  const busy = $derived(harness.busy[`order:${order.id}`] ?? false);
  let rejecting = $state(false);
  let reason = $state("");
  let expanded = $state(false);
</script>

<article class="border-border bg-card flex flex-col gap-2.5 rounded-lg border p-3" aria-label={`${i.side} ${i.symbol}`}>
  <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
    <SideBadge side={i.side} />
    <Ticker symbol={i.symbol} class="text-[15px]" />
    <span class="num text-muted-foreground">{qtyFor(i.symbol, i.quantity)} @ {priceFor(i.symbol, i.limitPrice)}</span>
    {#if i.orderType === "stop_limit" && i.stopPrice}
      <span class="num text-muted-foreground text-[12px]">stop {priceFor(i.symbol, i.stopPrice)}</span>
    {/if}
    <span class="num ml-auto text-[13px] font-medium">{usd(notional(i))}</span>
  </header>

  <div>
    <p class={expanded ? "text-[13px] leading-relaxed" : "line-clamp-2 text-[13px] leading-relaxed"}>{i.thesis}</p>
    {#if i.thesis.length > 110}
      <button class="text-primary mt-0.5 min-h-6 text-[12px] hover:underline" onclick={() => (expanded = !expanded)}>
        {expanded ? "Show less" : "Show more"}
      </button>
    {/if}
  </div>

  <MiniChart symbol={i.symbol} limit={i.limitPrice} invalidation={i.invalidationPrice} />

  <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-[12.5px]">
    <div>
      <dt class="label-caps">Invalidation</dt>
      <dd class="num mt-0.5">{priceFor(i.symbol, i.invalidationPrice)}</dd>
    </div>
    <div>
      <dt class="label-caps">Time stop</dt>
      <dd class="num mt-0.5">{i.timeStopDate}</dd>
    </div>
    <div>
      <dt class="label-caps">Expected value</dt>
      <dd class={`num mt-0.5 ${ev >= 0 ? "" : "text-loss"}`}>
        {pctSigned(ev)}
        <span class="text-muted-foreground block text-[11.5px]">win {Math.round(i.probabilityWin * 100)}%</span>
      </dd>
    </div>
  </dl>

  <RiskChecks verdict={order.verdict} />

  {#if rejecting}
    <form
      class="flex flex-col gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void harness.reject(order.id, reason);
      }}
    >
      <label class="sr-only" for={`reason-${order.id}`}>Reason for rejecting (optional)</label>
      <Input id={`reason-${order.id}`} bind:value={reason} placeholder="Reason (optional)" maxlength={500} class="h-10" />
      <div class="flex gap-2">
        <Button type="submit" variant="destructive" class="h-10 flex-1" disabled={busy}>Confirm reject</Button>
        <Button type="button" variant="ghost" class="h-10" onclick={() => (rejecting = false)}>Cancel</Button>
      </div>
    </form>
  {:else}
    <div class="flex items-center gap-2">
      <Button class="h-10 flex-1 md:h-9" disabled={busy || harness.status?.settings.killSwitch} onclick={() => harness.approve(order.id)}>
        Approve
      </Button>
      <Button variant="outline" class="h-10 flex-1 md:h-9" disabled={busy} onclick={() => (rejecting = true)}>Reject</Button>
      <span class="num text-muted-foreground w-16 text-right text-[11px]">{ago(order.createdAt, clock.now)}</span>
    </div>
    {#if harness.status?.settings.killSwitch}
      <p class="text-warn text-[12px]">Kill switch is engaged. Release it to approve.</p>
    {/if}
  {/if}
</article>
