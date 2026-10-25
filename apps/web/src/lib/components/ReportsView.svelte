<script lang="ts">
  import type { ReportKind } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import Empty from "./Empty.svelte";
  import GradeChip from "./GradeChip.svelte";
  import Pnl from "./Pnl.svelte";
  import Ticker from "./Ticker.svelte";
  import { groupReportsByWeek, KIND_LABEL, reportPeriodShort } from "$lib/reports";
  import { harness } from "$lib/store.svelte";
  import { openReport } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  type Filter = "all" | ReportKind;
  let filter = $state<Filter>("all");
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "trade", label: "Trades" },
  ];

  $effect(() => {
    if (harness.loaded) void harness.loadReports();
  });

  const loadable = $derived(harness.reports);
  const list = $derived((loadable.data ?? []).filter((r) => filter === "all" || r.kind === filter));
  const groups = $derived(groupReportsByWeek(list));
  /** Reports that arrived after the first paint slide in at the top. */
  let baseline = $state<string[] | null>(null);
  $effect(() => {
    const data = loadable.data;
    if (data && baseline === null) baseline = data.map((r) => r.id);
  });
  const isNew = (id: string): boolean => baseline !== null && !baseline.includes(id);

  const emptyText = $derived(
    filter === "all"
      ? "No reports yet. The agent publishes daily, weekly and trade reports here."
      : filter === "trade"
        ? "No trade reports yet. Closed positions get their own one-page brief."
        : `No ${filter} reports yet.`,
  );
  const toggle =
    "text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground num h-11 min-w-10 flex-1 rounded-[5px] px-2.5 text-[12px] font-medium data-[state=on]:shadow-sm sm:flex-none md:h-7";
</script>

<div class="mx-auto flex w-full max-w-[880px] flex-col gap-3">
  <div class="flex flex-wrap items-center gap-2">
    <ToggleGroup.Root
      type="single"
      bind:value={() => filter, (v) => v && (filter = v as Filter)}
      aria-label="Report kind"
      class="bg-muted/60 border-border inline-flex w-full rounded-md border p-0.5 sm:w-auto"
    >
      {#each filters as f (f.value)}
        <ToggleGroup.Item value={f.value} class={toggle}>{f.label}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
    {#if loadable.data !== undefined}
      <span class="num text-muted-foreground ml-auto text-[12px]">
        {list.length} report{list.length === 1 ? "" : "s"}
      </span>
    {/if}
  </div>

  {#if loadable.data !== undefined}
    {#if groups.length === 0}
      <div class="border-border bg-card rounded-lg border">
        <Empty text={emptyText} />
      </div>
    {:else}
      {#each groups as g (g.key)}
        <section aria-label={g.label}>
          <h2 class="label-caps px-1 pt-1 pb-1.5">{g.label}</h2>
          <ul class="flex flex-col gap-2">
            {#each g.items as r (r.id)}
              <li class={cn(isNew(r.id) && "rise-in")}>
                <button
                  type="button"
                  onclick={() => openReport(r.id)}
                  class="border-border bg-card hover:border-muted-foreground/50 focus-visible:border-ring flex w-full flex-col gap-1 rounded-lg border p-3.5 text-left transition-colors"
                >
                  <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="label-caps">{KIND_LABEL[r.kind]}</span>
                    {#if r.kind === "trade" && r.symbol}<Ticker symbol={r.symbol} />{/if}
                    <span class="num text-muted-foreground text-[12px]">{reportPeriodShort(r.kind, r.periodStart, r.periodEnd)}</span>
                    {#if r.grade}<span class="ml-auto"><GradeChip grade={r.grade} /></span>{/if}
                  </span>
                  <span class="text-[14px] leading-snug font-medium text-balance">{r.headline}</span>
                  <span class="num flex flex-wrap items-center gap-x-2 text-[12.5px]">
                    {#if r.pnl !== undefined || r.pnlPct !== undefined}
                      <Pnl amount={r.pnl} percent={r.pnlPct} />
                    {:else}
                      <span class="text-muted-foreground">Figures inside</span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
    {#if loadable.state === "loading"}
      <div class="bg-muted/50 h-20 animate-pulse rounded-lg" aria-hidden="true"></div>
    {/if}
    {#if loadable.error}
      <p class="text-warn px-1 text-[12px]">Could not refresh: {loadable.error}</p>
    {/if}
  {:else if loadable.state === "error"}
    <div class="border-border bg-card flex flex-col items-start justify-center gap-2 rounded-lg border p-6 text-[13px]" role="alert">
      <span class="text-muted-foreground">Could not load reports: {loadable.error}</span>
      <Button size="sm" variant="outline" onclick={() => harness.loadReports(true)}>Retry</Button>
    </div>
  {:else}
    <ul class="flex flex-col gap-2" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}
        <li class="bg-muted/50 h-28 animate-pulse rounded-lg"></li>
      {/each}
    </ul>
  {/if}
</div>
