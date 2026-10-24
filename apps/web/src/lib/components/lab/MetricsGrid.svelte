<script lang="ts">
  import type { SimRun } from "@rh/shared";
  import Pnl from "../Pnl.svelte";
  import { metricRows } from "$lib/sim";

  let { run }: { run: SimRun } = $props();

  const rows = $derived(metricRows(run));
</script>

<dl class="bg-border border-border grid shrink-0 grid-cols-3 gap-px overflow-hidden rounded-lg border md:grid-cols-4 xl:grid-cols-6" aria-label="Run metrics">
  {#each rows as r (r.label)}
    <div class="bg-card flex min-w-0 flex-col gap-1 px-3 py-2.5">
      <dt class="text-muted-foreground text-[11.5px]">{r.label}</dt>
      <dd class="num text-[14px] font-medium">
        {#if r.pnl !== undefined}<Pnl percent={r.pnl} />{:else}{r.text}{/if}
      </dd>
    </div>
  {/each}
</dl>
