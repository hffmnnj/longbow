<script lang="ts">
  import type { TrendRow } from "@rh/shared";
  import * as Table from "$lib/components/ui/table/index.js";
  import DitherBar from "./DitherBar.svelte";
  import DitherSpark from "./DitherSpark.svelte";
  import Pnl from "../Pnl.svelte";
  import Ticker from "../Ticker.svelte";
  import { pct, usd } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { rows, relative = false }: {
    rows: TrendRow[];
    /** Show 3-month strength against SPY as a bar, for the sector table. */
    relative?: boolean;
  } = $props();

  const held = $derived(new Set(harness.positions.map((p) => p.symbol)));
  const head = "text-muted-foreground h-8 text-[11.5px]";
  const maxRel = $derived(Math.max(8, ...rows.map((r) => Math.abs(r.relStrength3m ?? 0))));
</script>

<Table.Root class="text-[12.5px]">
  <Table.Header>
    <Table.Row class="hover:bg-transparent">
      <Table.Head class="{head} px-3.5">{relative ? "Sector" : "Index"}</Table.Head>
      <Table.Head class={head}>3M trend</Table.Head>
      <Table.Head class="{head} text-right">Last</Table.Head>
      <Table.Head class="{head} text-right">1D</Table.Head>
      <Table.Head class="{head} hidden text-right sm:table-cell">1M</Table.Head>
      <Table.Head class="{head} hidden text-right sm:table-cell">3M</Table.Head>
      {#if relative}
        <Table.Head class="{head} pr-3.5 text-right">vs SPY, 3M</Table.Head>
      {:else}
        <Table.Head class="{head} pr-3.5 text-right">Trend</Table.Head>
      {/if}
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each rows as r (r.symbol)}
      <Table.Row class={cn(held.has(r.symbol) && "bg-primary/5")}>
        <Table.Cell class="px-3.5 py-1.5">
          <div class="flex flex-col leading-tight">
            <span class="flex items-center gap-1.5">
              <Ticker symbol={r.symbol} />
              {#if held.has(r.symbol)}<span class="bg-primary/15 text-primary rounded px-1 text-[10px] font-semibold tracking-wide uppercase">Held</span>{/if}
            </span>
            {#if r.name}<span class="text-muted-foreground max-w-32 truncate text-[11px]">{r.name}</span>{/if}
          </div>
        </Table.Cell>
        <Table.Cell class="py-1.5"><DitherSpark values={r.spark} label={`${r.symbol} three month trend`} class="h-7 w-20" /></Table.Cell>
        <Table.Cell class="num py-1.5 text-right">{usd(r.last)}</Table.Cell>
        <Table.Cell class="py-1.5 text-right"><Pnl percent={r.changePct1d} /></Table.Cell>
        <Table.Cell class="hidden py-1.5 text-right sm:table-cell"><Pnl percent={r.return1m} /></Table.Cell>
        <Table.Cell class="hidden py-1.5 text-right sm:table-cell"><Pnl percent={r.return3m} /></Table.Cell>
        {#if relative}
          <Table.Cell class="py-1.5 pr-3.5">
            {#if r.relStrength3m !== undefined}
              <div class="ml-auto flex w-36 items-center justify-end gap-2">
                <DitherBar class="w-16 shrink-0" value={Math.abs(r.relStrength3m)} max={maxRel} tone={r.relStrength3m >= 0 ? "gain" : "loss"} label={`${r.symbol} ${r.relStrength3m >= 0 ? "ahead of" : "behind"} SPY by ${pct(Math.abs(r.relStrength3m))} over three months`} />
                <Pnl percent={r.relStrength3m} class="w-14 text-right" />
              </div>
            {:else}<span class="text-muted-foreground">&mdash;</span>{/if}
          </Table.Cell>
        {:else}
          <Table.Cell class="py-1.5 pr-3.5 text-right">
            <span class="text-muted-foreground flex justify-end gap-1.5 text-[11px]">
              <span class={cn(r.aboveSma50 ? "text-gain" : "text-loss")} title={r.aboveSma50 ? "Above its 50 day average" : "Below its 50 day average"}>{r.aboveSma50 ? "▲" : "▼"} 50d</span>
              <span class={cn(r.aboveSma200 ? "text-gain" : "text-loss")} title={r.aboveSma200 ? "Above its 200 day average" : "Below its 200 day average"}>{r.aboveSma200 ? "▲" : "▼"} 200d</span>
            </span>
          </Table.Cell>
        {/if}
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
