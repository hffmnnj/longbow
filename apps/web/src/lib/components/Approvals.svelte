<script lang="ts">
  import Empty from "./Empty.svelte";
  import OrderCard from "./OrderCard.svelte";
  import { harness } from "$lib/store.svelte";
  let { showEmpty = false }: { showEmpty?: boolean } = $props();
</script>

{#if harness.pending.length > 0}
  <section class="flex shrink-0 flex-col gap-2" aria-label="Pending approvals">
    <h2 class="label-caps flex items-center gap-2 px-1">
      Pending approval
      <span class="num bg-warn-bg text-warn rounded px-1.5 text-[11px]">{harness.pending.length}</span>
    </h2>
    <div class="flex flex-col gap-2 md:max-h-[40dvh] md:overflow-y-auto md:overscroll-contain">
      {#each harness.pending as order (order.id)}
        <OrderCard {order} />
      {/each}
    </div>
  </section>
{:else if showEmpty}
  <Empty text="Nothing waiting for approval" />
{/if}
