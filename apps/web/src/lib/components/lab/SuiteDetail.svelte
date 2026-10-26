<script lang="ts">
  import type { SimSuite, SimSuiteVariantSummary } from "@rh/shared";
  import * as Table from "$lib/components/ui/table/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Empty from "../Empty.svelte";
  import Icon from "../Icon.svelte";
  import Pnl from "../Pnl.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import RunStatus from "./RunStatus.svelte";
  import ExcessStrip from "./ExcessStrip.svelte";
  import { ArrowLeft01Icon, StopIcon } from "$lib/icons";
  import { pctSigned } from "$lib/format";
  import { sim } from "$lib/sim.svelte";
  import { comparisonReading, excessReturn, isActive, suiteProgress } from "$lib/sim";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let { suite, onback }: { suite: SimSuite; onback?: () => void } = $props();

  const live = $derived(isActive(suite.status));
  const progress = $derived(suiteProgress(suite, sim.runs));
  const reading = $derived(comparisonReading(suite));
  const variants = $derived(suite.config.variants.map((v) => v.label));

  interface MarketCell {
    runId: string;
    label: string;
    sub: string;
    ret: number | undefined;
    status: string;
  }
  const byVariant = $derived(
    variants.map((label) => ({
      label,
      strategy: suite.config.variants.find((v) => v.label === label)?.strategy,
      cells: suite.runs
        .filter((e) => e.variant === label)
        .map((e): MarketCell => {
          const run = sim.run(e.runId);
          return {
            runId: e.runId,
            label: e.scenario ? (sim.scenarios.find((s) => s.id === e.scenario)?.name ?? e.scenario) : e.seed !== undefined ? `Bootstrap ${e.seed}` : "Market",
            sub: e.seed !== undefined ? `seed ${e.seed}` : "",
            ret: run ? run.metrics?.returnPct : undefined,
            status: run?.status ?? "queued",
          };
        }),
    })),
  );
  const dots = $derived(
    suite.runs.map((e) => {
      const run = sim.run(e.runId);
      return {
        id: e.runId,
        label: e.scenario ?? (e.seed !== undefined ? `Bootstrap ${e.seed}` : e.runId),
        variant: e.variant,
        value: run ? excessReturn(run) : undefined,
      };
    }),
  );

  const fmt = (v: number | undefined, suffix = "") => {
    if (v === undefined) return "—";
    const digits = v % 1 === 0 || Math.abs(v) >= 10 ? 0 : 1;
    return `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;
  };

  interface SummaryRow {
    label: string;
    get: (s: SimSuiteVariantSummary) => string;
    pnl?: (s: SimSuiteVariantSummary) => number | undefined;
  }
  const summaryRows: SummaryRow[] = [
    { label: "Runs done", get: (s) => `${s.done}/${s.runs}` },
    { label: "Mean return", get: (s) => fmt(s.meanReturnPct, "%"), pnl: (s) => s.meanReturnPct },
    { label: "Median return", get: (s) => fmt(s.medianReturnPct, "%"), pnl: (s) => s.medianReturnPct },
    {
      label: "P10 – P90",
      get: (s) => (s.p10ReturnPct === undefined || s.p90ReturnPct === undefined ? "—" : `${fmt(s.p10ReturnPct)} to ${fmt(s.p90ReturnPct)}`),
    },
    { label: "Mean excess", get: (s) => fmt(s.meanExcessPct, " pts"), pnl: (s) => s.meanExcessPct },
    { label: "Beat benchmark", get: (s) => (s.beatBenchmarkPct === undefined ? "—" : `${Math.round(s.beatBenchmarkPct)}%`) },
    { label: "Worst drawdown", get: (s) => (s.worstDrawdownPct === undefined ? "—" : `${s.worstDrawdownPct.toFixed(2)}%`) },
    { label: "Median Sharpe", get: (s) => (s.medianSharpe === undefined ? "—" : s.medianSharpe.toFixed(2)) },
    { label: "Win rate", get: (s) => (s.winRatePct === undefined ? "—" : `${Math.round(s.winRatePct)}%`) },
    { label: "Avg R", get: (s) => (s.avgR === undefined ? "—" : `${s.avgR.toFixed(2)}R`) },
    { label: "Costs", get: (s) => (s.costsPct === undefined ? "—" : `${s.costsPct.toFixed(2)}%`) },
  ];

  function openRun(id: string) {
    ui.run = id;
    ui.labTab = "runs";
  }

  $effect(() => {
    void sim.loadScenarios();
  });
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-4">
  <header class="flex shrink-0 flex-col gap-2">
    <div class="flex items-center gap-2">
      {#if onback}
        <Button variant="ghost" size="icon" class="-ml-2 size-11 shrink-0" onclick={onback} aria-label="Back to suites">
          <Icon icon={ArrowLeft01Icon} />
        </Button>
      {/if}
      <h2 class="min-w-0 flex-1 text-[16px] leading-snug font-semibold">{suite.config.name}</h2>
      <PaperBadge />
      {#if live}
        <Button variant="outline" class="border-destructive/50 text-destructive hover:bg-destructive/10 h-10 gap-1.5 md:h-9" onclick={() => sim.stopSuite(suite.id)}>
          <Icon icon={StopIcon} class="size-3.5" /> Stop
        </Button>
      {/if}
    </div>
    <div class="text-muted-foreground num flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
      <RunStatus status={suite.status} />
      <span>{progress.done} of {progress.total} runs done</span>
      <span>{variants.join(" vs ")}</span>
      {#if suite.startedBy === "agent"}<span class="bg-secondary text-foreground rounded px-1.5 py-px font-sans text-[11px] font-medium">By agent</span>{/if}
    </div>
    {#if live && progress.total > 0}
      <div class="bg-muted h-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total} aria-label="Suite progress">
        <div class="bg-lab h-full rounded-full transition-[width] duration-500" style:width={`${(progress.done / progress.total) * 100}%`}></div>
      </div>
    {/if}
  </header>

  {#if reading}
    <section
      class={cn(
        "shrink-0 rounded-lg border px-3.5 py-3",
        reading.conclusive ? "border-lab/50 bg-lab-bg" : "border-border bg-card",
      )}
      aria-label="Variant comparison"
    >
      <h3 class="label-caps pb-1">{variants.length === 2 ? `${variants[0]} vs ${variants[1]}` : "Comparison"}</h3>
      <p class="text-[14px] leading-snug font-medium">{reading.text}</p>
    </section>
  {/if}

  <section class="border-border bg-card shrink-0 overflow-hidden rounded-lg border" aria-label="Variant summary">
    <div class="overflow-x-auto">
      <Table.Root class="min-w-[34rem] text-[12.5px]">
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class="text-muted-foreground sticky left-0 h-9 px-3.5 text-[11.5px]">Metric</Table.Head>
            {#each suite.summary as s (s.label)}
              <Table.Head class="h-9 text-right text-[12px]"><span class="text-foreground font-medium">{s.label}</span></Table.Head>
            {/each}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each summaryRows as row (row.label)}
            <Table.Row>
              <Table.Cell class="text-muted-foreground px-3.5 py-2">{row.label}</Table.Cell>
              {#each suite.summary as s (s.label)}
                {@const v = row.pnl?.(s)}
                <Table.Cell class="num py-2 text-right">
                  {#if v !== undefined}<Pnl percent={v} showAmount={false} />{:else}{row.get(s)}{/if}
                </Table.Cell>
              {/each}
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </section>

  <section class="border-border bg-card shrink-0 rounded-lg border" aria-label="Excess return spread">
    <h3 class="label-caps px-3.5 pt-3">Excess per run</h3>
    <ExcessStrip runs={dots} {variants} />
  </section>

  <section class="flex shrink-0 flex-col gap-2" aria-label="Markets by variant">
    <h3 class="label-caps">Markets by variant</h3>
    <div class="grid gap-2.5 sm:grid-cols-2">
      {#each byVariant as group (group.label)}
        <div class="border-border bg-card flex flex-col gap-1.5 rounded-lg border p-2.5">
          <p class="flex items-baseline justify-between gap-2 px-1">
            <span class="text-[13px] font-semibold">{group.label}</span>
            {#if group.strategy}<span class="text-muted-foreground line-clamp-1 min-w-0 text-[11.5px]">{group.strategy}</span>{/if}
          </p>
          {#each group.cells as c (c.runId)}
            <button
              type="button"
              onclick={() => openRun(c.runId)}
              class={cn(
                "border-border hover:bg-muted/40 flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                c.ret !== undefined && c.ret > 0 && "border-gain/40",
                c.ret !== undefined && c.ret < 0 && "border-loss/40",
              )}
              aria-label={`Open ${c.label}, return ${c.ret !== undefined ? pctSigned(c.ret) : "pending"}`}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] font-medium">{c.label}</span>
                {#if c.sub}<span class="text-muted-foreground num block text-[11px]">{c.sub}</span>{/if}
              </span>
              {#if c.ret !== undefined}
                <Pnl percent={c.ret} class="text-[13px] font-semibold" />
              {:else}
                <span class="text-muted-foreground num text-[12px] capitalize">{c.status}</span>
              {/if}
            </button>
          {:else}
            <Empty text="No markets yet" />
          {/each}
        </div>
      {/each}
    </div>
  </section>
</div>
