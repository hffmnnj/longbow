<script lang="ts">
  import Icon from "./Icon.svelte";
  import { DESKTOP_NAV } from "$lib/nav";
  import type { Section } from "$lib/ui.svelte";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";
  import { runSectionTransition } from "$lib/native";
  import { haptic } from "$lib/pwa.svelte";
  import { cn } from "$lib/utils.js";

  const items = DESKTOP_NAV;

  function select(next: Section) {
    if (ui.section === next) return;
    haptic("selection");
    runSectionTransition(() => {
      ui.section = next;
    });
  }
</script>

<nav aria-label="Sections" class="flex items-center gap-0.5">
  {#each items as item (item.value)}
    {@const active = ui.section === item.value}
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onclick={() => select(item.value)}
      class={cn(
        "text-muted-foreground hover:text-foreground relative flex h-10 items-center gap-1.5 rounded-md px-3 text-[13.5px] font-medium transition-colors",
        "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-current after:opacity-0 after:transition-opacity",
        active && "text-foreground after:opacity-100",
        item.value === "lab" && (active ? "text-lab" : "hover:text-lab"),
      )}
    >
      <Icon icon={item.icon} class="size-4" />
      {item.label}
      {#if item.value === "feed" && harness.pending.length > 0}
        <span class="num bg-warn text-background grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold">{harness.pending.length}</span>
      {/if}
    </button>
  {/each}
</nav>
