<script lang="ts">
  import type { JournalAction } from "@rh/shared";
  import { cn } from "$lib/utils.js";
  let { action }: { action: JournalAction } = $props();
</script>

<span
  class={cn(
    "inline-flex h-5 w-12 shrink-0 items-center justify-center rounded text-[10.5px] font-semibold tracking-wider uppercase",
    action === "buy" && "bg-gain/15 text-gain",
    action === "sell" && "bg-loss/15 text-loss",
    action !== "buy" && action !== "sell" && "bg-muted text-muted-foreground",
  )}
>
  {action}
</span>
