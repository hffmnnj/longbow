<script lang="ts">
  import { ditherRampSvg } from "$lib/analytics";
  import { cn } from "$lib/utils.js";

  let { value, max = 100, tone = "primary", marker, class: className = "", label }: {
    value: number;
    max?: number;
    tone?: "primary" | "gain" | "loss" | "warn" | "lab" | "muted";
    /** A tick on the track, in the same units as `value` (for a cap or a limit). */
    marker?: number;
    class?: string;
    label: string;
  } = $props();

  const ramp = `url("data:image/svg+xml,${encodeURIComponent(ditherRampSvg(10, 2, "#000"))}")`;
  const fill = $derived(Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0)));
  const bg = { primary: "bg-primary", gain: "bg-gain", loss: "bg-loss", warn: "bg-warn", lab: "bg-lab", muted: "bg-muted-foreground" };
</script>

<div class={cn("bg-muted/70 relative overflow-hidden rounded-[3px]", className)} style:height={className.match(/(^|\s)h-/) ? undefined : "10px"} role="img" aria-label={label}>
  <div class="absolute inset-y-0 left-0 flex" style:width="{fill}%">
    <div class={cn("min-w-0 flex-1", bg[tone])}></div>
    {#if fill > 6}
      <div class={cn("w-5 shrink-0", bg[tone])} style:mask-image={ramp} style:-webkit-mask-image={ramp} style:mask-size="20px 8px" style:-webkit-mask-size="20px 8px"></div>
    {/if}
  </div>
  {#if marker !== undefined && max > 0}
    <div class="bg-foreground absolute inset-y-0 w-0.5" style:left="calc({Math.min(100, (marker / max) * 100)}% - 1px)"></div>
  {/if}
</div>
