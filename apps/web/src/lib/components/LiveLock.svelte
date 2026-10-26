<script lang="ts">
  import Icon from "./Icon.svelte";
  import { LockIcon, Tick02Icon } from "$lib/icons";
  import { controlState } from "$lib/control";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let { class: className = "" }: { class?: string } = $props();
  const state = $derived(harness.status ? controlState(harness.status) : undefined);
</script>

{#if state}
  <button
    type="button"
    onclick={() => (ui.section = "agent")}
    class={cn(
      "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors",
      state.liveLocked ? "border-border bg-muted/60 text-foreground hover:bg-muted" : "border-warn/50 bg-warn-bg text-warn hover:bg-warn-bg/80",
      className,
    )}
    aria-label={state.liveLocked ? "Live trading locked. Open the agent control room" : "Live trading enabled. Open the agent control room"}
  >
    <Icon icon={state.liveLocked ? LockIcon : Tick02Icon} class="size-3.5" strokeWidth={2.2} />
    {state.liveLocked ? "Live trading locked" : "Live trading on"}
  </button>
{/if}
