<script lang="ts">
  import type { ReportGrade } from "@rh/shared";
  import { cn } from "$lib/utils.js";

  let { grade, large = false, reason }: { grade: ReportGrade; large?: boolean; reason?: string } = $props();
</script>

<span
  class={cn(
    "num border-border bg-secondary text-foreground inline-flex shrink-0 items-center justify-center rounded-md border font-bold",
    large ? "size-11 text-[21px]" : "size-6 text-[12px]",
  )}
  role="img"
  aria-label={reason ? `Grade ${grade}: ${reason}` : `Grade ${grade}`}
  title={reason}
>
  {grade}
</span>
