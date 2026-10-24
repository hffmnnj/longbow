<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import Journal from "./Journal.svelte";
  import OrdersList from "./OrdersList.svelte";
  import { cn } from "$lib/utils.js";

  let { class: className = "" }: { class?: string } = $props();
  let tab = $state("journal");
  const trigger =
    "flex-none px-3 text-[13px] data-[state=active]:text-foreground data-[state=active]:after:opacity-100 after:!bottom-[-1px]";
</script>

<Tabs.Root bind:value={tab} class={cn("border-border bg-card flex min-h-0 flex-col gap-0 overflow-hidden rounded-lg border", className)}>
  <Tabs.List variant="line" class="border-border h-10 w-full shrink-0 justify-start rounded-none border-b px-2">
    <Tabs.Trigger value="journal" class={trigger}>Journal</Tabs.Trigger>
    <Tabs.Trigger value="orders" class={trigger}>Orders</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="journal" class="min-h-0 flex-1 overflow-y-auto"><Journal /></Tabs.Content>
  <Tabs.Content value="orders" class="min-h-0 flex-1 overflow-y-auto"><OrdersList /></Tabs.Content>
</Tabs.Root>
