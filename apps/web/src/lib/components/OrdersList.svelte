<script lang="ts">
  import type { OrderStatus } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import Empty from "./Empty.svelte";
  import RiskChecks from "./RiskChecks.svelte";
  import SideBadge from "./SideBadge.svelte";
  import Ticker from "./Ticker.svelte";
  import { etStamp, qty, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { STATUS_LABEL } from "$lib/orders";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  const style = (s: OrderStatus) =>
    ({
      pending_approval: "bg-warn-bg text-warn",
      submitted: "bg-primary/15 text-primary",
      failed: "bg-destructive/15 text-destructive",
      rejected_risk: "bg-muted text-muted-foreground",
      rejected_user: "bg-muted text-muted-foreground",
      expired: "bg-muted text-muted-foreground",
    })[s];
</script>

{#if !harness.loaded}
  <div class="bg-muted/60 m-3 h-12 animate-pulse rounded"></div>
{:else if harness.orders.length === 0}
  <Empty text="No orders yet" />
{:else}
  <ul class="divide-border divide-y">
    {#each harness.orders as o (o.id)}
      <li>
        <Collapsible.Root>
          <Collapsible.Trigger class="hover:bg-muted/50 flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors">
            <SideBadge side={o.intent.side} />
            <span class="min-w-0 flex-1">
              <span class="num flex flex-wrap items-baseline gap-x-2">
                <Ticker symbol={o.intent.symbol} />
                <span class="text-muted-foreground text-[12.5px]">{qty(o.intent.quantity)} @ {usd(o.intent.limitPrice)}</span>
              </span>
              <span class="num text-muted-foreground text-[11.5px]">{etStamp(o.createdAt, clock.now)}</span>
            </span>
            <span class={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", style(o.status))}>
              {STATUS_LABEL[o.status]}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div class="flex flex-col gap-2.5 px-3.5 pb-3 text-[13px]">
              <p class="leading-relaxed">{o.intent.thesis}</p>
              <RiskChecks verdict={o.verdict} />
              {#if o.review}
                <div>
                  <div class="label-caps mb-0.5">Robinhood review</div>
                  <p class="text-muted-foreground text-[12.5px] leading-relaxed whitespace-pre-wrap">{o.review}</p>
                </div>
              {/if}
              {#if o.error}<p class="text-destructive text-[12.5px]">{o.error}</p>{/if}
              {#if o.brokerOrderId}<p class="num text-muted-foreground text-[11.5px]">Broker order {o.brokerOrderId}</p>{/if}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </li>
    {/each}
  </ul>
{/if}
