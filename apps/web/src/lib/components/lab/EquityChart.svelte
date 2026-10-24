<script lang="ts">
  import { untrack } from "svelte";
  import { mode } from "mode-watcher";
  import {
    ColorType,
    CrosshairMode,
    LineSeries,
    LineStyle,
    createChart,
    createSeriesMarkers,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type MouseEventParams,
    type SeriesMarker,
    type Time,
  } from "lightweight-charts";
  import type { SimRun } from "@rh/shared";
  import { cssColor } from "$lib/chartTheme";
  import { usd } from "$lib/format";
  import { cn } from "$lib/utils.js";

  let { run, class: className = "" }: { run: SimRun; class?: string } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | null = null;
  let equity: ISeriesApi<"Line"> | null = null;
  let bench: ISeriesApi<"Line"> | null = null;
  let markers: ISeriesMarkersPluginApi<Time> | null = null;
  let baseline: IPriceLine | null = null;
  let hoverDate = $state<string | null>(null);

  const FONT = "'IBM Plex Mono', ui-monospace, monospace";
  const byDate = $derived(new Map(run.equity.map((p) => [p.date, p])));
  const shown = $derived((hoverDate ? byDate.get(hoverDate) : undefined) ?? run.equity.at(-1));

  function theme() {
    if (!chart) return;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssColor("--muted-foreground"), fontFamily: FONT, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: cssColor("--border", 0.45) } },
      rightPriceScale: { borderColor: cssColor("--border") },
      timeScale: { borderColor: cssColor("--border") },
      crosshair: { vertLine: { color: cssColor("--muted-foreground"), labelBackgroundColor: cssColor("--border") }, horzLine: { color: cssColor("--muted-foreground"), labelBackgroundColor: cssColor("--border") } },
    });
    equity?.applyOptions({ color: cssColor("--lab") });
    bench?.applyOptions({ color: cssColor("--muted-foreground", 0.9) });
    data();
  }

  function data() {
    if (!chart || !equity || !bench) return;
    equity.setData(run.equity.map((p) => ({ time: p.date, value: p.equity })));
    bench.setData(run.equity.map((p) => ({ time: p.date, value: p.benchmark })));
    if (baseline) equity.removePriceLine(baseline);
    baseline = equity.createPriceLine({
      price: run.config.startingCash,
      color: cssColor("--muted-foreground", 0.6),
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "Start",
    });
    // One marker per side per day; several symbols collapse to a count.
    const groups = new Map<string, { side: "buy" | "sell"; date: string; symbols: string[] }>();
    for (const f of run.fills) {
      const key = `${f.date}:${f.side}`;
      const g = groups.get(key) ?? { side: f.side, date: f.date, symbols: [] };
      g.symbols.push(f.symbol);
      groups.set(key, g);
    }
    const up = cssColor("--gain");
    const down = cssColor("--loss");
    const list: SeriesMarker<Time>[] = [...groups.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((g) => ({
        time: g.date,
        position: g.side === "buy" ? "belowBar" : "aboveBar",
        shape: g.side === "buy" ? "arrowUp" : "arrowDown",
        color: g.side === "buy" ? up : down,
        size: 0.7,
        text: g.symbols.length === 1 ? g.symbols[0]! : String(g.symbols.length),
      }));
    markers?.setMarkers(list);
    chart.timeScale().fitContent();
  }

  function onMove(p: MouseEventParams) {
    hoverDate = typeof p.time === "string" ? p.time : null;
  }

  $effect(() => {
    if (!el) return;
    const node = el;
    untrack(() => {
      chart = createChart(node, {
        autoSize: true,
        crosshair: { mode: CrosshairMode.Magnet },
        rightPriceScale: { scaleMargins: { top: 0.18, bottom: 0.14 } },
        timeScale: { rightOffset: 1, timeVisible: false },
        handleScale: { mouseWheel: false },
      });
      bench = chart.addSeries(LineSeries, { lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      equity = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      markers = createSeriesMarkers(equity, []);
      chart.subscribeCrosshairMove(onMove);
      theme();
    });
    return () => {
      chart?.remove();
      chart = equity = bench = markers = null;
      baseline = null;
    };
  });

  $effect(() => {
    run.equity;
    run.fills;
    untrack(data);
  });
  $effect(() => {
    mode.current;
    untrack(theme);
  });
</script>

<div class={cn("relative", className)}>
  <div bind:this={el} class="size-full" role="img" aria-label="Equity against SPY, with fills"></div>
  <div class="num pointer-events-none absolute top-1.5 left-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]">
    <span class="flex items-center gap-1.5"><i class="bg-lab inline-block h-0.5 w-3"></i>Equity <span class="text-foreground">{shown ? usd(shown.equity) : "\u2014"}</span></span>
    <span class="text-muted-foreground flex items-center gap-1.5"><i class="bg-muted-foreground inline-block h-0.5 w-3 opacity-80"></i>SPY <span class="text-foreground">{shown ? usd(shown.benchmark) : "\u2014"}</span></span>
    {#if hoverDate}<span class="text-muted-foreground">{hoverDate}</span>{/if}
  </div>
  {#if run.equity.length === 0}
    <div class="text-muted-foreground absolute inset-0 grid place-items-center text-[13px]">Waiting for the first close</div>
  {/if}
</div>
