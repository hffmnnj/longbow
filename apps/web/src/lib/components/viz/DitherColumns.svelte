<script lang="ts">
  import BarChart from "$lib/dither-kit/charts/BarChart.svelte";
  import Bar from "$lib/dither-kit/charts/Bar.svelte";
  import Grid from "$lib/dither-kit/charts/Grid.svelte";
  import XAxis from "$lib/dither-kit/charts/XAxis.svelte";
  import YAxis from "$lib/dither-kit/charts/YAxis.svelte";
  import Tooltip from "$lib/dither-kit/charts/Tooltip.svelte";
  import { useChartColors } from "$lib/chartColors.svelte";
  import { motion } from "$lib/media.svelte";
  import { cn } from "$lib/utils.js";

  type Tone = "primary" | "gain" | "loss" | "warn" | "lab" | "muted";

  let { labels, series, format, axisFormat = (v: number) => format(v, ""), ariaLabel, marginLeft = 44, maxTicks = 8, class: className = "h-48", tooltipLabel }: {
    labels: string[];
    series: { key: string; label: string; tone: Tone; values: number[] }[];
    format: (v: number, key: string) => string;
    axisFormat?: (v: number) => string;
    ariaLabel: string;
    marginLeft?: number;
    maxTicks?: number;
    class?: string;
    /** Full tooltip heading per bar, when the axis label is too short to identify it. */
    tooltipLabel?: (index: number) => string;
  } = $props();

  const colors = useChartColors();
  const rows = $derived(
    labels.map((label, i) => ({ label, full: tooltipLabel?.(i) ?? label, ...Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? 0])) })),
  );
  const config = $derived(Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: colors.c[s.tone] }])));
</script>

<div class={cn("relative min-w-0", className)} role="img" aria-label={ariaLabel}>
  {#key `${series.map((s) => s.key).join()}:${labels.length}`}
    <BarChart data={rows} {config} animate={false} margins={{ left: marginLeft, right: 8, top: 8, bottom: 22 }}>
      {#each series as s (s.key)}<Bar dataKey={s.key} variant="gradient" />{/each}
      <Grid />
      <YAxis tickFormatter={axisFormat} tickCount={4} />
      <XAxis dataKey="label" maxTicks={maxTicks} />
      <Tooltip labelKey="full" valueFormatter={(v, name) => format(v, name)} />
    </BarChart>
  {/key}
</div>
