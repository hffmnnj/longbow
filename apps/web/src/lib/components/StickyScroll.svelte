<script lang="ts">
  import type { Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import { ArrowDown01Icon } from "$lib/icons";
  import { cn } from "$lib/utils.js";

  let { children, class: className = "", label = "Feed" }: { children: Snippet; class?: string; label?: string } = $props();

  let scroller = $state<HTMLDivElement | null>(null);
  let content = $state<HTMLDivElement | null>(null);
  let stick = $state(true);
  let unread = $state(false);
  let lastHeight = 0;

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function toBottom(smooth = false) {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reduced() ? "smooth" : "auto" });
  }

  function onscroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (stick) unread = false;
  }

  $effect(() => {
    if (!content) return;
    const ro = new ResizeObserver(() => {
      const h = content!.offsetHeight;
      const grew = h > lastHeight && lastHeight > 0;
      lastHeight = h;
      if (stick) toBottom();
      else if (grew) unread = true;
    });
    ro.observe(content);
    // A shrinking viewport (the agents lane appearing) must keep the bottom pinned too.
    if (scroller) ro.observe(scroller);
    toBottom();
    return () => ro.disconnect();
  });
</script>

<div class="relative min-h-0 flex-1">
  <div bind:this={scroller} {onscroll} class="h-full overflow-y-auto overscroll-contain" role="log" aria-live="polite" aria-relevant="additions" aria-label={label}>
    <div bind:this={content} class={cn("mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4", className)}>
      {@render children()}
    </div>
  </div>
  {#if !stick}
    <Button
      size="sm"
      variant="outline"
      class="bg-popover absolute bottom-3 left-1/2 h-8 -translate-x-1/2 rounded-full shadow-md"
      onclick={() => {
        stick = true;
        unread = false;
        toBottom(true);
      }}
    >
      {#if unread}<span class="bg-live size-1.5 rounded-full" aria-hidden="true"></span>New activity{:else}Latest{/if}
      <Icon icon={ArrowDown01Icon} class="size-3.5" />
    </Button>
  {/if}
</div>
