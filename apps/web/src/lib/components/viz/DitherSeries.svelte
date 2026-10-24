<script lang="ts">
  import AreaChart from "$lib/dither-kit/charts/AreaChart.svelte";
  import LineChart from "$lib/dither-kit/charts/LineChart.svelte";
  import Area from "$lib/dither-kit/charts/Area.svelte";
  import Line from "$lib/dither-kit/charts/Line.svelte";
  import Grid from "$lib/dither-kit/charts/Grid.svelte";
  import XAxis from "$lib/dither-kit/charts/XAxis.svelte";
  import YAxis from "$lib/dither-kit/charts/YAxis.svelte";
  import Tooltip from "$lib/dither-kit/charts/Tooltip.svelte";
  import { rebase } from "$lib/analytics";
  import { useChartColors } from "$lib/chartColors.svelte";
  import { motion } from "$lib/media.svelte";
  import { cn } from "$lib/utils.js";

  type Tone = "primary" | "gain" | "loss" | "warn" | "lab" | "muted";
  interface Series {
    key: string;
    label: string;
    tone: Tone;
    values: number[];
    dashed?: boolean;
  }

  let {
    kind = "line",
    labels,
    series,
    format,
    axisFormat = format,
    tickLabel = (l: string) => l,
    ariaLabel,
    marginLeft = 48,
    zeroBased = false,
    areaVariant = "gradient",
    legend = false,
    class: className = "h-48",
  }: {
    kind?: "line" | "area";
    /** One label per point, usually an ISO date. */
    labels: string[];
    series: Series[];
    /** Tooltip value formatting. */
    format: (v: number) => string;
    axisFormat?: (v: number) => string;
    tickLabel?: (label: string, index: number) => string;
    /** Describes the chart for screen readers; the visible reading says what it shows. */
    ariaLabel: string;
    marginLeft?: number;
    /** Keep the axis starting at zero instead of lifting it to the data (bars of magnitude). */
    zeroBased?: boolean;
    legend?: boolean;
    areaVariant?: "gradient" | "dotted" | "hatched" | "solid";
    class?: string;
  } = $props();

  const colors = useChartColors();
  const shifted = $derived(zeroBased ? { offset: 0, rows: series.map((s) => s.values) } : rebase(series.map((s) => s.values)));
  const rows = $derived(
    labels.map((label, i) => ({ label, ...Object.fromEntries(series.map((s, k) => [s.key, shifted.rows[k]?.[i] ?? 0])) })),
  );
  const config = $derived(Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: colors.c[s.tone] }])));
  const offset = $derived(shifted.offset);
</script>

{#snippet frame()}
  <Grid />
  <YAxis tickFormatter={(t) => axisFormat(t + offset)} tickCount={4} />
  <XAxis dataKey="label" tickFormatter={(v, i) => tickLabel(String(v), i)} maxTicks={5} />
  <Tooltip labelKey="label" valueFormatter={(v) => format(v + offset)} />
{/snippet}

<div class={cn("relative min-w-0", className)} role="img" aria-label={ariaLabel}>
  {#key `${series.map((s) => s.key).join()}:${labels.length}`}
    {#if kind === "area"}
      <AreaChart data={rows} {config} animate={false} margins={{ left: marginLeft, right: 8, top: 8, bottom: 22 }}>
        {#each series as s (s.key)}<Area dataKey={s.key} variant={areaVariant} />{/each}
        {@render frame()}
      </AreaChart>
    {:else}
      <LineChart data={rows} {config} animate={false} margins={{ left: marginLeft, right: 8, top: legend ? 22 : 8, bottom: 22 }}>
        {#each series as s (s.key)}<Line dataKey={s.key} strokeVariant={s.dashed ? "dashed" : "solid"} variant="solid" />{/each}
        {@render frame()}
      </LineChart>
    {/if}
  {/key}
</div>
