<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
  import DataState from "./viz/DataState.svelte";
  import DitherBar from "./viz/DitherBar.svelte";
  import DitherColumns from "./viz/DitherColumns.svelte";
  import Panel from "./viz/Panel.svelte";
  import Stat from "./viz/Stat.svelte";
  import Empty from "./Empty.svelte";
  import Pnl from "./Pnl.svelte";
  import Ticker from "./Ticker.svelte";
  import { calibrationReading, calibrationRows, orderOutcomes, pnlBars, pnlReading, SOURCE_LABEL } from "$lib/analytics";
  import { isoShort, pct, tone, usd, usdSigned } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  $effect(() => {
    if (harness.loaded) void harness.loadPerformance();
  });

  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  const num = (v: number | undefined, digits = 2) => (v === undefined ? "\u2014" : v.toFixed(digits));
  const head = "text-muted-foreground h-8 text-[11.5px]";
  const outcomeTone = (s: string) =>
    s === "filled" || s === "partially_filled" ? "gain" : s === "failed" ? "loss" : s === "rejected_risk" ? "warn" : s === "submitted" || s === "pending_approval" ? "primary" : "muted";
</script>

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-3">
  <DataState loadable={harness.performance} onretry={() => harness.loadPerformance(true)} skeleton="h-[30rem]">
    {#snippet children(p)}
      {@const bars = pnlBars(p.trades)}
      {@const cal = calibrationRows(p.calibration)}
      {@const outcomes = orderOutcomes(p.ordersByStatus)}
      {#if p.trades.length === 0}
        <Panel title="Performance" reading="No closed trades yet.">
          <Empty text="Win rate, R multiples and calibration appear once the first position is closed." />
        </Panel>
      {:else}
        <dl class="border-border bg-card grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-3.5 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Realized P&L" value={usdSigned(p.realizedPnl)} tone={tone(p.realizedPnl)} sub={`${p.trades.length} closed trades`} />
          <Stat label="Win rate" value={p.winRatePct !== undefined ? pct(p.winRatePct) : undefined} />
          <Stat label="Average R" value={p.avgR !== undefined ? `${p.avgR >= 0 ? "+" : "\u2212"}${Math.abs(p.avgR).toFixed(2)}R` : undefined} sub="harness trades with a plan" />
          <Stat label="Expectancy" value={p.expectancy !== undefined ? usdSigned(p.expectancy) : undefined} sub="per harness trade" tone={p.expectancy !== undefined ? tone(p.expectancy) : "flat"} />
          <Stat label="Profit factor" value={num(p.profitFactor)} sub="gross wins / gross losses" />
          <Stat label="Avg holding" value={p.avgHoldingDays !== undefined ? `${p.avgHoldingDays.toFixed(1)} days` : undefined} />
        </dl>

        <div class="grid gap-3 lg:grid-cols-2">
          <Panel title="P&L per trade" reading={pnlReading(p.trades)}>
            <div class="px-3.5 pb-3.5">
              <DitherColumns
                labels={bars.map((b) => b.label)}
                series={[
                  { key: "gain", label: "Win", tone: "gain", values: bars.map((b) => b.gain) },
                  { key: "loss", label: "Loss, shown as size", tone: "loss", values: bars.map((b) => b.loss) },
                ]}
                format={(v, key) => (key === "loss" ? (v ? usdSigned(-v) : "$0.00") : usd(v))}
                axisFormat={(v) => usd(Math.round(v)).replace(".00", "")}
                tooltipLabel={(i) => `${bars[i]!.label} · ${day.format(bars[i]!.trade.closedAt)}`}
                ariaLabel={`Profit and loss for each of the last ${bars.length} closed trades`}
                maxTicks={10}
                class="h-52"
              />
              <p class="text-muted-foreground mt-1 flex items-center gap-4 text-[11.5px]">
                <span class="flex items-center gap-1.5"><i class="bg-gain inline-block size-2 rounded-[2px]"></i>Win</span>
                <span class="flex items-center gap-1.5"><i class="bg-loss inline-block size-2 rounded-[2px]"></i>Loss, bar height is the amount lost</span>
              </p>
            </div>
          </Panel>

          <Panel title="Calibration" reading={calibrationReading(p.calibration)}>
            <div class="px-3.5 pb-3.5">
              {#if cal.length === 0}
                <Empty text="Needs closed harness trades that carried a stated win probability." />
              {:else}
                <DitherColumns
                  labels={cal.map((c) => c.label)}
                  series={[
                    { key: "predicted", label: "Predicted win rate", tone: "primary", values: cal.map((c) => c.predicted) },
                    { key: "realized", label: "Realized win rate", tone: "gain", values: cal.map((c) => c.realized) },
                  ]}
                  format={(v) => `${v.toFixed(0)}%`}
                  axisFormat={(v) => `${Math.round(v)}%`}
                  tooltipLabel={(i) => `Predicted ${cal[i]!.label} · ${cal[i]!.count} trades`}
                  ariaLabel="Predicted against realized win rate for each probability bucket"
                  maxTicks={6}
                  class="h-44"
                />
                <table class="num mt-2 w-full text-[12px]">
                  <caption class="sr-only">Calibration buckets with trade counts</caption>
                  <thead>
                    <tr class="text-muted-foreground text-[11px]">
                      <th class="text-left font-normal">Said</th><th class="text-right font-normal">Predicted</th><th class="text-right font-normal">Realized</th><th class="text-right font-normal">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each cal as c (c.key)}
                      <tr><td>{c.label}</td><td class="text-right">{c.predicted.toFixed(0)}%</td><td class={cn("text-right", c.realized < c.predicted - 10 && "text-loss")}>{c.realized.toFixed(0)}%</td><td class="text-right">{c.count}</td></tr>
                    {/each}
                  </tbody>
                </table>
                {#if p.brier !== undefined}<p class="text-muted-foreground num mt-2 text-[11.5px]">Brier score {p.brier.toFixed(3)} (0 is perfect, 0.25 is a coin flip)</p>{/if}
              {/if}
            </div>
          </Panel>
        </div>

        <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Panel title="Order outcomes" reading={outcomes.length ? `${outcomes.reduce((a, o) => a + o.count, 0)} orders proposed, ${p.ordersByStatus.filled ?? 0} filled` : undefined}>
            <ul class="flex flex-col gap-2 px-3.5 pb-3.5">
              {#each outcomes as o (o.status)}
                <li class="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-2.5">
                  <span class="truncate text-[12.5px]">{o.label}</span>
                  <DitherBar value={o.count} max={outcomes[0]!.count} tone={outcomeTone(o.status)} label={`${o.label}: ${o.count} orders`} />
                  <span class="num text-right text-[12.5px]">{o.count}</span>
                </li>
              {:else}
                <li><Empty text="No orders yet." /></li>
              {/each}
            </ul>
          </Panel>

          <Panel title="Closed trades" reading="Newest first. Older trades come from Robinhood's own history and carry no plan, so they have no R multiple.">
            <div class="max-h-[26rem] overflow-y-auto">
              <Table.Root class="text-[12.5px]">
                <Table.Header>
                  <Table.Row class="hover:bg-transparent">
                    <Table.Head class="{head} px-3.5">Symbol</Table.Head>
                    <Table.Head class={head}>Closed</Table.Head>
                    <Table.Head class="{head} hidden text-right sm:table-cell">Held</Table.Head>
                    <Table.Head class="{head} text-right">P&amp;L</Table.Head>
                    <Table.Head class="{head} text-right">R</Table.Head>
                    <Table.Head class="{head} hidden text-right sm:table-cell">Said</Table.Head>
                    <Table.Head class="{head} pr-3.5">Source</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {#each p.trades.toSorted((a, b) => b.closedAt - a.closedAt) as t (t.symbol + t.closedAt)}
                    <Table.Row>
                      <Table.Cell class="px-3.5 py-1.5"><Ticker symbol={t.symbol} /></Table.Cell>
                      <Table.Cell class="num py-1.5">{day.format(t.closedAt)}</Table.Cell>
                      <Table.Cell class="num hidden py-1.5 text-right sm:table-cell">{t.holdingDays !== undefined ? `${t.holdingDays}d` : "\u2014"}</Table.Cell>
                      <Table.Cell class="py-1.5 text-right"><Pnl amount={t.pnl} percent={t.pnlPct} /></Table.Cell>
                      <Table.Cell class={cn("num py-1.5 text-right", t.rMultiple !== undefined && (t.rMultiple >= 0 ? "text-gain" : "text-loss"))}>
                        {t.rMultiple !== undefined ? `${t.rMultiple >= 0 ? "+" : "\u2212"}${Math.abs(t.rMultiple).toFixed(1)}R` : "\u2014"}
                      </Table.Cell>
                      <Table.Cell class="num text-muted-foreground hidden py-1.5 text-right sm:table-cell">{t.probabilityWin !== undefined ? `${Math.round(t.probabilityWin * 100)}%` : "\u2014"}</Table.Cell>
                      <Table.Cell class="py-1.5 pr-3.5">
                        <span class={cn("rounded px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap", t.source === "harness" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{SOURCE_LABEL[t.source]}</span>
                      </Table.Cell>
                    </Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
          </Panel>
        </div>
      {/if}
    {/snippet}
  </DataState>
</div>
