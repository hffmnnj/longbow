<script lang="ts">
  import DataState from "./viz/DataState.svelte";
  import DitherBar from "./viz/DitherBar.svelte";
  import DitherSeries from "./viz/DitherSeries.svelte";
  import Panel from "./viz/Panel.svelte";
  import Stat from "./viz/Stat.svelte";
  import TrendTable from "./viz/TrendTable.svelte";
  import Empty from "./Empty.svelte";
  import Ticker from "./Ticker.svelte";
  import { breadthPct, vixReading, yieldReading } from "$lib/analytics";
  import { clock } from "$lib/clock.svelte";
  import { ago, isoDay, isoShort, pct, yieldPct } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  $effect(() => {
    if (harness.loaded) void harness.loadMarket();
  });

  const held = $derived(new Set(harness.positions.map((p) => p.symbol)));
  const importance = { high: "bg-loss", medium: "bg-warn", low: "bg-muted-foreground/50" } as const;
</script>

<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-3">
  <DataState loadable={harness.market} onretry={() => harness.loadMarket(true)} skeleton="h-[28rem]">
    {#snippet children(m)}
      {@const breadth = breadthPct(m.breadth)}
      <Panel title="Regime" reading={m.regime}>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 px-3.5 pb-3.5 sm:grid-cols-4">
          <Stat label="VIX" value={m.volatility.vix.toFixed(1)} sub={m.volatility.percentile !== undefined ? `${Math.round(m.volatility.percentile)}th percentile, 1Y` : undefined} />
          <Stat label="Term structure" value={m.volatility.contango ? "Contango" : "Backwardation"} sub={m.volatility.contango ? "Calm near term" : "Stress near term"} tone={m.volatility.contango ? "flat" : "loss"} />
          <Stat label="10Y yield" value={yieldPct(m.yields.find((y) => y.tenor === "10Y")?.yieldPct ?? 0)} />
          <div class="flex min-w-0 flex-col gap-1">
            <dt class="label-caps">Breadth</dt>
            <dd class="num text-[17px] leading-tight font-semibold">{pct(breadth)}</dd>
            <DitherBar value={breadth} tone={breadth >= 60 ? "gain" : breadth >= 40 ? "primary" : "loss"} marker={50} label={`${m.breadth.aboveSma50} of ${m.breadth.total} stocks above their 50 day average`} />
            <dd class="num text-muted-foreground text-[11.5px]">{m.breadth.aboveSma50} of {m.breadth.total} above 50d</dd>
          </div>
        </dl>
        <p class="text-muted-foreground num border-border border-t px-3.5 py-2 text-[11.5px]">Data as of {ago(m.asOf, clock.now)}</p>
      </Panel>

      <div class="grid gap-3 lg:grid-cols-2">
        <Panel title="Indices" reading={`${m.indices.filter((r) => r.aboveSma50).length} of ${m.indices.length} above their 50 day average`}>
          <TrendTable rows={m.indices} />
        </Panel>
        <Panel
          title="Sectors"
          reading={m.sectors.length ? `${m.sectors[0]!.name ?? m.sectors[0]!.symbol} leads SPY over 3 months; ${m.sectors.at(-1)!.name ?? m.sectors.at(-1)!.symbol} trails` : undefined}
        >
          <TrendTable rows={m.sectors} relative />
        </Panel>
      </div>

      <div class="grid gap-3 lg:grid-cols-2">
        <Panel title="Volatility" reading={vixReading(m.volatility)}>
          <div class="flex flex-col gap-3 px-3.5 pb-3.5">
            <DitherSeries
              kind="area"
              labels={m.volatility.history.map((h) => h.date)}
              series={[{ key: "vix", label: "VIX", tone: "warn", values: m.volatility.history.map((h) => h.value) }]}
              format={(v) => v.toFixed(1)}
              tickLabel={isoShort}
              marginLeft={32}
              ariaLabel={`VIX over ${m.volatility.history.length} trading days, now ${m.volatility.vix.toFixed(1)}`}
              class="h-44"
            />
            {#if m.volatility.vix9d !== undefined && m.volatility.vix3m !== undefined}
              {@const top = Math.max(m.volatility.vix9d, m.volatility.vix, m.volatility.vix3m)}
              <div>
                <h3 class="label-caps mb-2">Term structure</h3>
                <ul class="flex flex-col gap-1.5">
                  {#each [["9 day", m.volatility.vix9d], ["30 day (VIX)", m.volatility.vix], ["3 month", m.volatility.vix3m]] as [label, v] (label)}
                    <li class="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-2.5">
                      <span class="text-muted-foreground text-[12px]">{label}</span>
                      <DitherBar value={v as number} max={top * 1.1} tone="warn" label={`${label} implied volatility ${(v as number).toFixed(1)}`} />
                      <span class="num text-right text-[12.5px]">{(v as number).toFixed(1)}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </Panel>

        <Panel title="Yield curve" reading={yieldReading(m.yields)}>
          <div class="flex flex-col gap-3 px-3.5 pb-3.5">
            <DitherSeries
              kind="line"
              labels={m.yields.map((y) => y.tenor)}
              series={[{ key: "y", label: "Treasury yield", tone: "primary", values: m.yields.map((y) => y.yieldPct) }]}
              format={yieldPct}
              marginLeft={40}
              ariaLabel={`Treasury yield curve from ${m.yields[0]?.tenor} to ${m.yields.at(-1)?.tenor}`}
              class="h-36"
            />
            <div>
              <h3 class="label-caps mb-1">10-year yield, {m.tenYearHistory.length} days</h3>
              <DitherSeries
                kind="area"
                labels={m.tenYearHistory.map((h) => h.date)}
                series={[{ key: "y10", label: "10Y yield", tone: "lab", values: m.tenYearHistory.map((h) => h.value) }]}
                format={yieldPct}
                tickLabel={isoShort}
                marginLeft={40}
                ariaLabel="Ten year Treasury yield history"
                class="h-32"
              />
            </div>
          </div>
        </Panel>
      </div>

      <div class="grid gap-3 lg:grid-cols-2">
        <Panel title="Economic calendar" reading={m.calendar.length ? `${m.calendar.filter((c) => c.importance === "high").length} high-impact releases in the next 7 days` : undefined}>
          {#if m.calendar.length === 0}
            <Empty text="No scheduled releases in the next 7 days." />
          {:else}
            <ul class="divide-border divide-y">
              {#each m.calendar as c (c.date + c.event)}
                <li class="flex items-center gap-3 px-3.5 py-2 text-[13px]">
                  <span class="num text-muted-foreground w-24 shrink-0 text-[12px]">{isoDay(c.date)}</span>
                  <span class="num text-muted-foreground w-11 shrink-0 text-[12px]">{c.time ?? ""}</span>
                  <span class="min-w-0 flex-1 truncate">{c.event}</span>
                  <span class="flex shrink-0 items-center gap-1.5 text-[11px]">
                    <i class={cn("size-2 rounded-full", importance[c.importance ?? "low"])}></i>
                    <span class="text-muted-foreground w-11">{c.importance ?? "low"}</span>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </Panel>
        <Panel title="Earnings" reading={m.earnings.some((e) => e.held) ? `${m.earnings.filter((e) => e.held).length} held names report in the next 30 days` : "No held names report in the next 30 days"}>
          {#if m.earnings.length === 0}
            <Empty text="No earnings in the next 30 days for held or watched names." />
          {:else}
            <ul class="divide-border divide-y">
              {#each m.earnings.toSorted((a, b) => a.date.localeCompare(b.date)) as e (e.symbol + e.date)}
                <li class={cn("flex items-center gap-3 px-3.5 py-2 text-[13px]", (e.held || held.has(e.symbol)) && "bg-primary/5")}>
                  <span class="num text-muted-foreground w-24 shrink-0 text-[12px]">{isoDay(e.date)}</span>
                  <span class="w-16 shrink-0"><Ticker symbol={e.symbol} /></span>
                  <span class="text-muted-foreground min-w-0 flex-1 truncate text-[12px]">{e.time ?? ""}</span>
                  {#if e.held || held.has(e.symbol)}<span class="bg-primary/15 text-primary rounded px-1.5 text-[10px] font-semibold tracking-wide uppercase">Held</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </Panel>
      </div>
    {/snippet}
  </DataState>
</div>
