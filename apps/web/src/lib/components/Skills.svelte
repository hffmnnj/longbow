<script lang="ts">
  import Empty from "./Empty.svelte";
  import { harness } from "$lib/store.svelte";
  import { openSkill } from "$lib/ui.svelte";
</script>

{#if !harness.loaded}
  <div class="bg-muted/60 m-3 h-12 animate-pulse rounded"></div>
{:else if harness.skills.length === 0}
  <Empty text="No skills installed" />
{:else}
  <ul class="divide-border divide-y">
    {#each harness.skills as s (s.name)}
      <li>
        <button
          type="button"
          class="hover:bg-muted/50 flex min-h-12 w-full flex-col gap-0.5 px-3.5 py-2.5 text-left transition-colors"
          onclick={() => openSkill(s.name)}
        >
          <span class="num text-[13px] font-semibold">{s.name}</span>
          <span class="text-muted-foreground line-clamp-2 text-[12.5px] leading-snug">{s.description}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
