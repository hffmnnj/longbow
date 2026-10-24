<script lang="ts">
  import DecisionCard from "./DecisionCard.svelte";
  import Empty from "./Empty.svelte";
  import { useScope } from "$lib/scope";
  const scope = useScope();
  const orders = $derived(new Map(scope.feed.orders.map((o) => [o.id, o])));
</script>

{#if !scope.loaded}
  <div class="bg-muted/60 m-3 h-12 animate-pulse rounded"></div>
{:else if scope.feed.journal.length === 0}
  <Empty text="No decisions yet" />
{:else}
  <ul class="flex flex-col gap-2 p-2.5">
    {#each scope.feed.journal as e (e.id)}
      <li><DecisionCard entry={e} order={e.orderId ? orders.get(e.orderId) : undefined} linkable={scope.simRunId === undefined} /></li>
    {/each}
  </ul>
{/if}
