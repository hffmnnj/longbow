<script lang="ts">
  import { cn } from "$lib/utils.js";
  let { side }: { side: "buy" | "sell" } = $props();
</script>

<span
  class={cn(
    "inline-flex h-5 items-center rounded px-1.5 text-[10.5px] font-semibold tracking-wider uppercase",
    side === "buy" ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss",
  )}
>
  {side}
</span>
