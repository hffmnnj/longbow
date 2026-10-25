<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import ReportView from "./ReportView.svelte";
  import { viewport } from "$lib/media.svelte";
  import { ui } from "$lib/ui.svelte";
</script>

{#if !viewport.desktop && ui.report}
  <Sheet.Root open={true} onOpenChange={(o) => !o && (ui.report = null)}>
    <Sheet.Content side="bottom" class="flex h-[94dvh] flex-col gap-0 rounded-t-xl p-0">
      <Sheet.Header class="sr-only">
        <Sheet.Title>Report</Sheet.Title>
        <Sheet.Description>One-page brief</Sheet.Description>
      </Sheet.Header>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-4">
        <ReportView id={ui.report} onback={() => (ui.report = null)} />
      </div>
    </Sheet.Content>
  </Sheet.Root>
{/if}
