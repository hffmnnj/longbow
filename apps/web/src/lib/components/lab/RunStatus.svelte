<script lang="ts">
  import type { SimRunStatus } from "@rh/shared";
  import Icon from "../Icon.svelte";
  import { AlertCircleIcon, Tick02Icon } from "$lib/icons";
  import { statusLabel } from "$lib/sim";
  import { cn } from "$lib/utils.js";

  let { status, class: className = "" }: { status: SimRunStatus; class?: string } = $props();
</script>

<span class={cn("flex items-center gap-1.5 text-[12px] whitespace-nowrap", status === "failed" ? "text-destructive" : "text-muted-foreground", className)}>
  {#if status === "running"}
    <span class="bg-lab soft-pulse size-1.5 rounded-full" aria-hidden="true"></span>
  {:else if status === "queued"}
    <span class="border-muted-foreground size-1.5 rounded-full border" aria-hidden="true"></span>
  {:else if status === "failed"}
    <Icon icon={AlertCircleIcon} class="size-3.5" />
  {:else if status === "done"}
    <Icon icon={Tick02Icon} class="size-3.5" />
  {:else}
    <span class="bg-muted-foreground size-1.5 rounded-[1px]" aria-hidden="true"></span>
  {/if}
  {statusLabel[status]}
</span>
