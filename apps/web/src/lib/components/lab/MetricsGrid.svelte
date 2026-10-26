<script lang="ts">
  import type { SimRun } from "@rh/shared";
  import Pnl from "../Pnl.svelte";
  import { metricGroups } from "$lib/sim";
  import { cn } from "$lib/utils.js";

  let { run }: { run: SimRun } = $props();

  const groups = $derived(metricGroups(run));
  const maxBlock = $derived(Math.max(0, ...groups.flatMap((g) => g.rows.flatMap((r) => (r.bars ?? []).map((b) => b.value)))));
</script>

{#if groups.length === 0}
  <p class="text-muted-foreground border-border bg-card rounded-lg border px-3 py-4 text-center text-[13px]">No metrics yet. They appear after the first close.</p>
{:else}
  <div class="flex flex-col gap-4">
    {#each groups as g (g.title)}
      <section aria-label={g.title}>
        <h3 class="label-caps pb-1.5">{g.title}</h3>
        <dl class="bg-border border-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-3 md:grid-cols-4" aria-label={g.title}>
          {#each g.rows as r (r.label)}
            <div class="bg-card flex min-w-0 flex-col gap-1 px-3 py-2.5">
              <dt class="text-muted-foreground text-[11.5px]">{r.label}</dt>
              {#if r.bars}
                <dd class="flex min-w-0 flex-col gap-1 pt-0.5" aria-label={`${r.label}: ${r.bars.map((b) => `${b.label} ${b.value}`).join(", ")}`}>
                  {#each r.bars.slice(0, 4) as b (b.label)}
                    <span class="flex items-center gap-1.5">
                      <span class="text-muted-foreground w-20 shrink-0 truncate font-mono text-[10.5px]">{b.label}</span>
                      <span class="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                        <span class={cn("bg-lab block h-full rounded-full")} style:width={`${maxBlock > 0 ? Math.max(6, (b.value / maxBlock) * 100) : 0}%`}></span>
                      </span>
                      <span class="num text-[11px] font-medium">{b.value}</span>
                    </span>
                  {/each}
                </dd>
              {:else}
                <dd class="num min-w-0 truncate text-[15px] font-medium">
                  {#if r.pnl !== undefined}<Pnl percent={r.pnl} />{:else}{r.text}{/if}
                </dd>
                {#if r.sub}<dd class="num text-muted-foreground -mt-0.5 truncate text-[11px]">{r.sub}</dd>{/if}
              {/if}
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
{/if}
