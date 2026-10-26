<script lang="ts">
  import type { AnalyticsRange } from "@rh/shared";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import DataState from "./viz/DataState.svelte";
  import DitherBar from "./viz/DitherBar.svelte";
  import DitherSeries from "./viz/DitherSeries.svelte";
  import Panel from "./viz/Panel.svelte";
  import Stat from "./viz/Stat.svelte";
  import Empty from "./Empty.svelte";
  import LatestReport from "./LatestReport.svelte";
  import Positions from "./Positions.svelte";
  import Ticker from "./Ticker.svelte";
  import { equityReading, equityRows, heatCapPct, REPLAY_LABEL, REPLAY_NOTE, replayReading, replayRows } from "$lib/analytics";
  import { isoShort, pct, pctSigned, tone, usd, usdSigned } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { compact = false }: { compact?: boolean } = $props();

  const ranges: { value: AnalyticsRange; label: string }[] = [
    { value: "1m", label: "1M" },
    { value: "3m", label: "3M" },
    { value: "1y", label: "1Y" },
    { value: "all", label: "All" },
  ];
  let range = $state<AnalyticsRange>("3m");
  let source = $state<"account" | "replay">("account");

  $effect(() => {
    if (!harness.loaded) return;
    void harness.loadEquity(range);
    void harness.loadPerformance();
    void harness.loadReports();
  });

  const account = $derived(harness.status?.account);
  const status = $derived(harness.status);
  const equityLoad = $derived(harness.equity[range]);
  const perf = $derived(harness.performance.data);
  const risk = $derived(status?.settings.risk);
  const cap = $derived(risk ? heatCapPct(risk) : undefined);
  const investedPct = $derived(account && account.equity > 0 ? (account.positions.reduce((a, p) => a + p.marketValue, 0) / account.equity) * 100 : 0);
  const cashPct = $derived(account && account.equity > 0 ? (account.cash / account.equity) * 100 : 0);
  const toggle =
    "text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground num h-9 min-w-10 rounded-[5px] px-2.5 text-[12px] font-medium data-[state=on]:shadow-sm md:h-7";
  const group = "bg-muted/60 border-border inline-flex rounded-md border p-0.5";
</script>

