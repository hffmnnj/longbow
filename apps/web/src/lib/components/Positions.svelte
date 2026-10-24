<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import DitherBar from "./viz/DitherBar.svelte";
  import Panel from "./viz/Panel.svelte";
  import Empty from "./Empty.svelte";
  import Pnl from "./Pnl.svelte";
  import Sparkline from "./Sparkline.svelte";
  import Ticker from "./Ticker.svelte";
  import { positionStops } from "$lib/analytics";
  import { pct, qty, usd } from "$lib/format";
  import { harness } from "$lib/store.svelte";

  let { compact = false }: { compact?: boolean } = $props();

  $effect(() => {
    if (harness.loaded) void harness.loadPerformance();
  });

  const equity = $derived(harness.status?.account?.equity ?? 0);
  const connected = $derived(harness.status?.broker.state === "connected");
  const exposure = $derived(harness.performance.data?.exposure ?? []);
  const rows = $derived(positionStops(harness.positions, exposure, equity));
  const stopTone = (d: number) => (d < 3 ? "loss" : d < 6 ? "warn" : "muted");
  const head = "text-muted-foreground h-8 text-[11.5px]";
</script>

<Panel title="Positions" reading={rows.length ? `${rows.length} held, ${pct((rows.reduce((a, r) => a + r.position.marketValue, 0) / (equity || 1)) * 100)} of equity invested` : undefined}>
  {#if !harness.status}
    <div class="bg-muted/60 m-3 h-16 animate-pulse rounded"></div>
  {:else if !connected && rows.length === 0}
    <Empty text="Robinhood not connected">
      <Button size="sm" onclick={() => harness.connectRobinhood()}>Connect Robinhood</Button>
    </Empty>
  {:else if rows.length === 0}
    <Empty text="No positions" />
  {:else}
    <Table.Root class="text-[12.5px]">
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class="{head} px-3.5">Symbol</Table.Head>
          <Table.Head class="{head} text-right">Qty</Table.Head>
          <Table.Head class={head}>1M</Table.Head>
          <Table.Head class="{head} text-right">Value</Table.Head>
          <Table.Head class="{head} text-right">P&amp;L</Table.Head>
          <Table.Head class="{head} hidden text-right sm:table-cell">Share</Table.Head>
          <Table.Head class="{head} pr-3.5 text-right">To stop</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as r (r.position.symbol)}
          {@const p = r.position}
          <Table.Row>
            <Table.Cell class="px-3.5 py-1"><Ticker symbol={p.symbol} /></Table.Cell>
            <Table.Cell class="num py-2 text-right">{qty(p.quantity)}</Table.Cell>
            <Table.Cell class="py-2"><Sparkline symbol={p.symbol} /></Table.Cell>
            <Table.Cell class="num py-2 text-right">{usd(p.marketValue)}</Table.Cell>
            <Table.Cell class="py-2 text-right"><Pnl amount={p.unrealizedPnl} /></Table.Cell>
            <Table.Cell class="num text-muted-foreground hidden py-2 text-right sm:table-cell">
              {r.weightPct !== undefined ? pct(r.weightPct) : "\u2014"}
            </Table.Cell>
            <Table.Cell class="py-2 pr-3.5">
              {#if r.distancePct !== undefined && r.stopPrice !== undefined}
                <div class="ml-auto flex w-24 flex-col items-end gap-1">
                  <span class="num text-[12px]">{pct(r.distancePct)}</span>
                  <DitherBar
                    class="h-1.5 w-full"
                    value={Math.max(0, r.distancePct)}
                    max={15}
                    tone={stopTone(r.distancePct)}
                    label={`${p.symbol} is ${pct(r.distancePct)} above its stop at ${usd(r.stopPrice)}`}
                  />
                  {#if !compact}<span class="num text-muted-foreground text-[11px]">stop {usd(r.stopPrice)}</span>{/if}
                </div>
              {:else}
                <span class="text-muted-foreground block text-right text-[12px]">No stop</span>
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}
</Panel>
