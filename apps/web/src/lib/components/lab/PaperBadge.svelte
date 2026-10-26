<script lang="ts">
  import { cn } from "$lib/utils.js";

  let { class: className = "" }: { class?: string } = $props();
</script>

<span
  class={cn(
    "border-lab/40 bg-lab/12 text-lab inline-flex h-5 items-center rounded px-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase",
    className,
  )}
>
  Paper
</span>
