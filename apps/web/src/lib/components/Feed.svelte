<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import AgentsLane from "./AgentsLane.svelte";
  import Composer from "./Composer.svelte";
  import Empty from "./Empty.svelte";
  import StickyScroll from "./StickyScroll.svelte";
  import Transcript from "./Transcript.svelte";
  import { harness } from "$lib/store.svelte";
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Agent feed">
  <StickyScroll label="Agent feed">
    {#if !harness.loaded}
      {#each [0, 1, 2] as i (i)}
        <div class="bg-muted/60 h-10 animate-pulse rounded-lg"></div>
      {/each}
    {:else if harness.loadError && harness.messages.length === 0}
      <Empty text={`Could not load the feed: ${harness.loadError}`}>
        <Button size="sm" variant="outline" onclick={() => harness.refresh()}>Retry</Button>
      </Empty>
    {:else if harness.messages.length === 0 && !harness.draft && harness.outbox.length === 0}
      <Empty text="No messages yet. Run a cycle or say something." />
    {/if}
    {#if harness.loaded}
      <Transcript messages={harness.messages} draft={harness.draft} running={harness.running} outbox={harness.outbox} />
    {/if}
  </StickyScroll>
  <AgentsLane />
  <Composer />
</section>
