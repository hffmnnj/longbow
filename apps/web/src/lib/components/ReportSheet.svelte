<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import ReportView from "./ReportView.svelte";
  import { viewport } from "$lib/media.svelte";
  import { ui } from "$lib/ui.svelte";

  /** The scrollable sheet body, pinned to the top whenever a report opens. */
  let scroller = $state<HTMLDivElement | null>(null);
  let content = $state<HTMLDivElement | null>(null);

  // The dialog moves initial focus into the brief on open; on mobile browsers
  // that focus jump can drag this scroller to the bottom of a freshly mounted
  // tall report, so auto-focus stays prevented (like the other sheets) and the
  // sheet opens pinned to the masthead with focus on the close button.
  // The sheet height must be capped with max-h, not h: bits-ui's own
  // data-[side=bottom]:h-auto rule outranks a plain h-[94dvh] class, so the
  // sheet used to grow past the viewport (bottom-anchored, masthead cut off)
  // and this inner div never became the scroller.
  $effect(() => {
    if (ui.report === null || !scroller) return;
    scroller.scrollTop = 0;
    content?.querySelector<HTMLElement>('[data-slot="sheet-close"]')?.focus({ preventScroll: true });
  });
</script>

{#if !viewport.desktop && ui.report}
  <Sheet.Root open={true} onOpenChange={(o) => !o && (ui.report = null)}>
    <Sheet.Content
      bind:ref={content}
      side="bottom"
      class="flex max-h-[94dvh] flex-col gap-0 rounded-t-xl p-0"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <Sheet.Header class="sr-only">
        <Sheet.Title>Report</Sheet.Title>
        <Sheet.Description>One-page brief</Sheet.Description>
      </Sheet.Header>
      <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-4">
        <ReportView id={ui.report} onback={() => (ui.report = null)} />
      </div>
    </Sheet.Content>
  </Sheet.Root>
{/if}
