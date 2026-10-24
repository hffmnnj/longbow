<script lang="ts">
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import ActionBadge from "./ActionBadge.svelte";
  import Empty from "./Empty.svelte";
  import { etStamp } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { harness } from "$lib/store.svelte";
</script>

{#if !harness.loaded}
  <div class="bg-muted/60 m-3 h-12 animate-pulse rounded"></div>
{:else if harness.journal.length === 0}
  <Empty text="No decisions yet" />
{:else}
  <ul class="divide-border divide-y">
    {#each harness.journal as e (e.id)}
      <li>
        <Collapsible.Root>
          <Collapsible.Trigger
            class="hover:bg-muted/50 group flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors"
          >
            <ActionBadge action={e.action} />
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline gap-2">
                {#if e.symbol}<span class="num font-semibold">{e.symbol}</span>{/if}
                <span class="text-[13px] leading-snug group-data-[state=closed]:line-clamp-2">{e.summary}</span>
              </span>
              <span class="text-muted-foreground num mt-0.5 flex gap-2 text-[11.5px]">
                <span>{etStamp(e.at, clock.now)}</span>
                {#if e.confidence !== undefined}<span>· conf {Math.round(e.confidence * 100)}%</span>{/if}
              </span>
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div class="flex flex-col gap-2 px-3.5 pb-3 pl-[4.5rem] text-[13px]">
              <p class="leading-relaxed whitespace-pre-wrap">{e.rationale}</p>
              {#if e.regime}<p class="text-muted-foreground text-[12px]">Regime: {e.regime}</p>{/if}
              {#if e.evidence.length}
                <ul class="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-[12px]">
                  {#each e.evidence as ev, idx (idx)}<li>{ev}</li>{/each}
                </ul>
              {/if}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </li>
    {/each}
  </ul>
{/if}
