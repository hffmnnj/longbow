<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import Journal from "./Journal.svelte";
  import Notes from "./Notes.svelte";
  import OrdersList from "./OrdersList.svelte";
  import Skills from "./Skills.svelte";
  import { viewport } from "$lib/media.svelte";
  import { cn } from "$lib/utils.js";

  let { class: className = "" }: { class?: string } = $props();
  let tab = $state("journal");
  const sections = [
    { value: "journal", label: "Journal" },
    { value: "orders", label: "Orders" },
    { value: "notes", label: "Notes" },
    { value: "skills", label: "Skills" },
  ];
  const trigger =
    "flex-none px-3 text-[13px] data-[state=active]:text-foreground data-[state=active]:after:opacity-100 after:!bottom-[-1px]";
</script>

{#snippet panel(value: string)}
  {#if value === "journal"}<Journal />
  {:else if value === "orders"}<OrdersList />
  {:else if value === "notes"}<Notes />
  {:else}<Skills />{/if}
{/snippet}

{#if viewport.desktop}
  <Tabs.Root bind:value={tab} class={cn("border-border bg-card flex min-h-0 flex-col gap-0 overflow-hidden rounded-lg border", className)}>
    <Tabs.List variant="line" class="border-border h-10 w-full shrink-0 justify-start rounded-none border-b px-2">
      {#each sections as s (s.value)}<Tabs.Trigger value={s.value} class={trigger}>{s.label}</Tabs.Trigger>{/each}
    </Tabs.List>
    {#each sections as s (s.value)}
      <Tabs.Content value={s.value} class="min-h-0 flex-1 overflow-y-auto">{@render panel(s.value)}</Tabs.Content>
    {/each}
  </Tabs.Root>
{:else}
  <div class={cn("border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border", className)}>
    <div class="border-border shrink-0 border-b p-2">
      <ToggleGroup.Root
        type="single"
        bind:value={() => tab, (v) => v && (tab = v)}
        aria-label="History section"
        class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
      >
        {#each sections as s (s.value)}
          <ToggleGroup.Item
            value={s.value}
            class="text-muted-foreground hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:shadow-sm"
          >
            {s.label}
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">{@render panel(tab)}</div>
  </div>
{/if}
