<script lang="ts">
  import AreaChart from "$lib/dither-kit/charts/AreaChart.svelte";
  import Area from "$lib/dither-kit/charts/Area.svelte";
  import { rebase } from "$lib/analytics";
  import { useChartColors } from "$lib/chartColors.svelte";
  import { cn } from "$lib/utils.js";

  let { values, tone, label, variant = "gradient", class: className = "h-7 w-20" }: {
    variant?: "gradient" | "dotted" | "hatched" | "solid";
    values: number[];
    /** Defaults to gain when the series ends above where it began, loss otherwise. */
    tone?: "primary" | "gain" | "loss" | "muted";
    label: string;
    class?: string;
  } = $props();

  const colors = useChartColors();
  const up = $derived(values.length > 1 && values[values.length - 1]! >= values[0]!);
  const color = $derived(colors.c[tone ?? (up ? "gain" : "loss")]);
  const rows = $derived(rebase([values], 0.05).rows[0]!.map((v) => ({ v })));
</script>

{#if values.length > 1}
  <div class={cn("shrink-0", className)} role="img" aria-label={label}>
    <AreaChart data={rows} config={{ v: { color } }} interactive={false} animate={false} sparkles={false} margins={{ top: 1, right: 0, bottom: 1, left: 0 }}>
      <Area dataKey="v" {variant} />
    </AreaChart>
  </div>
{:else}
  <span class={cn("bg-muted/60 block rounded", className)} aria-hidden="true"></span>
{/if}