{#snippet kpis()}
  <dl class={cn("border-border bg-card grid gap-x-4 gap-y-3 rounded-lg border p-3.5", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
    <Stat label="Equity" value={account ? usd(account.equity) : undefined} sub={account ? `${pct(investedPct)} invested` : undefined} />
    <Stat
      label="Day P&L"
      value={status?.dayPnl !== undefined ? usdSigned(status.dayPnl) : status?.dayPnlPct !== undefined ? pctSigned(status.dayPnlPct) : undefined}
      sub={status?.dayPnl !== undefined && status.dayPnlPct !== undefined ? pctSigned(status.dayPnlPct) : undefined}
      tone={tone(status?.dayPnl ?? status?.dayPnlPct ?? 0)}
    />
    <Stat label="Cash" value={account ? usd(account.cash) : undefined} sub={account ? `${pct(cashPct)} of equity` : undefined} />
    <Stat label="Buying power" value={account ? usd(account.buyingPower) : undefined} />
  </dl>
{/snippet}

{#snippet equityPanel()}
  <Panel
    title={source === "replay" ? REPLAY_LABEL : "Equity vs SPY"}
    class={compact ? "" : "min-h-[22rem]"}
  >
    {#snippet actions()}
      <div class="flex flex-wrap items-center justify-end gap-2">
        <ToggleGroup.Root type="single" bind:value={() => source, (v) => v && (source = v as "account" | "replay")} aria-label="Equity series" class={group}>
          <ToggleGroup.Item value="account" class={toggle}>Account</ToggleGroup.Item>
          <ToggleGroup.Item value="replay" class={toggle}>Replay</ToggleGroup.Item>
        </ToggleGroup.Root>
        <ToggleGroup.Root type="single" bind:value={() => range, (v) => v && (range = v as AnalyticsRange)} aria-label="Range" class={group}>
          {#each ranges as r (r.value)}<ToggleGroup.Item value={r.value} class={toggle}>{r.label}</ToggleGroup.Item>{/each}
        </ToggleGroup.Root>
      </div>
    {/snippet}
    <DataState loadable={equityLoad} onretry={() => harness.loadEquity(range, true)} skeleton={compact ? "h-52" : "h-72"}>
      {#snippet children(h)}
        {@const eq = equityRows(h)}
        {@const replay = replayRows(h)}
        {@const showReplay = source === "replay" || (eq.rows.length < 2 && replay.length > 1)}
        <div class="flex flex-col gap-2 px-3.5 pb-3.5">
          {#if showReplay}
            {#if replay.length > 1}
              <p class="text-[13px] leading-snug">{replayReading(h)}</p>
              <p class="text-muted-foreground text-[12px] leading-snug">{REPLAY_NOTE}</p>
              <DitherSeries
                kind="area"
                areaVariant="dotted"
                labels={replay.map((r) => r.date)}
                series={[{ key: "replay", label: REPLAY_LABEL, tone: "muted", values: replay.map((r) => r.value) }]}
                format={usd}
                axisFormat={(v) => usd(Math.round(v)).replace(".00", "")}
                tickLabel={isoShort}
                ariaLabel={`${REPLAY_LABEL}: portfolio value if you had held today's positions, ${replayReading(h) ?? ""}`}
                class={compact ? "h-44" : "h-60"}
              />
            {:else}
              <Empty text="Not enough price history to replay today's holdings yet." />
            {/if}
          {:else if eq.rows.length >= 2}
            <p class="text-[13px] leading-snug">
              {equityReading(h)}
              {#if h.maxDrawdownPct !== undefined}<span class="text-muted-foreground num"> · max drawdown {pct(Math.abs(h.maxDrawdownPct))}</span>{/if}
            </p>
            <DitherSeries
              kind="line"
              labels={eq.rows.map((r) => r.date)}
              series={[
                { key: "equity", label: "Account", tone: "primary", values: eq.rows.map((r) => r.equity) },
                ...(eq.hasBenchmark ? [{ key: "spy", label: "SPY, same start", tone: "muted" as const, values: eq.rows.map((r) => r.benchmark ?? 0), dashed: true }] : []),
              ]}
              format={usd}
              axisFormat={(v) => usd(Math.round(v)).replace(".00", "")}
              tickLabel={isoShort}
              ariaLabel={`Account equity against SPY. ${equityReading(h) ?? ""}`}
              class={compact ? "h-44" : "h-60"}
            />
            <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
              <span class="flex items-center gap-1.5"><i class="bg-primary inline-block h-0.5 w-4"></i>Account</span>
              {#if eq.hasBenchmark}<span class="flex items-center gap-1.5"><i class="border-muted-foreground inline-block h-0 w-4 border-t-2 border-dashed"></i>SPY, same start</span>{/if}
              <span class="ml-auto">Axis starts near the lowest mark</span>
            </div>
          {:else}
            <Empty text="Equity marks are recorded once a day. The first chart appears after the second mark." />
          {/if}
        </div>
      {/snippet}
    </DataState>
  </Panel>
{/snippet}

{#snippet heat()}
  <Panel
    title="Portfolio heat"
    reading={perf?.heatPct !== undefined && cap !== undefined
      ? `${pct(perf.heatPct)} of equity is at risk if every stop is hit, against a ${pct(cap)} cap`
      : undefined}
  >
    <div class="px-3.5 pb-3.5">
      {#if perf?.heatPct !== undefined && cap !== undefined}
        <DitherBar
          value={perf.heatPct}
          max={cap}
          tone={perf.heatPct / cap > 0.85 ? "loss" : perf.heatPct / cap > 0.6 ? "warn" : "primary"}
          label={`Portfolio heat ${pct(perf.heatPct)} of a ${pct(cap)} cap`}
        />
        <p class="num text-muted-foreground mt-1.5 flex justify-between text-[11.5px]">
          <span>0%</span><span>cap {pct(cap)} = {risk?.maxPositions} positions × {pct(risk?.maxRiskPerTradePct ?? 0)}</span>
        </p>
      {:else if harness.performance.state === "loading"}
        <div class="bg-muted/50 h-6 animate-pulse rounded" aria-hidden="true"></div>
      {:else}
        <p class="text-muted-foreground text-[13px]">No stops to measure yet.</p>
      {/if}
    </div>
  </Panel>
{/snippet}

{#snippet exposure()}
  <Panel title="Exposure" reading={perf && perf.exposure.length ? `${pct(investedPct)} invested across ${perf.exposure.length} names; ${pct(cashPct)} cash` : undefined}>
    <DataState loadable={harness.performance} onretry={() => harness.loadPerformance(true)} skeleton="h-32">
      {#snippet children(p)}
        <div class="flex flex-col gap-4 px-3.5 pb-3.5">
          {#if p.exposure.length === 0}
            <Empty text="Nothing held, so nothing exposed." />
          {:else}
            <div>
              <h3 class="label-caps mb-2">By name</h3>
              <ul class="flex flex-col gap-2">
                {#each p.exposure as e (e.symbol)}
                  <li class="grid grid-cols-[3.25rem_minmax(0,1fr)_3.5rem] items-center gap-2.5">
                    <Ticker symbol={e.symbol} />
                    <DitherBar value={e.weightPct} max={Math.max(30, ...p.exposure.map((x) => x.weightPct))} tone={e.unrealizedPnl >= 0 ? "gain" : "loss"} label={`${e.symbol} ${pct(e.weightPct)} of equity`} />
                    <span class="num text-right text-[12.5px]">{pct(e.weightPct)}</span>
                  </li>
                {/each}
                <li class="grid grid-cols-[3.25rem_minmax(0,1fr)_3.5rem] items-center gap-2.5">
                  <span class="text-muted-foreground text-[12.5px]">Cash</span>
                  <DitherBar value={cashPct} max={Math.max(30, ...p.exposure.map((x) => x.weightPct), cashPct)} tone="muted" label={`Cash ${pct(cashPct)} of equity`} />
                  <span class="num text-muted-foreground text-right text-[12.5px]">{pct(cashPct)}</span>
                </li>
              </ul>
              <p class="text-muted-foreground mt-2 text-[11.5px]">Green names are above cost, red below.</p>
            </div>
            <div>
              <h3 class="label-caps mb-2">By sector</h3>
              <ul class="flex flex-col gap-2">
                {#each p.sectors as s (s.sector)}
                  <li class="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2.5">
                    <span class="truncate text-[12.5px]">{s.sector}</span>
                    <DitherBar value={s.weightPct} max={(risk?.maxSectorPct ?? 60) * 1.25} marker={risk?.maxSectorPct} tone="primary" label={`${s.sector} ${pct(s.weightPct)} of equity, cap ${risk?.maxSectorPct ?? 60}%`} />
                    <span class="num text-right text-[12.5px]">{pct(s.weightPct)}</span>
                  </li>
                {/each}
              </ul>
              {#if risk}<p class="text-muted-foreground mt-2 text-[11.5px]">Tick marks the {pct(risk.maxSectorPct)} sector cap.</p>{/if}
            </div>
          {/if}
        </div>
      {/snippet}
    </DataState>
  </Panel>
{/snippet}

<div class={cn("flex flex-col gap-3", compact ? "" : "mx-auto w-full max-w-[1400px]")}>
  <LatestReport />
  {@render kpis()}
  {#if compact}
    {@render equityPanel()}
    {@render heat()}
    <Positions compact />
  {:else}
    <div class="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div class="flex min-w-0 flex-col gap-3">
        {@render equityPanel()}
        <Positions />
      </div>
      <div class="flex min-w-0 flex-col gap-3">
        {@render heat()}
        {@render exposure()}
      </div>
    </div>
  {/if}
</div>
