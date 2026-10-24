<script lang="ts">
  import type { HistoryRange, SymbolDetail } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import DecisionCard from "./DecisionCard.svelte";
  import DitherBar from "./viz/DitherBar.svelte";
  import Markdown from "./Markdown.svelte";
  import Pnl from "./Pnl.svelte";
  import PriceChart from "./PriceChart.svelte";
  import RangeToggle from "./RangeToggle.svelte";
  import SideBadge from "./SideBadge.svelte";
  import { periodReturn } from "$lib/chart";
  import { rangePosition } from "$lib/analytics";
  import { clock } from "$lib/clock.svelte";
  import { ago, isoDay, pct, qty, usd, usdCompact } from "$lib/format";
  import { notional, STATUS_LABEL } from "$lib/orders";
  import { harness } from "$lib/store.svelte";
  import { openNote, openOrder, ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let range = $state<HistoryRange>("1y");
  let last = $state("");
  $effect(() => {
    if (ui.symbol) last = ui.symbol;
  });
  const symbol = $derived(ui.symbol ?? last);

  $effect(() => {
    if (!ui.symbol || !harness.loaded) return;
    void harness.loadHistory(ui.symbol, range);
    void harness.loadSymbolDetail(ui.symbol);
  });

  const entry = $derived(harness.history[`${symbol}:${range}`]);
  const detailLoad = $derived(harness.symbolDetail[symbol]);
  const detail = $derived<SymbolDetail | undefined>(detailLoad?.data);
  const bars = $derived(entry?.data?.bars ?? []);
  const lastClose = $derived(detail?.quote?.last ?? bars[bars.length - 1]?.close);
  const ret = $derived(periodReturn(bars));
  const position = $derived(detail?.position ?? harness.positions.find((p) => p.symbol === symbol));
  const ind = $derived(detail?.indicators);
  const thesisPath = $derived(`theses/${symbol}.md`);
  const hasThesis = $derived(harness.notes.some((n) => n.path === thesisPath));
  const thesisDoc = $derived(harness.docs[`note:${thesisPath}`]);
  const thesisText = $derived(detail?.thesis?.content ?? (thesisDoc?.state === "ready" ? thesisDoc.data : undefined));
  const journal = $derived(detail?.journal ?? harness.journal.filter((j) => j.symbol === symbol).slice(0, 5));
  const orders = $derived(detail?.orders ?? harness.orders.filter((o) => o.intent.symbol === symbol));
  const ordersById = $derived(new Map(harness.orders.map((o) => [o.id, o])));
  const lines = $derived(detail?.stop ? [{ price: detail.stop.price, label: `Stop ${usd(detail.stop.price)}`, tone: "loss" as const }] : []);
  const STOP_SOURCE = { held: "held stop", robinhood: "Robinhood stop order", thesis: "thesis invalidation" } as const;

  $effect(() => {
    if (ui.symbol && hasThesis && !detail?.thesis) void harness.loadDoc("note", thesisPath);
  });

  interface Cell {
    label: string;
    value: string;
    sub?: string;
    tone?: "gain" | "loss";
  }
  const vs = (price: number | undefined, avg: number | undefined, name: string): Cell => ({
    label: name,
    value: avg !== undefined ? usd(avg) : "\u2014",
    sub: price !== undefined && avg !== undefined ? `${price >= avg ? "price above" : "price below"} by ${pct(Math.abs(((price - avg) / avg) * 100))}` : undefined,
    tone: price !== undefined && avg !== undefined ? (price >= avg ? "gain" : "loss") : undefined,
  });
  const cells = $derived<Cell[]>(
    ind
      ? [
          vs(lastClose, ind.sma20, "20-day average"),
          vs(lastClose, ind.sma50, "50-day average"),
          vs(lastClose, ind.sma200, "200-day average"),
          {
            label: "RSI 14",
            value: ind.rsi14 !== undefined ? ind.rsi14.toFixed(0) : "\u2014",
            sub: ind.rsi14 === undefined ? undefined : ind.rsi14 >= 70 ? "overbought" : ind.rsi14 <= 30 ? "oversold" : "neutral",
          },
          {
            label: "ATR 14",
            value: ind.atr14 !== undefined ? usd(ind.atr14) : "\u2014",
            sub: ind.atr14 !== undefined && lastClose ? `${pct((ind.atr14 / lastClose) * 100)} of price` : undefined,
          },
          { label: "1M return", value: ind.return1m !== undefined ? pct(ind.return1m) : "\u2014", tone: ind.return1m === undefined ? undefined : ind.return1m >= 0 ? "gain" : "loss" },
          { label: "3M return", value: ind.return3m !== undefined ? pct(ind.return3m) : "\u2014", tone: ind.return3m === undefined ? undefined : ind.return3m >= 0 ? "gain" : "loss" },
          { label: "Avg $ volume", value: ind.avgDollarVolume !== undefined ? usdCompact(ind.avgDollarVolume) : "\u2014", sub: "20 sessions" },
        ]
      : [],
  );
</script>

<Sheet.Root
  open={ui.symbol !== null}
  onOpenChange={(o) => {
    if (!o) ui.symbol = null;
  }}
>
  <Sheet.Content
    side="right"
    class="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl gap-0"
    onOpenAutoFocus={(e) => e.preventDefault()}
  >
    <Sheet.Header class="border-border border-b pr-14">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Sheet.Title class="num text-[20px] font-semibold">{symbol}</Sheet.Title>
        {#if detail?.name}<span class="text-muted-foreground text-[13px]">{detail.name}</span>{/if}
        {#if lastClose !== undefined}
          <span class="num text-[17px]">{usd(lastClose)}</span>
        {/if}
        {#if ret !== undefined}
          <span class="flex items-baseline gap-1.5 text-[13px]">
            <Pnl percent={ret} />
            <span class="num text-muted-foreground text-[11.5px] uppercase">{range}</span>
          </span>
        {/if}
      </div>
      <Sheet.Description class="sr-only">Price history, indicators, thesis, position, orders and decisions for {symbol}</Sheet.Description>
    </Sheet.Header>

    <div class="pb-safe min-h-0 flex-1 overflow-y-auto">
      <div class="flex items-center justify-between gap-3 px-4 pt-3">
        <RangeToggle bind:value={range} />
        {#if detail?.nextEarnings}
          <span class="bg-warn-bg text-warn num rounded px-2 py-1 text-[12px] font-medium">Earnings {isoDay(detail.nextEarnings.date)}{detail.nextEarnings.time ? ` · ${detail.nextEarnings.time}` : ""}</span>
        {/if}
      </div>

      <div class="px-2 pt-2">
        {#if entry?.state === "error"}
          <div class="text-muted-foreground flex h-[340px] flex-col items-center justify-center gap-3 text-[13px]">
            <span>Could not load price history: {entry.error}</span>
            <Button size="sm" variant="outline" onclick={() => harness.retryHistory(symbol, range)}>Retry</Button>
          </div>
        {:else if bars.length === 0 && entry?.state === "ready"}
          <div class="text-muted-foreground grid h-[340px] place-items-center text-[13px]">No price history for {symbol}</div>
        {:else if bars.length === 0}
          <div class="bg-muted/50 mx-2 h-[340px] animate-pulse rounded-lg"></div>
        {:else}
          <PriceChart {bars} {lines} class="h-[340px] md:h-[380px]" />
        {/if}
      </div>

      <div class="flex flex-col gap-6 px-4 py-5">
        {#if detail?.stop}
          <p class="num text-[13px]">
            <span class="text-loss font-medium">Stop {usd(detail.stop.price)}</span>
            <span class="text-muted-foreground"> from the {STOP_SOURCE[detail.stop.source]}{#if lastClose} · price is {pct(((lastClose - detail.stop.price) / lastClose) * 100)} above it{/if}</span>
          </p>
        {/if}

        <section aria-label="Indicators" class="flex flex-col gap-2">
          <h3 class="label-caps">Indicators</h3>
          {#if cells.length > 0}
            <dl class="num grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              {#each cells as c (c.label)}
                <div class="min-w-0">
                  <dt class="text-muted-foreground text-[11px]">{c.label}</dt>
                  <dd class={cn("text-[13.5px]", c.tone === "gain" && "text-gain", c.tone === "loss" && "text-loss")}>{c.value}</dd>
                  {#if c.sub}<dd class="text-muted-foreground truncate text-[11px]">{c.sub}</dd>{/if}
                </div>
              {/each}
            </dl>
            {#if ind?.high52w !== undefined && ind.low52w !== undefined && lastClose !== undefined}
              <div class="mt-1">
                <div class="num text-muted-foreground mb-1 flex justify-between text-[11px]"><span>52-week low {usd(ind.low52w)}</span><span>high {usd(ind.high52w)}</span></div>
                <DitherBar value={rangePosition(lastClose, ind.low52w, ind.high52w)} tone="primary" label={`${symbol} sits ${Math.round(rangePosition(lastClose, ind.low52w, ind.high52w))}% of the way up its 52 week range`} />
              </div>
            {/if}
          {:else if detailLoad?.state === "error"}
            <p class="text-muted-foreground text-[13px]">Could not load indicators: {detailLoad.error}
              <button class="text-primary ml-1 hover:underline" onclick={() => harness.loadSymbolDetail(symbol, true)}>Retry</button></p>
          {:else}
            <div class="bg-muted/50 h-16 animate-pulse rounded-lg" aria-hidden="true"></div>
          {/if}
        </section>

        {#if position}
          <section aria-label="Position" class="flex flex-col gap-2">
            <h3 class="label-caps">Position</h3>
            <dl class="num grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
              <div><dt class="text-muted-foreground text-[11px]">Shares</dt><dd>{qty(position.quantity)}</dd></div>
              <div><dt class="text-muted-foreground text-[11px]">Avg cost</dt><dd>{usd(position.averageCost)}</dd></div>
              <div><dt class="text-muted-foreground text-[11px]">Value</dt><dd>{usd(position.marketValue)}</dd></div>
              <div>
                <dt class="text-muted-foreground text-[11px]">P&amp;L</dt>
                <dd><Pnl amount={position.unrealizedPnl} /></dd>
              </div>
            </dl>
          </section>
        {/if}

        {#if thesisText || hasThesis}
          <section aria-label="Thesis" class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3 class="label-caps">Thesis</h3>
              <button class="text-primary min-h-6 text-[12px] hover:underline" onclick={() => { ui.symbol = null; openNote(thesisPath); }}>
                Open note
              </button>
            </div>
            {#if thesisText}
              <div class="text-[13.5px]"><Markdown text={thesisText} /></div>
            {:else if thesisDoc?.state === "error"}
              <p class="text-muted-foreground text-[13px]">Could not load the thesis: {thesisDoc.error}</p>
            {:else}
              <div class="bg-muted/50 h-24 animate-pulse rounded-lg"></div>
            {/if}
          </section>
        {/if}

        <section aria-label="Orders" class="flex flex-col gap-2">
          <h3 class="label-caps">Orders</h3>
          {#if orders.length === 0}
            <p class="text-muted-foreground text-[13px]">No orders for {symbol}</p>
          {:else}
            <ul class="divide-border border-border divide-y rounded-lg border">
              {#each orders.slice(0, 6) as o (o.id)}
                <li>
                  <button class="hover:bg-muted/50 flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left" onclick={() => openOrder(o.id)}>
                    <SideBadge side={o.intent.side} />
                    <span class="num min-w-0 flex-1 text-[13px]">{qty(o.intent.quantity)} @ {usd(o.intent.limitPrice)} <span class="text-muted-foreground">· {usd(notional(o.intent))}</span></span>
                    <span class="text-muted-foreground shrink-0 text-[12px]">{STATUS_LABEL[o.status]} · {ago(o.createdAt, clock.now)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section aria-label="Recent decisions" class="flex flex-col gap-2">
          <h3 class="label-caps">Recent decisions</h3>
          {#if journal.length === 0}
            <p class="text-muted-foreground text-[13px]">No journal entries for {symbol}</p>
          {:else}
            <ul class="flex flex-col gap-2">
              {#each journal.slice(0, 5) as e (e.id)}
                <li><DecisionCard entry={e} order={e.orderId ? ordersById.get(e.orderId) : undefined} /></li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    </div>
  </Sheet.Content>
</Sheet.Root>
