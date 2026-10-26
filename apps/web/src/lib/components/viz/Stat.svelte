<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.js";

  let { label, value, sub, tone = "flat", class: className = "", children }: {
    label: string;
    value?: string;
    sub?: string;
    tone?: "gain" | "loss" | "flat";
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class={cn("flex min-w-0 flex-col gap-0.5", className)}>
  <dt class="label-caps">{label}</dt>
  <dd class={cn("num truncate text-[17px] leading-tight font-semibold", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>
    {#if children}{@render children()}{:else}{value ?? "\u2014"}{/if}
  </dd>
  {#if sub}<dd class="num text-muted-foreground truncate text-[11.5px]">{sub}</dd>{/if}
</div>
