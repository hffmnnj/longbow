<script lang="ts">
  import { untrack } from "svelte";
  import { mode } from "mode-watcher";
  import {
    CandlestickSeries,
    ColorType,
    CrosshairMode,
    HistogramSeries,
    LineSeries,
    LineStyle,
    createChart,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type MouseEventParams,
  } from "lightweight-charts";
  import type { Bar } from "@rh/shared";
  import { sma } from "$lib/chart";
  import { cssColor } from "$lib/chartTheme";
  import { usd } from "$lib/format";
  import { cn } from "$lib/utils.js";

  interface PriceLine {
    price: number;
    label: string;
    tone: "loss" | "primary";
  }

  let { bars, mini = false, lines = [], class: className = "" }: {
    bars: Bar[];
    /** Compact line chart with no axes chrome, for order cards. */
    mini?: boolean;
    lines?: PriceLine[];
    class?: string;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | null = null;
  let candle: ISeriesApi<"Candlestick"> | null = null;
  let closeLine: ISeriesApi<"Line"> | null = null;
  let volume: ISeriesApi<"Histogram"> | null = null;
  let sma20: ISeriesApi<"Line"> | null = null;
  let sma50: ISeriesApi<"Line"> | null = null;
  let hover = $state<Bar | null>(null);
  const byDate = $derived(new Map(bars.map((b) => [b.date, b])));
  const shown = $derived(hover ?? bars[bars.length - 1] ?? null);

  const FONT = "'IBM Plex Mono', ui-monospace, monospace";

  function palette() {
    return {
      text: cssColor("--muted-foreground"),
      grid: cssColor("--border", 0.45),
      border: cssColor("--border"),
      up: cssColor("--gain"),
      down: cssColor("--loss"),
      upSoft: cssColor("--gain", 0.32),
      downSoft: cssColor("--loss", 0.32),
      primary: cssColor("--primary"),
      slow: cssColor("--muted-foreground", 0.9),
      fg: cssColor("--foreground"),
    };
  }

  function theme() {
    if (!chart) return;
    const c = palette();
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontFamily: FONT, fontSize: mini ? 10 : 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: mini ? "transparent" : c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
      crosshair: { vertLine: { color: c.text, labelBackgroundColor: c.border }, horzLine: { color: c.text, labelBackgroundColor: c.border } },
    });
    candle?.applyOptions({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    closeLine?.applyOptions({ color: c.fg });
    sma20?.applyOptions({ color: c.primary });
    sma50?.applyOptions({ color: c.slow });
    setVolume();
  }

  function setVolume() {
    if (!volume) return;
    const c = palette();
    volume.setData(bars.map((b) => ({ time: b.date, value: b.volume, color: b.close >= b.open ? c.upSoft : c.downSoft })));
  }

  function data() {
    if (!chart) return;
    if (mini) {
      closeLine?.setData(bars.map((b) => ({ time: b.date, value: b.close })));
    } else {
      candle?.setData(bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));
      setVolume();
      sma20?.setData(sma(bars, 20));
      sma50?.setData(sma(bars, 50));
    }
    chart.timeScale().fitContent();
  }

  let handles: { series: ISeriesApi<"Candlestick" | "Line">; line: IPriceLine }[] = [];

  function priceLines() {
    for (const h of handles) h.series.removePriceLine(h.line);
    handles = [];
    const series = mini ? closeLine : candle;
    if (!series) return;
    const c = palette();
    handles = lines.map((l) => ({
      series,
      line: series.createPriceLine({
        price: l.price,
        color: l.tone === "loss" ? c.down : c.primary,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: !mini,
        title: l.label,
      }),
    }));
  }

  function onMove(p: MouseEventParams) {
    hover = typeof p.time === "string" ? (byDate.get(p.time) ?? null) : null;
  }

  $effect(() => {
    if (!el) return;
    const node = el;
    untrack(() => {
      chart = createChart(node, {
        autoSize: true,
        handleScroll: !mini,
        handleScale: !mini,
        crosshair: { mode: mini ? CrosshairMode.Hidden : CrosshairMode.Normal },
        rightPriceScale: { visible: !mini, scaleMargins: mini ? { top: 0.14, bottom: 0.14 } : { top: 0.06, bottom: 0.24 } },
        timeScale: { visible: !mini, rightOffset: 2, timeVisible: false },
      });
      if (mini) {
        closeLine = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      } else {
        candle = chart.addSeries(CandlestickSeries, { priceLineVisible: false });
        volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        sma20 = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        sma50 = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        chart.subscribeCrosshairMove(onMove);
      }
      theme();
      data();
      priceLines();
    });
    return () => {
      handles = [];
      chart?.remove();
      chart = candle = closeLine = volume = sma20 = sma50 = null;
    };
  });

  $effect(() => {
    bars;
    untrack(data);
  });
  $effect(() => {
    lines;
    mode.current;
    untrack(priceLines);
  });
  $effect(() => {
    mode.current;
    untrack(theme);
  });
</script>

<div class={cn("relative", className)}>
  <div bind:this={el} class="size-full" role="img" aria-label={mini ? "Three month price chart" : "Price chart"}></div>
  {#if !mini && shown}
    <div class="num text-muted-foreground pointer-events-none absolute top-1.5 right-16 left-2 flex flex-col gap-1 text-[11px]">
      <div class="flex flex-wrap items-center gap-x-3">
        <span>{shown.date}</span>
        <span>O <span class="text-foreground">{usd(shown.open)}</span></span>
        <span>H <span class="text-foreground">{usd(shown.high)}</span></span>
        <span>L <span class="text-foreground">{usd(shown.low)}</span></span>
        <span>C <span class="text-foreground">{usd(shown.close)}</span></span>
      </div>
      <div class="flex gap-3 text-[10.5px]">
        <span class="flex items-center gap-1"><i class="bg-primary inline-block h-0.5 w-3"></i>SMA 20</span>
        <span class="flex items-center gap-1"><i class="bg-muted-foreground inline-block h-0.5 w-3"></i>SMA 50</span>
      </div>
    </div>
  {/if}
</div>
