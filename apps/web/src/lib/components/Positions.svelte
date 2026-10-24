<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Empty from "./Empty.svelte";
  import Pnl from "./Pnl.svelte";
  import { pct, qty, usd } from "$lib/format";
  import { harness } from "$lib/store.svelte";

  const equity = $derived(harness.status?.account?.equity ?? 0);
  const connected = $derived(harness.status?.broker.state === "connected");
  const rows = $derived([...harness.positions].sort((a, b) => b.marketValue - a.marketValue));
</script>

<section class="border-border bg-card shrink-0 overflow-hidden rounded-lg border" aria-label="Positions">
  <h2 class="label-caps border-border border-b px-3.5 py-2">Positions</h2>
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
          <Table.Head class="text-muted-foreground h-8 px-3.5 text-[11.5px]">Symbol</Table.Head>
          <Table.Head class="text-muted-foreground h-8 text-[11.5px] text-right">Qty</Table.Head>
          <Table.Head class="text-muted-foreground hidden h-8 text-[11.5px] text-right sm:table-cell">Avg cost</Table.Head>
          <Table.Head class="text-muted-foreground h-8 text-[11.5px] text-right">Value</Table.Head>
          <Table.Head class="text-muted-foreground h-8 text-[11.5px] text-right">P&amp;L</Table.Head>
          <Table.Head class="text-muted-foreground h-8 text-[11.5px] pr-3.5 text-right">Share</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as p (p.symbol)}
          <Table.Row>
            <Table.Cell class="num px-3.5 py-2 font-semibold">{p.symbol}</Table.Cell>
            <Table.Cell class="num py-2 text-right">{qty(p.quantity)}</Table.Cell>
            <Table.Cell class="num hidden py-2 text-right sm:table-cell">{usd(p.averageCost)}</Table.Cell>
            <Table.Cell class="num py-2 text-right">{usd(p.marketValue)}</Table.Cell>
            <Table.Cell class="py-2 text-right"><Pnl amount={p.unrealizedPnl} /></Table.Cell>
            <Table.Cell class="num text-muted-foreground py-2 pr-3.5 text-right">
              {equity > 0 ? pct((p.marketValue / equity) * 100) : "\u2014"}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/if}
</section>
