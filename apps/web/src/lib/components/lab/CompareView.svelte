<script lang="ts">
  import type { SimRun } from "@rh/shared";
  import * as Table from "$lib/components/ui/table/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "../Icon.svelte";
  import Pnl from "../Pnl.svelte";
  import CompareChart, { type Line } from "./CompareChart.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import { ArrowLeft01Icon } from "$lib/icons";
  import { compareLabels, metricRows, normalizedSeries } from "$lib/sim";

  let { runs, onback }: { runs: SimRun[]; onback: () => void } = $props();

  /** Theme tokens, in order; no green or red, which belong to P&L. */
  const COLORS = ["--lab", "--primary", "--warn", "--foreground", "--muted-foreground"];

  const labels = $derived(compareLabels(runs));
  const lines = $derived<Line[]>(
    runs.map((r, i) => ({ id: r.id, label: labels[i]!, color: COLORS[i % COLORS.length]!, points: normalizedSeries(r) })),
  );
  const rows = $derived(runs.map(metricRows));
  const labelsCol = $derived(rows[0]?.map((r) => r.label) ?? []);
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-4">
  <header class="flex shrink-0 items-center gap-2">
    <Button variant="ghost" size="icon" class="-ml-2 size-11 shrink-0 md:hidden" onclick={onback} aria-label="Back to runs">
      <Icon icon={ArrowLeft01Icon} />
    </Button>
    <h2 class="min-w-0 flex-1 text-[16px] font-semibold">Compare {runs.length} runs</h2>
    <PaperBadge />
  </header>

  <section class="border-border bg-card flex shrink-0 flex-col gap-2 rounded-lg border p-3" aria-label="Equity indexed to 100">
    <ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
      {#each lines as l (l.id)}
        <li class="flex min-w-0 items-center gap-1.5">
          <i class="inline-block h-0.5 w-4 shrink-0 rounded-full" style:background={`var(${l.color})`}></i>
          <span class="truncate">{l.label}</span>
        </li>
      {/each}
    </ul>
    <CompareChart {lines} class="h-60 w-full md:h-72" />
    <p class="text-muted-foreground num text-[11.5px]">Index, 100 = starting cash. Day 0 is the start.</p>
  </section>

  <section class="border-border bg-card shrink-0 overflow-hidden rounded-lg border" aria-label="Metrics side by side">
    <Table.Root class="text-[12.5px]">
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class="bg-card text-muted-foreground sticky left-0 z-10 h-9 px-3.5 text-[11.5px]">Metric</Table.Head>
          {#each lines as l (l.id)}
            <Table.Head class="h-9 min-w-32 text-right text-[12px]">
              <span class="inline-flex max-w-40 items-center justify-end gap-1.5">
                <i class="inline-block size-2 shrink-0 rounded-full" style:background={`var(${l.color})`}></i>
                <span class="text-foreground truncate font-medium">{l.label}</span>
              </span>
            </Table.Head>
          {/each}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell class="bg-card text-muted-foreground sticky left-0 px-3.5 py-2">Window</Table.Cell>
          {#each runs as r (r.id)}
            <Table.Cell class="num py-2 text-right">{r.progress.day}/{r.progress.days}d · {r.progress.cyclesPerDay}/d</Table.Cell>
          {/each}
        </Table.Row>
        {#each labelsCol as label, i (label)}
          <Table.Row>
            <Table.Cell class="bg-card text-muted-foreground sticky left-0 px-3.5 py-2">{label}</Table.Cell>
            {#each rows as col, c (runs[c]!.id)}
              {@const cell = col[i]!}
              <Table.Cell class="num py-2 text-right">
                {#if cell.pnl !== undefined}<Pnl percent={cell.pnl} />{:else}{cell.text}{/if}
              </Table.Cell>
            {/each}
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </section>
</div>
