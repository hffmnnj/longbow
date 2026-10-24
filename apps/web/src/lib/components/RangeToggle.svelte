<script lang="ts">
  import { HistoryRangeSchema, type HistoryRange } from "@rh/shared";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";

  let { value = $bindable("6m") }: { value?: HistoryRange } = $props();
  const ranges = HistoryRangeSchema.options;
</script>

<ToggleGroup.Root
  type="single"
  bind:value={() => value, (v) => v && (value = v as HistoryRange)}
  aria-label="Chart range"
  class="bg-muted/60 border-border inline-flex rounded-md border p-0.5"
>
  {#each ranges as r (r)}
    <ToggleGroup.Item
      value={r}
      class="num text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground h-8 min-w-9 flex-1 rounded-[5px] px-2 text-[12px] font-medium uppercase data-[state=on]:shadow-sm md:h-7"
    >
      {r}
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>
