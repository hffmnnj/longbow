<script lang="ts">
  import type { HistoryRange } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import ActionBadge from "./ActionBadge.svelte";
  import Markdown from "./Markdown.svelte";
  import Pnl from "./Pnl.svelte";
  import PriceChart from "./PriceChart.svelte";
  import RangeToggle from "./RangeToggle.svelte";
  import { periodReturn } from "$lib/chart";
  import { etStamp, qty, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { harness } from "$lib/store.svelte";
  import { openNote, ui } from "$lib/ui.svelte";

  let range = $state<HistoryRange>("6m");
  let last = $state("");
  $effect(() => {
    if (ui.symbol) last = ui.symbol;
  });
  const symbol = $derived(ui.symbol ?? last);

  $effect(() => {
    if (ui.symbol) void harness.loadHistory(ui.symbol, range);
  });

  const entry = $derived(harness.history[`${symbol}:${range}`]);
  const bars = $derived(entry?.data?.bars ?? []);
  const lastClose = $derived(bars[bars.length - 1]?.close);
  const ret = $derived(periodReturn(bars));
  const position = $derived(harness.positions.find((p) => p.symbol === symbol));
  const thesisPath = $derived(`theses/${symbol}.md`);
  const hasThesis = $derived(harness.notes.some((n) => n.path === thesisPath));
  const thesis = $derived(harness.docs[`note:${thesisPath}`]);
  const entries = $derived(harness.journal.filter((j) => j.symbol === symbol).slice(0, 5));

  $effect(() => {
    if (ui.symbol && hasThesis) void harness.loadDoc("note", thesisPath);
  });
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
      <Sheet.Description class="sr-only">Price history, thesis, position and recent decisions for {symbol}</Sheet.Description>
    </Sheet.Header>

    <div class="pb-safe min-h-0 flex-1 overflow-y-auto">
      <div class="flex items-center justify-between gap-3 px-4 pt-3">
        <RangeToggle bind:value={range} />
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
          <PriceChart {bars} class="h-[340px] md:h-[380px]" />
        {/if}
      </div>

      <div class="flex flex-col gap-6 px-4 py-5">
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

        {#if hasThesis}
          <section aria-label="Thesis" class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3 class="label-caps">Thesis</h3>
              <button class="text-primary min-h-6 text-[12px] hover:underline" onclick={() => { ui.symbol = null; openNote(thesisPath); }}>
                Open note
              </button>
            </div>
            {#if thesis?.state === "ready" && thesis.data}
              <div class="text-[13.5px]"><Markdown text={thesis.data} /></div>
            {:else if thesis?.state === "error"}
              <p class="text-muted-foreground text-[13px]">Could not load the thesis: {thesis.error}</p>
            {:else}
              <div class="bg-muted/50 h-24 animate-pulse rounded-lg"></div>
            {/if}
          </section>
        {/if}

        <section aria-label="Recent decisions" class="flex flex-col gap-2">
          <h3 class="label-caps">Recent decisions</h3>
          {#if entries.length === 0}
            <p class="text-muted-foreground text-[13px]">No journal entries for {symbol}</p>
          {:else}
            <ul class="divide-border border-border divide-y rounded-lg border">
              {#each entries as e (e.id)}
                <li class="flex items-start gap-2.5 px-3 py-2.5">
                  <ActionBadge action={e.action} />
                  <span class="min-w-0 flex-1">
                    <span class="block text-[13px] leading-snug">{e.summary}</span>
                    <span class="num text-muted-foreground text-[11.5px]">
                      {etStamp(e.at, clock.now)}{#if e.confidence !== undefined} · conf {Math.round(e.confidence * 100)}%{/if}
                    </span>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    </div>
  </Sheet.Content>
</Sheet.Root>
