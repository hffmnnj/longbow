<script lang="ts">
  import { untrack } from "svelte";
  import { mode } from "mode-watcher";
  import {
    ColorType,
    LineSeries,
    LineStyle,
    createChart,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type UTCTimestamp,
  } from "lightweight-charts";
  import { cssColor } from "$lib/chartTheme";
  import type { DayPoint } from "$lib/sim";
  import { cn } from "$lib/utils.js";

  export interface Line {
    id: string;
    label: string;
    color: string;
    points: DayPoint[];
  }

  let { lines, class: className = "" }: { lines: Line[]; class?: string } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | null = null;
  let series = new Map<string, ISeriesApi<"Line">>();
  let baseLine: { s: ISeriesApi<"Line">; line: IPriceLine } | null = null;

  const DAY = 86_400;
  const FONT = "'IBM Plex Mono', ui-monospace, monospace";

  function theme() {
    if (!chart) return;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssColor("--muted-foreground"), fontFamily: FONT, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: cssColor("--border", 0.45) } },
      rightPriceScale: { borderColor: cssColor("--border") },
      timeScale: { borderColor: cssColor("--border") },
      crosshair: { vertLine: { color: cssColor("--muted-foreground"), labelBackgroundColor: cssColor("--border") }, horzLine: { color: cssColor("--muted-foreground"), labelBackgroundColor: cssColor("--border") } },
    });
    sync();
  }

  function sync() {
    if (!chart) return;
    if (baseLine) {
      try {
        baseLine.s.removePriceLine(baseLine.line);
      } catch {
        /* its series is already gone */
      }
      baseLine = null;
    }
    for (const [id, s] of series) {
      if (!lines.some((l) => l.id === id)) {
        chart.removeSeries(s);
        series.delete(id);
      }
    }
    for (const l of lines) {
      let s = series.get(l.id);
      if (!s) {
        s = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 3 });
        series.set(l.id, s);
      }
      s.applyOptions({ color: cssColor(l.color) });
      s.setData(l.points.map((p) => ({ time: (p.day * DAY) as UTCTimestamp, value: p.value })));
    }
    const first = series.values().next().value;
    if (first) {
      baseLine = { s: first, line: first.createPriceLine({ price: 100, color: cssColor("--muted-foreground", 0.6), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" }) };
    }
    chart.timeScale().fitContent();
  }

  $effect(() => {
    if (!el) return;
    const node = el;
    untrack(() => {
      chart = createChart(node, {
        autoSize: true,
        rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: {
          rightOffset: 1,
          tickMarkFormatter: (t: number) => `D${Math.round(t / DAY)}`,
          fixLeftEdge: true,
        },
        localization: { timeFormatter: (t: number) => `Day ${Math.round(t / DAY)}`, priceFormatter: (p: number) => p.toFixed(1) },
        handleScale: { mouseWheel: false },
      });
      theme();
    });
    return () => {
      chart?.remove();
      chart = null;
      series = new Map();
      baseLine = null;
    };
  });

  $effect(() => {
    lines;
    untrack(sync);
  });
  $effect(() => {
    mode.current;
    untrack(theme);
  });
</script>

<div bind:this={el} class={cn("size-full", className)} role="img" aria-label="Equity curves normalized to 100 at the start"></div>
