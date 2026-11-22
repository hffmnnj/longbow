<script lang="ts">
  import { isCryptoSymbol, type OrderStatus } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import Empty from "./Empty.svelte";
  import RiskChecks from "./RiskChecks.svelte";
  import SideBadge from "./SideBadge.svelte";
  import Ticker from "./Ticker.svelte";
  import { etStamp, isoDay, isoShort, qtyFor, qtyUnit, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import {
    fractionalQuoteLabel,
    isOptionIntent,
    isValidOptionIntent,
    optionFilledTotal,
    optionLimitPerShare,
    optionProblem,
    optionSideLabel,
    optionStrike,
    optionTotal,
    optionTypeLabel,
    orderStatusLabel,
  } from "$lib/orders";
  import { useScope } from "$lib/scope";
  import { cn } from "$lib/utils.js";

  const style = (s: OrderStatus): string =>
    ({
      pending_approval: "bg-warn-bg text-warn",
      submitted: "bg-primary/15 text-primary",
      held: "bg-muted text-muted-foreground",
      triggering: "bg-warn-bg text-warn",
      partially_filled: "bg-primary/15 text-primary",
      filled: "bg-gain/15 text-gain",
      cancelled: "bg-muted text-muted-foreground",
      failed: "bg-destructive/15 text-destructive",
      rejected_risk: "bg-muted text-muted-foreground",
      rejected_user: "bg-muted text-muted-foreground",
      expired: "bg-muted text-muted-foreground",
    })[s];
  const scope = useScope();
</script>

{#if !scope.loaded}
  <div class="bg-muted/60 m-3 h-12 animate-pulse rounded"></div>
{:else if scope.feed.orders.length === 0}
  <Empty text="No orders yet" />
{:else}
  <ul class="divide-border divide-y">
    {#each scope.feed.orders as o (o.id)}
      {@const quoteLabel = fractionalQuoteLabel(o.intent)}
      {@const opt = isOptionIntent(o.intent) ? o.intent.longOption : undefined}
      {@const optValid = isValidOptionIntent(o.intent)}
      {@const optProblem = isOptionIntent(o.intent) ? optionProblem(o.intent) : undefined}
      <li>
        <Collapsible.Root>
          <Collapsible.Trigger class="hover:bg-muted/50 flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors">
            <SideBadge side={o.intent.side} />
            {#if opt && optValid}
              <span
                class="border-primary/40 text-primary inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
                title="Standard 100-share long option"
              >
                Option
              </span>
            {:else if opt}
              <span class="border-destructive/40 text-destructive inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10.5px] font-semibold tracking-wider uppercase">Option</span>
            {/if}
            <span class="min-w-0 flex-1">
              <span class="num flex flex-wrap items-baseline gap-x-2">
                <Ticker symbol={o.intent.symbol} />
                {#if opt && optValid}
                  <span class="text-muted-foreground text-[12.5px]">
                    {opt.contracts} {opt.contracts === 1 ? "contract" : "contracts"} · {usd(optionStrike(opt))} {optionTypeLabel(opt).toLowerCase()} · Exp {isoShort(opt.expiration)} · {usd(optionLimitPerShare(opt))}/sh · {usd(optionTotal(opt))}{#if o.status === "partially_filled" && o.filledQuantity !== undefined} · {qtyFor(o.intent.symbol, o.filledQuantity)} of {qtyFor(o.intent.symbol, o.intent.quantity)} filled{/if}{#if o.status === "filled" && o.averageFillPrice !== undefined} · avg {usd(o.averageFillPrice)}/sh{/if}
                  </span>
                {:else if opt}
                  <span class="text-destructive text-[12.5px]">details need review</span>
                {:else}
                  <span class="text-muted-foreground text-[12.5px]">{qtyFor(o.intent.symbol, o.intent.quantity)}{#if quoteLabel} {qtyUnit(o.intent.symbol)} · {quoteLabel} {usd(o.intent.limitPrice)}{:else} @ {usd(o.intent.limitPrice)}{/if}{#if o.status === "partially_filled" && o.filledQuantity !== undefined} · {qtyFor(o.intent.symbol, o.filledQuantity)} of {qtyFor(o.intent.symbol, o.intent.quantity)} filled{/if}{#if o.status === "filled" && o.averageFillPrice !== undefined} · avg {usd(o.averageFillPrice)}{/if}</span>
                {/if}
              </span>
              <span class="num text-muted-foreground text-[11.5px]">{etStamp(o.createdAt, clock.now)}</span>
            </span>
            <span
              class={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", style(o.status))}
              title={o.status === "held" && !opt ? (isCryptoSymbol(o.intent.symbol) ? "Watched by the harness around the clock" : "Watched by the harness every minute during market hours") : o.status === "triggering" && opt ? "The placement attempt may or may not have reached Robinhood" : undefined}
            >
              {orderStatusLabel(o)}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div class="flex flex-col gap-2.5 px-3.5 pb-3 text-[13px]">
              {#if opt && optValid}
                <p class="num text-muted-foreground text-[12.5px] leading-relaxed">
                  {optionSideLabel(opt)} {opt.contracts} {opt.contracts === 1 ? "contract" : "contracts"} ·
                  {usd(optionStrike(opt))} {opt.contractType} · Exp {isoDay(opt.expiration)} {opt.expiration.slice(0, 4)} ·
                  Limit {usd(optionLimitPerShare(opt))} per share ·
                  Total {usd(optionTotal(opt))} {opt.side === "buy-to-open" ? "debit" : "proceeds"} before fees.
                  If exercised, this can create {opt.symbol} stock.
                </p>
                {#if o.status === "filled" || o.status === "partially_filled"}
                  {#if o.averageFillPrice !== undefined}
                    <p class="num text-muted-foreground text-[12.5px]">
                      Filled {qtyFor(o.intent.symbol, o.filledQuantity ?? 0)} of {qtyFor(o.intent.symbol, o.intent.quantity)} contracts @ {usd(o.averageFillPrice)}/share ·
                      {usd(optionFilledTotal(o.filledQuantity ?? 0, o.averageFillPrice))}
                    </p>
                  {/if}
                {/if}
              {:else if opt}
                <p class="text-destructive text-[12.5px]">{optProblem ?? "Contract details are incomplete or malformed."} This ticket shows no share quantity, price, or approval.</p>
              {/if}
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
