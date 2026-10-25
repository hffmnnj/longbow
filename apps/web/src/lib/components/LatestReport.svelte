<script lang="ts">
  import GradeChip from "./GradeChip.svelte";
  import Icon from "./Icon.svelte";
  import Pnl from "./Pnl.svelte";
  import { ArrowRight01Icon, News01Icon } from "$lib/icons";
  import { KIND_LABEL, reportPeriodShort } from "$lib/reports";
  import { harness } from "$lib/store.svelte";
  import { openReport } from "$lib/ui.svelte";

  const latest = $derived(harness.latestReport);
</script>

{#if harness.reports.state === "loading" && !latest}
  <div class="border-border bg-card h-[5.5rem] animate-pulse rounded-lg border" aria-hidden="true"></div>
{:else if latest}
  {@const r = latest}
  <button
    type="button"
    onclick={() => openReport(r.id)}
    class="border-border bg-card hover:border-muted-foreground/50 focus-visible:border-ring group flex w-full flex-col gap-1 rounded-lg border p-3.5 text-left transition-colors"
    aria-label={`Latest report: ${r.headline}`}
  >
    <span class="text-muted-foreground flex items-center gap-1.5 text-[12px]">
      <Icon icon={News01Icon} class="size-3.5" />
      Latest report · {KIND_LABEL[r.kind]}
      <span class="num">· {reportPeriodShort(r.kind, r.periodStart, r.periodEnd)}</span>
      {#if r.grade}<span class="ml-auto"><GradeChip grade={r.grade} /></span>{/if}
    </span>
    <span class="max-w-[62ch] truncate text-[13.5px] font-medium">{r.headline}</span>
    <span class="num flex items-center gap-2 text-[12.5px]">
      {#if r.pnl !== undefined || r.pnlPct !== undefined}
        <Pnl amount={r.pnl} percent={r.pnlPct} />
      {:else}
        <span class="text-muted-foreground">Figures inside</span>
      {/if}
      <span class="text-primary ml-auto inline-flex items-center gap-1 text-[12px] font-medium">
        Read <Icon icon={ArrowRight01Icon} class="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </span>
  </button>
{/if}
