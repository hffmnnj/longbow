<script lang="ts">
  import type { TradingMode } from "@rh/shared";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { class: className = "", block = false }: { class?: string; block?: boolean } = $props();

  const modes: { value: TradingMode; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "approve", label: "Approve" },
    { value: "auto", label: "Auto" },
  ];

  const current = $derived(harness.status?.settings.mode ?? "off");
  let confirmAuto = $state(false);

  function change(next: string) {
    if (!next || next === current) return;
    if (next === "auto") confirmAuto = true;
    else void harness.quickPatch("mode", { mode: next as TradingMode });
  }
</script>

<ToggleGroup.Root
  type="single"
  bind:value={() => current, change}
  disabled={!harness.status}
  aria-label="Trading mode"
  class={cn("bg-muted/60 border-border inline-flex rounded-md border p-0.5", block && "w-full", className)}
>
  {#each modes as m (m.value)}
    <ToggleGroup.Item
      value={m.value}
      class={cn(
        "text-muted-foreground h-8 min-w-12 flex-1 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors md:h-7",
        "hover:text-foreground data-[state=on]:shadow-sm",
        m.value === "off" && "data-[state=on]:bg-secondary data-[state=on]:text-foreground",
        m.value === "approve" && "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
        m.value === "auto" && "data-[state=on]:bg-warn data-[state=on]:text-background",
      )}
    >
      {m.label}
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

<ConfirmDialog
  bind:open={confirmAuto}
  title="Switch to Auto?"
  description="Risk-approved orders will be placed on Robinhood immediately, without waiting for you. The kill switch still blocks everything."
  confirmLabel="Enable Auto"
  onconfirm={() => harness.quickPatch("mode", { mode: "auto" }, "Auto mode on")}
/>
