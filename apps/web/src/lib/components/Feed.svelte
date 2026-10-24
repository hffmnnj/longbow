<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import Composer from "./Composer.svelte";
  import CycleDivider from "./CycleDivider.svelte";
  import Empty from "./Empty.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import ToolGroup from "./ToolGroup.svelte";
  import { ArrowDown01Icon, Loading03Icon } from "$lib/icons";
  import { etTime } from "$lib/format";
  import { harness } from "$lib/store.svelte";

  type Item =
    | { kind: "cycle" | "user" | "assistant"; key: string; message: ChatMessage }
    | { kind: "tools"; key: string; messages: ChatMessage[] };

  const items = $derived.by(() => {
    const out: Item[] = [];
    for (const m of harness.messages) {
      if (m.role === "tool") {
        const last = out[out.length - 1];
        if (last?.kind === "tools") last.messages.push(m);
        else out.push({ kind: "tools", key: m.id, messages: [m] });
      } else {
        out.push({ kind: m.role, key: m.id, message: m });
      }
    }
    return out;
  });

  let scroller = $state<HTMLDivElement | null>(null);
  let stick = $state(true);

  function onscroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  function toBottom(smooth = false) {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  $effect(() => {
    // Track the things that grow the transcript.
    harness.messages.length;
    harness.draft;
    if (stick) queueMicrotask(() => toBottom());
  });
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Agent feed">
  <div class="relative min-h-0 flex-1">
    <div bind:this={scroller} {onscroll} class="h-full overflow-y-auto overscroll-contain" role="log" aria-live="polite" aria-relevant="additions">
      <div class="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4">
        {#if !harness.loaded}
          {#each [0, 1, 2] as i (i)}
            <div class="bg-muted/60 h-10 animate-pulse rounded-lg"></div>
          {/each}
        {:else if harness.loadError && items.length === 0}
          <Empty text={`Could not load the feed: ${harness.loadError}`}>
            <Button size="sm" variant="outline" onclick={() => harness.refresh()}>Retry</Button>
          </Empty>
        {:else if items.length === 0 && !harness.draft}
          <Empty text="No messages yet. Run a cycle or say something." />
        {/if}

        {#each items as item, i (item.key)}
          {#if item.kind === "cycle"}
            <div class="pt-2"><CycleDivider message={item.message} /></div>
          {:else if item.kind === "tools"}
            <ToolGroup messages={item.messages} live={harness.running && i === items.length - 1} />
          {:else if item.kind === "user"}
            <div class="flex flex-col items-end gap-1">
              <div class="bg-accent max-w-[85%] rounded-xl rounded-br-sm px-3.5 py-2 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                {item.message.text}
              </div>
              <span class="num text-muted-foreground text-[11px]">You · {etTime(item.message.at)}</span>
            </div>
          {:else}
            <article class="flex flex-col gap-1">
              <span class="text-muted-foreground text-[11px]">
                Agent · <span class="num">{etTime(item.message.at)}</span>
              </span>
              <div class="text-[14px]"><Markdown text={item.message.text} /></div>
            </article>
          {/if}
        {/each}

        {#if harness.draft}
          <article class="flex flex-col gap-1" aria-label="Agent is writing">
            <span class="text-live flex items-center gap-1.5 text-[11px]">
              <Icon icon={Loading03Icon} class="size-3 animate-spin" /> Agent is writing
            </span>
            <div class="text-[14px]"><Markdown text={harness.draft} /></div>
          </article>
        {:else if harness.running}
          <div class="text-live flex items-center gap-1.5 text-[12px]">
            <Icon icon={Loading03Icon} class="size-3.5 animate-spin" /> Working
          </div>
        {/if}
      </div>
    </div>

    {#if !stick}
      <Button
        size="sm"
        variant="outline"
        class="bg-popover absolute bottom-3 left-1/2 h-8 -translate-x-1/2 rounded-full shadow-md"
        onclick={() => {
          stick = true;
          toBottom(true);
        }}
      >
        <Icon icon={ArrowDown01Icon} class="size-3.5" /> Latest
      </Button>
    {/if}
  </div>
  <Composer />
</section>
