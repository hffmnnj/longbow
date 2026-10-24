<script lang="ts">
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";
</script>

<ToggleGroup.Root
  type="single"
  bind:value={() => ui.view, (v) => v && (ui.view = v as "live" | "lab")}
  aria-label="Live account or simulation lab"
  class="bg-muted/60 border-border inline-flex rounded-md border p-0.5"
>
  <ToggleGroup.Item
    value="live"
    class="text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground h-7 min-w-12 rounded-[5px] px-2.5 text-[12.5px] font-medium data-[state=on]:shadow-sm"
  >
    Live
  </ToggleGroup.Item>
  <ToggleGroup.Item
    value="lab"
    class={cn(
      "text-muted-foreground hover:text-foreground h-7 min-w-12 rounded-[5px] px-2.5 text-[12.5px] font-medium",
      "data-[state=on]:bg-lab data-[state=on]:text-background data-[state=on]:shadow-sm",
    )}
  >
    Lab
  </ToggleGroup.Item>
</ToggleGroup.Root>
