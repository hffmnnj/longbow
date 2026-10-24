<script lang="ts">
  import { untrack } from "svelte";
  import type { SimRun } from "@rh/shared";
  import * as Table from "$lib/components/ui/table/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import AgentsLane from "../AgentsLane.svelte";
  import Empty from "../Empty.svelte";
  import Icon from "../Icon.svelte";
  import Journal from "../Journal.svelte";
  import OrdersList from "../OrdersList.svelte";
  import Pnl from "../Pnl.svelte";
  import SideBadge from "../SideBadge.svelte";
  import StickyScroll from "../StickyScroll.svelte";
  import Ticker from "../Ticker.svelte";
  import Transcript from "../Transcript.svelte";
  import EquityChart from "./EquityChart.svelte";
  import MetricsGrid from "./MetricsGrid.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import RunStatus from "./RunStatus.svelte";
  import { ArrowLeft01Icon, StopIcon } from "$lib/icons";
  import { isoShort, qty, usd } from "$lib/format";
  import { provideScope } from "$lib/scope";
  import { sim } from "$lib/sim.svelte";
  import { estimateMinutes, formatEstimate, isActive, progressFraction, runTitle } from "$lib/sim";
  import { ui } from "$lib/ui.svelte";

  let { run, onback }: { run: SimRun; onback?: () => void } = $props();

  // The parent keys this component by run id, so the id is fixed for its lifetime.
  const id = untrack(() => run.id);
  const scope = sim.scope(id);
  provideScope(scope);
  $effect(() => {
    void sim.loadFeed(id);
  });

  let section = $state("feed");
  const feed = $derived(sim.feed(id));
  const live = $derived(isActive(run.status));
  const left = $derived(
    estimateMinutes(run.progress.days - run.progress.day, run.progress.cyclesPerDay) +
      (run.progress.cyclesPerDay - run.progress.cycle + 1) * 1.5,
  );
  const sections = $derived([
    { value: "feed", label: "Agent" },
    { value: "fills", label: `Fills ${run.fills.length}` },
    { value: "positions", label: `Positions ${run.positions.length}` },
    { value: "journal", label: "Journal" },
    { value: "orders", label: "Orders" },
  ]);
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-4">
  <header class="flex shrink-0 flex-col gap-2">
    <div class="flex items-center gap-2">
      {#if onback}
        <Button variant="ghost" size="icon" class="-ml-2 size-11 shrink-0" onclick={onback} aria-label="Back to runs">
          <Icon icon={ArrowLeft01Icon} />
        </Button>
      {/if}
      <h2 class="min-w-0 flex-1 text-[16px] leading-snug font-semibold">{runTitle(run)}</h2>
      <PaperBadge />
      {#if live}
        <Button variant="outline" class="border-destructive/50 text-destructive hover:bg-destructive/10 h-10 gap-1.5 md:h-9" onclick={() => sim.stop(id)}>
          <Icon icon={StopIcon} class="size-3.5" /> Stop
        </Button>
      {/if}
    </div>
    <div class="text-muted-foreground num flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
      <RunStatus status={run.status} />
      <span>Day {run.progress.day} of {run.progress.days}</span>
      {#if run.currentDate}<span>{isoShort(run.currentDate)}</span>{/if}
      {#if live}<span>Cycle {run.progress.cycle}/{run.progress.cyclesPerDay}</span>{/if}
      <span>{usd(run.config.startingCash)} start</span>
      {#if live}<span>{formatEstimate(left)} left</span>{/if}
      {#if run.startedBy === "agent"}<span class="bg-secondary text-foreground rounded px-1.5 py-px font-sans text-[11px] font-medium">By agent</span>{/if}
    </div>
    {#if live}
      <div class="bg-muted h-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={run.progress.day} aria-valuemin={0} aria-valuemax={run.progress.days} aria-label="Simulation progress">
        <div class="bg-lab h-full rounded-full transition-[width] duration-500" style:width={`${progressFraction(run) * 100}%`}></div>
      </div>
    {/if}
    {#if run.error}
      <p class="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-[12.5px]" role="alert">{run.error}</p>
    {/if}
    {#if run.config.strategy}
      <p class="text-muted-foreground line-clamp-3 max-w-prose text-[12.5px] leading-relaxed">{run.config.strategy}</p>
    {/if}
  </header>

  <section class="border-border bg-card shrink-0 rounded-lg border" aria-label="Equity curve">
    <EquityChart {run} class="h-56 w-full md:h-72" />
  </section>

  <MetricsGrid {run} />

  <section class="border-border bg-card flex shrink-0 flex-col overflow-hidden rounded-lg border" aria-label="Run activity">
    <div class="border-border no-scrollbar shrink-0 overflow-x-auto border-b p-2">
      <ToggleGroup.Root
        type="single"
        bind:value={() => section, (v) => v && (section = v)}
        aria-label="Run section"
        class="bg-muted/60 border-border flex w-max min-w-full rounded-md border p-0.5"
      >
        {#each sections as s (s.value)}
          <ToggleGroup.Item
            value={s.value}
            class="text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground h-10 flex-1 rounded-[5px] px-2.5 text-[13px] font-medium whitespace-nowrap data-[state=on]:shadow-sm md:h-9"
          >
            {s.label}
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </div>

    {#if section === "feed"}
      <div class="flex h-[30rem] max-h-[70dvh] min-h-0 flex-col">
        <StickyScroll label="Simulated agent feed">
          {#if !scope.loaded}
            {#each [0, 1, 2] as i (i)}
              <div class="bg-muted/60 h-10 animate-pulse rounded-lg"></div>
            {/each}
          {:else if feed.messages.length === 0 && !feed.draft}
            <Empty text={live ? "Waiting for the first cycle" : "This run has no agent messages"} />
          {/if}
          {#if scope.loaded}
            <Transcript messages={feed.messages} draft={feed.draft} calls={feed.calls} running={live} />
          {/if}
        </StickyScroll>
        <AgentsLane />
      </div>
    {:else if section === "fills"}
      {#if run.fills.length === 0}
        <Empty text="No fills yet" />
      {:else}
        <Table.Root class="text-[12.5px]">
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class="text-muted-foreground h-8 px-3.5 text-[11.5px]">Day</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-[11.5px]">Side</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-[11.5px]">Symbol</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-right text-[11.5px]">Qty</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-right text-[11.5px] max-sm:pr-3.5">Price</Table.Head>
              <Table.Head class="text-muted-foreground hidden h-8 pr-3.5 text-right text-[11.5px] sm:table-cell">Value</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each run.fills.toReversed() as f (f.orderId + f.at)}
              <Table.Row>
                <Table.Cell class="num text-muted-foreground px-3.5 py-2">{isoShort(f.date)}</Table.Cell>
                <Table.Cell class="py-2"><SideBadge side={f.side} /></Table.Cell>
                <Table.Cell class="py-2"><Ticker symbol={f.symbol} /></Table.Cell>
                <Table.Cell class="num py-2 text-right">{qty(f.quantity)}</Table.Cell>
                <Table.Cell class="num py-2 text-right max-sm:pr-3.5">{usd(f.price)}</Table.Cell>
                <Table.Cell class="num hidden py-2 pr-3.5 text-right sm:table-cell">{usd(f.quantity * f.price)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    {:else if section === "positions"}
      {#if run.positions.length === 0}
        <Empty text="Flat. No open positions" />
      {:else}
        <Table.Root class="text-[12.5px]">
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class="text-muted-foreground h-8 px-3.5 text-[11.5px]">Symbol</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-right text-[11.5px]">Qty</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-right text-[11.5px]">Avg cost</Table.Head>
              <Table.Head class="text-muted-foreground h-8 text-right text-[11.5px]">Value</Table.Head>
              <Table.Head class="text-muted-foreground h-8 pr-3.5 text-right text-[11.5px]">P&amp;L</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each run.positions as p (p.symbol)}
              <Table.Row>
                <Table.Cell class="px-3.5 py-2"><Ticker symbol={p.symbol} /></Table.Cell>
                <Table.Cell class="num py-2 text-right">{qty(p.quantity)}</Table.Cell>
                <Table.Cell class="num py-2 text-right">{usd(p.averageCost)}</Table.Cell>
                <Table.Cell class="num py-2 text-right">{usd(p.marketValue)}</Table.Cell>
                <Table.Cell class="py-2 pr-3.5 text-right"><Pnl amount={p.unrealizedPnl} /></Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    {:else if section === "journal"}
      <div class="max-h-[34rem] overflow-y-auto"><Journal /></div>
    {:else}
      <div class="max-h-[34rem] overflow-y-auto"><OrdersList /></div>
    {/if}
  </section>
</div>
