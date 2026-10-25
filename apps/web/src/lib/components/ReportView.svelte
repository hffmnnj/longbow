<script lang="ts">
  import type { Report } from "@rh/shared";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import ActionBadge from "./ActionBadge.svelte";
  import DitherBar from "./viz/DitherBar.svelte";
  import DitherColumns from "./viz/DitherColumns.svelte";
  import DitherSeries from "./viz/DitherSeries.svelte";
  import Empty from "./Empty.svelte";
  import GradeChip from "./GradeChip.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import Panel from "./viz/Panel.svelte";
  import Pnl from "./Pnl.svelte";
  import PriceChart, { type PriceMarker } from "./PriceChart.svelte";
  import Stat from "./viz/Stat.svelte";
  import Ticker from "./Ticker.svelte";
  import { ArrowLeft01Icon, Link04Icon, PrinterIcon } from "$lib/icons";
  import { clock } from "$lib/clock.svelte";
  import { ago, isoShort, pct, pctSigned, tone, usd, usdSigned } from "$lib/format";
  import {
    figureStrip,
    KIND_LABEL,
    periodReading,
    planOutcomeRows,
    reportPeriodShort,
    reportPeriodWords,
    tradeMarkerDates,
  } from "$lib/reports";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { id, onback }: { id: string; onback: () => void } = $props();

  $effect(() => {
    void harness.loadReport(id);
  });

  const loadable = $derived(harness.reportDetail[id]);
  /** Keeps the last report on screen while the next one loads. */
  let last = $state<Report | undefined>(undefined);
  $effect(() => {
    if (loadable?.data) last = loadable.data;
  });
  const shown = $derived(loadable?.data ?? last);

  const figs = $derived(shown ? figureStrip(shown.facts) : []);
  const planRows = $derived(shown ? planOutcomeRows(shown) : []);
  const period = $derived(shown ? reportPeriodWords(shown.kind, shown.periodStart, shown.periodEnd) : "");
  const reading = $derived(shown ? periodReading(shown.facts) : undefined);
  /** Account bar tone for the daily comparison (the dither palette has no flat). */
  const dayTone = $derived(shown?.facts.pnlPct === undefined ? "muted" : tone(shown.facts.pnlPct));

  const chartMarkers = $derived.by((): PriceMarker[] => {
    const t = shown?.facts.trade;
    if (!shown || !t) return [];
    const at = tradeMarkerDates(t.bars, t.trade.openedAt, t.trade.closedAt, t.plan?.timeStopDate);
    const out: PriceMarker[] = [];
    if (at.entry !== undefined) out.push({ time: at.entry, label: "Entry", kind: "entry" });
    out.push({ time: at.exit, label: "Exit", kind: "exit", tone: t.trade.pnl >= 0 ? "gain" : "loss" });
    if (at.timeStop) out.push({ time: at.timeStop, label: "Time stop", kind: "timestop" });
    return out;
  });
  /** Screen-reader name for the price path, naming only the marks actually drawn. */
  const chartAria = $derived.by(() => {
    const t = shown?.facts.trade;
    if (!shown || !t) return "Price chart";
    const marks = chartMarkers.map((m) => m.label.toLowerCase()).join(", ");
    return `${shown.symbol ?? "Trade"} price path${marks ? ` with ${marks} mark${chartMarkers.length === 1 ? "" : "s"}` : ""}${t.plan ? " and stop line" : ""}`;
  });

  async function copyLink() {
    const url = `${location.origin}/?report=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  }

  const head = "text-muted-foreground h-8 text-[11.5px]";
</script>

{#if shown}
  {@const r = shown}
  {@const f = r.facts}
  {@const narrative = r.narrative}
  {@const trade = f.trade}
  <article class="report-brief mx-auto flex w-full max-w-[880px] flex-col gap-4 pb-8" aria-label={`${KIND_LABEL[r.kind]} report: ${r.headline}`}>
    <div class="no-print">
      <Button variant="ghost" size="sm" class="min-h-11 gap-1.5 md:min-h-8" onclick={onback}>
        <Icon icon={ArrowLeft01Icon} class="size-4" /> All reports
      </Button>
    </div>

    <header class="flex flex-col gap-2">
      <p class="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        <img src="/brand/longbow-mark.svg" alt="" width="20" height="20" class="size-5 rounded" />
        <span class="font-semibold tracking-wide uppercase">{KIND_LABEL[r.kind]} report</span>
        <span aria-hidden="true">·</span>
        <span>{period}</span>
        {#if r.kind === "trade" && r.symbol}
          <span aria-hidden="true">·</span>
          <Ticker symbol={r.symbol} />
        {/if}
      </p>
      <h1 class="max-w-[28ch] text-[26px] leading-tight font-semibold tracking-tight text-balance md:text-[32px]">{r.headline}</h1>
      <p class="text-muted-foreground max-w-[62ch] text-[14.5px] leading-relaxed text-pretty">{narrative.summary}</p>
      <p class="num text-muted-foreground text-[11.5px]">Published {ago(r.at, clock.now)}</p>
    </header>

    {#if figs.length > 0}
      <dl class="border-border bg-card grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-3.5 sm:grid-cols-3">
        {#each figs as fig (fig.key)}
          <Stat label={fig.label} value={fig.value} sub={fig.sub} tone={fig.tone} />
        {/each}
      </dl>
    {/if}

    {#if r.grade}
      <div class="border-border bg-card flex items-center gap-3 rounded-lg border p-3.5">
        <GradeChip grade={r.grade} large reason={narrative.gradeReason} />
        <div class="min-w-0">
          <p class="label-caps">Decision grade</p>
          <p class="mt-0.5 text-[13px] leading-snug">{narrative.gradeReason ?? "Judged apart from the outcome."}</p>
        </div>
      </div>
    {/if}

    {#if r.kind === "trade" && trade}
      <Panel title="Price path" reading={trade.bars.length ? `Daily bars from ${isoShort(trade.bars[0]!.date)} to ${isoShort(trade.bars[trade.bars.length - 1]!.date)}` : undefined} class="report-section">
        <div class="flex flex-col gap-2 px-3.5 pb-3.5">
          <PriceChart
            bars={trade.bars}
            lines={trade.plan ? [{ price: trade.plan.invalidationPrice, label: `Stop ${usd(trade.plan.invalidationPrice)}`, tone: "loss" }] : []}
            markers={chartMarkers}
            ariaLabel={chartAria}
            class="h-72 md:h-80"
          />
          <p class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
            {#if chartMarkers.some((m) => m.kind === "entry")}
              <span class="text-primary flex items-center gap-1.5"><i class="bg-primary inline-block size-2 rounded-full"></i>Entry</span>
            {/if}
            <span class={cn("flex items-center gap-1.5", trade.trade.pnl >= 0 ? "text-gain" : "text-loss")}>
              <i class={cn("inline-block size-2 rounded-full", trade.trade.pnl >= 0 ? "bg-gain" : "bg-loss")}></i>Exit
            </span>
            {#if trade.plan}
              <span class="flex items-center gap-1.5"><i class="border-loss inline-block h-0 w-4 border-t-2 border-dashed"></i>Invalidation</span>
            {/if}
            {#if chartMarkers.some((m) => m.kind === "timestop")}
              <span class="flex items-center gap-1.5"><i class="bg-muted-foreground inline-block size-2 rounded-full"></i>Time stop</span>
            {/if}
          </p>
        </div>
      </Panel>

      <Panel title="Plan versus outcome" class="report-section">
        <Table.Root class="text-[13px]">
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class={head}>Measure</Table.Head>
              <Table.Head class={cn(head, "text-right")}>Plan</Table.Head>
              <Table.Head class={cn(head, "text-right")}>Outcome</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each planRows as row (row.label)}
              <Table.Row>
                <Table.Cell class="text-muted-foreground py-2">{row.label}</Table.Cell>
                <Table.Cell class="num py-2 text-right">{row.planned}</Table.Cell>
                <Table.Cell class="num py-2 text-right font-medium">
                  {row.realized}
                  {#if row.fees !== undefined}
                    <span class="text-muted-foreground block text-[11px] font-normal">incl. {usd(row.fees)} fees</span>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Panel>

      {#if trade.plan}
        <Panel title="Original thesis" class="report-section">
          <div class="px-3.5 pb-3.5"><Markdown text={trade.plan.thesis} /></div>
        </Panel>
      {/if}
    {:else}
      <Panel
        title={r.kind === "daily" ? "Day move versus SPY" : "Equity versus SPY"}
        reading={reading}
        class="report-section"
      >
        <div class="px-3.5 pb-3.5">
          {#if r.kind === "daily"}
            {#if f.pnlPct !== undefined && f.benchmarkPct !== undefined}
              <DitherColumns
                labels={["Account", "SPY"]}
                series={[
                  { key: "account", label: "Account", tone: dayTone === "flat" ? "muted" : dayTone, values: [f.pnlPct, 0] },
                  { key: "spy", label: "SPY, same day", tone: "muted", values: [0, f.benchmarkPct] },
                ]}
                format={(v) => pctSigned(v)}
                axisFormat={(v) => `${v}%`}
                tooltipLabel={(i) => (i === 0 ? `Account ${pctSigned(f.pnlPct ?? 0)}` : `SPY ${pctSigned(f.benchmarkPct ?? 0)}`)}
                ariaLabel={`Day move: account ${pctSigned(f.pnlPct)} against SPY ${pctSigned(f.benchmarkPct)}`}
                class="h-44"
              />
            {:else}
              <Empty text="No market comparison recorded for this day." />
            {/if}
          {:else if f.equityCurve.length >= 2}
            <DitherSeries
              kind="line"
              labels={f.equityCurve.map((p) => p.date)}
              series={[{ key: "equity", label: "Account", tone: "primary", values: f.equityCurve.map((p) => p.equity) }]}
              format={usd}
              axisFormat={(v) => usd(Math.round(v)).replace(".00", "")}
              tickLabel={isoShort}
              ariaLabel={`Account equity over the week. ${reading ?? ""}`}
              class="h-56"
            />
          {:else}
            <Empty text="Equity marks are recorded once a day. This week has a single mark so far." />
          {/if}
        </div>
      </Panel>

      <Panel title="Closed trades" reading={f.trades.length ? "Newest first" : undefined} class="report-section">
        {#if f.trades.length === 0}
          <Empty text="No trades closed in this period." />
        {:else}
          <div class="max-h-[22rem] overflow-y-auto">
            <Table.Root class="text-[12.5px]">
              <Table.Header>
                <Table.Row class="hover:bg-transparent">
                  <Table.Head class="{head} px-3.5">Symbol</Table.Head>
                  <Table.Head class={head}>Closed</Table.Head>
                  <Table.Head class="{head} text-right">P&amp;L</Table.Head>
                  <Table.Head class="{head} text-right">R</Table.Head>
                  <Table.Head class="{head} pr-3.5 text-right">Source</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each f.trades.toSorted((a, b) => b.closedAt - a.closedAt) as t (t.symbol + t.closedAt)}
                  <Table.Row>
                    <Table.Cell class="px-3.5 py-1.5"><Ticker symbol={t.symbol} /></Table.Cell>
                    <Table.Cell class="num py-1.5">{isoShort(new Date(t.closedAt).toISOString().slice(0, 10))}</Table.Cell>
                    <Table.Cell class="py-1.5 text-right">
                      <span class="flex flex-col items-end">
                        <Pnl amount={t.pnl} percent={t.pnlPct} />
                        {#if t.fees !== undefined && t.fees > 0}
                          <span class="text-muted-foreground text-[11px]">incl. {usd(t.fees)} fees</span>
                        {/if}
                      </span>
                    </Table.Cell>
                    <Table.Cell class={cn("num py-1.5 text-right", t.rMultiple !== undefined && (t.rMultiple >= 0 ? "text-gain" : "text-loss"))}>
                      {t.rMultiple !== undefined ? `${t.rMultiple >= 0 ? "+" : "−"}${Math.abs(t.rMultiple).toFixed(1)}R` : "—"}
                    </Table.Cell>
                    <Table.Cell class="py-1.5 pr-3.5 text-right">
                      <span class={cn("rounded px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap", t.source === "harness" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                        {t.source === "harness" ? "Longbow" : "Robinhood history"}
                      </span>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {/if}
      </Panel>

      {#if f.positions.length > 0}
        <Panel title="Positions at the end of the period" class="report-section">
          <ul class="flex flex-col gap-2 px-3.5 pb-3.5">
            {#each f.positions.toSorted((a, b) => b.weightPct - a.weightPct) as p (p.symbol)}
              <li class="grid grid-cols-[3.25rem_minmax(0,1fr)_3.5rem] items-center gap-2.5">
                <Ticker symbol={p.symbol} />
                <DitherBar value={p.weightPct} max={Math.max(30, ...f.positions.map((x) => x.weightPct))} tone={p.unrealizedPnl >= 0 ? "gain" : "loss"} label={`${p.symbol} ${pct(p.weightPct)} of equity`} />
                <span class="num text-right text-[12.5px]">{pct(p.weightPct)}</span>
              </li>
            {/each}
          </ul>
        </Panel>
      {/if}

      {#if f.decisions.length > 0}
        <section aria-label="Decisions" class="report-section">
          <h2 class="label-caps px-1 pb-1.5">Decisions</h2>
          <ol class="border-border divide-border divide-y rounded-lg border">
            {#each f.decisions as d (d.id)}
              <li class="bg-card flex items-center gap-2.5 px-3.5 py-2 first:rounded-t-lg last:rounded-b-lg">
                <ActionBadge action={d.action} />
                {#if d.symbol}<Ticker symbol={d.symbol} />{/if}
                <span class="min-w-0 flex-1 truncate text-[13px]">{d.summary}</span>
                <span class="num text-muted-foreground shrink-0 text-[11.5px]">{ago(d.at, clock.now)}</span>
              </li>
            {/each}
          </ol>
        </section>
      {/if}
    {/if}

    {#each narrative.sections as s (s.title)}
      <section aria-label={s.title} class="report-section">
        <h2 class="px-1 pb-1 text-[15px] font-semibold tracking-tight">{s.title}</h2>
        <div class="border-border bg-card rounded-lg border px-3.5 py-3"><Markdown text={s.body} /></div>
      </section>
    {/each}

    {#if narrative.lessons.length > 0 || narrative.nextSteps.length > 0}
      <div class="report-section grid gap-4 sm:grid-cols-2">
        {#if narrative.lessons.length > 0}
          <section aria-label="Lessons">
            <h2 class="label-caps px-1 pb-1.5">Lessons</h2>
            <ul class="border-border bg-card flex flex-col gap-2 rounded-lg border p-3.5 text-[13px] leading-snug">
              {#each narrative.lessons as l (l)}<li class="flex gap-2"><span aria-hidden="true" class="text-muted-foreground">—</span><span>{l}</span></li>{/each}
            </ul>
          </section>
        {/if}
        {#if narrative.nextSteps.length > 0}
          <section aria-label="Next">
            <h2 class="label-caps px-1 pb-1.5">Next</h2>
            <ul class="border-border bg-card flex flex-col gap-2 rounded-lg border p-3.5 text-[13px] leading-snug">
              {#each narrative.nextSteps as n (n)}<li class="flex gap-2"><span aria-hidden="true" class="text-primary">→</span><span>{n}</span></li>{/each}
            </ul>
          </section>
        {/if}
      </div>
    {/if}

    <footer class="no-print flex flex-wrap gap-2">
      <Button variant="outline" class="h-11 md:h-9" onclick={copyLink}>
        <Icon icon={Link04Icon} /> Copy link
      </Button>
      <Button variant="outline" class="h-11 md:h-9" onclick={() => window.print()}>
        <Icon icon={PrinterIcon} /> Print
      </Button>
    </footer>

    <p class="text-muted-foreground num text-[11.5px]">
      {reportPeriodShort(r.kind, r.periodStart, r.periodEnd)} · {usdSigned(f.pnl ?? 0)}{f.pnlPct !== undefined ? ` (${pctSigned(f.pnlPct)})` : ""}
      {#if !trade && f.realizedPnl !== 0 && (f.pnl ?? 0) !== f.realizedPnl} · realized {usdSigned(f.realizedPnl)}{/if}
    </p>
  </article>
{:else if loadable?.state === "error"}
  <div class="mx-auto flex w-full max-w-[880px] flex-col items-start gap-3 pb-8" role="alert">
    <Button variant="ghost" size="sm" class="min-h-11 gap-1.5 md:min-h-8" onclick={onback}>
      <Icon icon={ArrowLeft01Icon} class="size-4" /> All reports
    </Button>
    <div class="border-border bg-card w-full rounded-lg border p-6 text-[13px]">
      <p class="font-medium">{loadable.error?.includes("not found") ? "This report is no longer available." : "Could not load this report."}</p>
      {#if !loadable.error?.includes("not found")}<p class="text-muted-foreground mt-1">{loadable.error}</p>{/if}
      <Button size="sm" variant="outline" class="mt-3" onclick={() => harness.loadReport(id, true)}>Retry</Button>
    </div>
  </div>
{:else}
  <div class="mx-auto flex w-full max-w-[880px] flex-col gap-4 pb-8" aria-hidden="true">
    <div class="bg-muted/50 h-8 w-2/3 animate-pulse rounded"></div>
    <div class="bg-muted/50 h-10 w-1/2 animate-pulse rounded"></div>
    <div class="bg-muted/50 h-28 animate-pulse rounded-lg"></div>
    <div class="bg-muted/50 h-64 animate-pulse rounded-lg"></div>
  </div>
{/if}
