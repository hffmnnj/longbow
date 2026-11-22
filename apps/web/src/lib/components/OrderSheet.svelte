<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import OrderCard from "./OrderCard.svelte";
  import RiskChecks from "./RiskChecks.svelte";
  import SideBadge from "./SideBadge.svelte";
  import Ticker from "./Ticker.svelte";
  import { etStamp, isoDay, priceFor, qtyFor, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import {
    fractionalQuoteLabel,
    isOptionIntent,
    isValidOptionIntent,
    notional,
    optionBadgeLabel,
    optionBadgeTitle,
    optionCompactUnit,
    optionFilledTotal,
    optionLimitHeading,
    optionLimitPerShare,
    optionPerUnit,
    optionProblem,
    optionSectionHeading,
    optionSettlementNote,
    optionSideLabel,
    optionStrike,
    optionTotal,
    optionTypeLabel,
    orderStatusLabel,
  } from "$lib/orders";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";

  const order = $derived(harness.orders.find((o) => o.id === ui.order));
  let last = $state<typeof order>();
  $effect(() => {
    if (order) last = order;
  });
  const shown = $derived(order ?? last);
  const shownIsOption = $derived(shown ? isOptionIntent(shown.intent) : false);
  const shownValidOption = $derived(shown ? isValidOptionIntent(shown.intent) : false);
  const shownProblem = $derived(shown && shownIsOption ? optionProblem(shown.intent) : undefined);
  const shownTicket = $derived(shown?.intent.longOption);
</script>

<Sheet.Root open={ui.order !== null} onOpenChange={(o) => !o && (ui.order = null)}>
  <Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg gap-0">
    <Sheet.Header class="border-border border-b pr-14">
      <Sheet.Title class="flex items-center gap-2">
        {#if shown}
          <SideBadge side={shown.intent.side} />
          {#if shownIsOption}
            <span
              class="border-primary/40 text-primary inline-flex h-5 items-center rounded border px-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
              title={shownTicket ? optionBadgeTitle(shownTicket) : "Option details need review"}
            >
              {shownTicket ? optionBadgeLabel(shownTicket) : "Option"}
            </span>
          {/if}
          <Ticker symbol={shown.intent.symbol} />
        {:else}Order{/if}
      </Sheet.Title>
      <Sheet.Description class="num">
        {#if shown}{orderStatusLabel(shown)} · {etStamp(shown.createdAt, clock.now)}{:else}Not found{/if}
      </Sheet.Description>
    </Sheet.Header>
    <div class="pb-safe min-h-0 flex-1 overflow-y-auto p-4">
      {#if !shown}
        <p class="text-muted-foreground text-[13px]">This order is no longer in the recent list.</p>
      {:else if shown.status === "pending_approval"}
        <OrderCard order={shown} />
      {:else if shownIsOption && shownTicket && shownValidOption}
        {@const t = shownTicket}
        <div class="flex flex-col gap-4 text-[13px]">
          <div class="border-primary/30 bg-primary/5 rounded-md border px-2.5 py-2">
            <p class="label-caps">{optionSectionHeading(t)}</p>
            <p class="num mt-1 leading-relaxed">
              {optionSideLabel(t)} {t.contracts} {t.contracts === 1 ? "contract" : "contracts"} of {t.symbol} ·
              {usd(optionStrike(t))} {t.contractType} · Exp {isoDay(t.expiration)} {t.expiration.slice(0, 4)}
            </p>
            <p class="num mt-0.5 leading-relaxed">
              Limit {usd(optionLimitPerShare(t))} {optionPerUnit(t)} ·
              Total {usd(optionTotal(t))} {t.side === "buy-to-open" ? "debit" : "proceeds"} before fees
            </p>
            <p class="text-muted-foreground mt-1 leading-relaxed">{optionSettlementNote(t)} A fill is not guaranteed at the limit.</p>
          </div>
          <dl class="num grid grid-cols-2 gap-3">
            <div><dt class="label-caps">Side</dt><dd>{optionSideLabel(t)}</dd></div>
            <div><dt class="label-caps">Contracts</dt><dd>{t.contracts}</dd></div>
            <div><dt class="label-caps">{optionLimitHeading(t)}</dt><dd>{usd(optionLimitPerShare(t))}</dd></div>
            <div><dt class="label-caps">Total at limit</dt><dd>{usd(optionTotal(t))} {t.side === "buy-to-open" ? "debit" : "proceeds"}</dd></div>
            <div><dt class="label-caps">Strike</dt><dd>{usd(optionStrike(t))} {optionTypeLabel(t).toLowerCase()}</dd></div>
            <div><dt class="label-caps">Expiration</dt><dd title={t.expiration}>{isoDay(t.expiration)} {t.expiration.slice(0, 4)}</dd></div>
            <div><dt class="label-caps">Time in force</dt><dd>Day · order expires at today's close</dd></div>
            <div><dt class="label-caps">Underlying invalidation</dt><dd>{priceFor(shown.intent.symbol, shown.intent.invalidationPrice)}</dd></div>
            <div><dt class="label-caps">Time stop</dt><dd>{shown.intent.timeStopDate}</dd></div>
            {#if shown.averageFillPrice !== undefined}
              <div>
                <dt class="label-caps">Filled</dt>
                <dd>
                  {qtyFor(shown.intent.symbol, shown.filledQuantity ?? 0)} of {qtyFor(shown.intent.symbol, shown.intent.quantity)} contracts @ {usd(shown.averageFillPrice)}{optionCompactUnit(t)} ·
                  {usd(optionFilledTotal(shown.filledQuantity ?? 0, shown.averageFillPrice))}
                </dd>
              </div>
            {/if}
          </dl>
          <p class="leading-relaxed">{shown.intent.thesis}</p>
          {#if shown.error}<p class="text-destructive">{shown.error}</p>{/if}
          {#if shown.review}<p class="text-muted-foreground">{shown.review}</p>{/if}
          <RiskChecks verdict={shown.verdict} />
        </div>
      {:else if shownIsOption}
        <div class="flex flex-col gap-4 text-[13px]">
          <div class="border-destructive/30 bg-destructive/5 rounded-md border px-2.5 py-2">
            <p class="font-medium">Option details need review.</p>
            <p class="text-muted-foreground mt-0.5">{shownProblem ?? "Contract details are incomplete or malformed."} This ticket shows no share quantity, price, or approval.</p>
          </div>
          <p class="leading-relaxed">{shown.intent.thesis}</p>
          {#if shown.error}<p class="text-destructive">{shown.error}</p>{/if}
          {#if shown.review}<p class="text-muted-foreground">{shown.review}</p>{/if}
          <RiskChecks verdict={shown.verdict} />
        </div>
      {:else}
        {@const quoteLabel = fractionalQuoteLabel(shown.intent)}
        <div class="flex flex-col gap-4 text-[13px]">
          <dl class="num grid grid-cols-2 gap-3">
            <div><dt class="label-caps">Size</dt><dd>{qtyFor(shown.intent.symbol, shown.intent.quantity)}{#if !quoteLabel} @ {priceFor(shown.intent.symbol, shown.intent.limitPrice)}{/if}</dd></div>
            {#if quoteLabel}
              <div><dt class="label-caps">{quoteLabel}</dt><dd>{priceFor(shown.intent.symbol, shown.intent.limitPrice)}</dd></div>
            {/if}
            <div><dt class="label-caps">{quoteLabel ? "Intent notional" : "Notional"}</dt><dd>{usd(notional(shown.intent))}</dd></div>
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
