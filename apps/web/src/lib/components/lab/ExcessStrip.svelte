<script lang="ts">
  import { tone } from "$lib/format";

  export interface ExcessDot {
    id: string;
    /** Run label, for example the scenario name. */
    label: string;
    variant: string;
    value: number | undefined;
  }

  let { runs, variants }: { runs: ExcessDot[]; variants: string[] } = $props();

  const W = 100;
  const PAD = 5;
  const ROW = 26;
  const TOP = 9;
  const plotted = $derived(runs.filter((r) => r.value !== undefined));
  const lo = $derived(plotted.length ? Math.min(...plotted.map((r) => r.value!), 0) : -1);
  const hi = $derived(plotted.length ? Math.max(...plotted.map((r) => r.value!), 0) : 1);
  const span = $derived(hi - lo || 1);
  const x = (v: number) => PAD + ((v - lo) / span) * (W - PAD * 2);
  const height = $derived(TOP * 2 + variants.length * ROW);
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
</script>

{#if plotted.length === 0}
  <p class="text-muted-foreground px-3.5 py-3 text-[13px]">Excess returns appear once runs start closing.</p>
{:else}
  <figure>
    <svg viewBox={`0 0 ${W} ${height}`} class="h-auto w-full" role="img" aria-label={`Excess return per run: ${plotted.map((r) => `${r.label} ${fmt(r.value!)}`).join(", ")}`}>
      <line x1={x(0)} y1={TOP - 2} x2={x(0)} y2={height - TOP + 2} stroke="var(--border)" stroke-width="0.4" stroke-dasharray="1.2 1" />
      {#each variants as label, gi (label)}
        {@const y = TOP + gi * ROW + ROW / 2}
        <text x={PAD} y={y - 8} font-size="3.4" fill="var(--muted-foreground)" font-family="var(--font-mono)">{label}</text>
        {#each plotted.filter((r) => r.variant === label) as r, i (r.id)}
          {@const t = tone(r.value!)}
          <circle
            cx={x(r.value!)}
            cy={y + (i % 2 === 0 ? -2.4 : 2.4)}
            r="2.1"
            fill={t === "gain" ? "var(--gain)" : t === "loss" ? "var(--loss)" : "var(--muted-foreground)"}
            opacity="0.9"
          >
            <title>{r.label}: {fmt(r.value!)} points over benchmark</title>
          </circle>
        {/each}
      {/each}
    </svg>
    <figcaption class="num text-muted-foreground flex justify-between px-3.5 pb-3 text-[11px]">
      <span>{fmt(lo)} pts</span><span>0 vs benchmark</span><span>{fmt(hi)} pts</span>
    </figcaption>
  </figure>
{/if}
