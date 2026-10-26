<script lang="ts">
  import type { SystemOneGate } from "@rh/shared";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { etTime } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import {
    systemOneCooldownUntil,
    systemOneLabel,
    systemOneStatsLine,
    systemOneTone,
    type SystemOneTone,
  } from "$lib/systemOne";
  import { cn } from "$lib/utils.js";

  const settings = $derived(harness.status?.settings.systemOne);
  const info = $derived(harness.status?.systemOne);
  const state = $derived(info?.state ?? "unconfigured");
  const tone = $derived(systemOneTone(state));
  const cooldown = $derived(info ? systemOneCooldownUntil(info) : undefined);

  const dot: Record<SystemOneTone, string> = {
    ok: "bg-live",
    warn: "bg-warn",
    bad: "bg-destructive",
    muted: "bg-muted-foreground/60",
  };

  const gates: { value: SystemOneGate; label: string; title?: string }[] = [
    { value: "off", label: "Off" },
    { value: "advise", label: "Advise" },
    {
      value: "block",
      label: "Block",
      title: "Block rejects an entry when System One reports a high-confidence concern. Exits are never reviewed.",
    },
  ];

  const current = $derived(settings?.gate ?? "advise");
  const enabled = $derived(settings?.enabled ?? false);

  function change(next: string) {
    if (!next || next === current) return;
    void harness.quickPatch("sysone-gate", { systemOne: { gate: next as SystemOneGate } });
  }
</script>

<div class="flex flex-col gap-1.5">
  <h3 class="label-caps">System One</h3>
  <div class="flex min-h-11 items-center gap-2">
    <span class={cn("size-1.5 shrink-0 rounded-full", dot[tone])} aria-hidden="true"></span>
    <span class="text-[13px] font-medium">{systemOneLabel(state)}</span>
    {#if info}
      <span class="num text-muted-foreground min-w-0 flex-1 truncate text-[12px]">{info.model}</span>
    {/if}
    <Switch
      aria-label="System One enabled"
      checked={enabled}
      disabled={!harness.status || harness.busy["sysone"]}
      onCheckedChange={(v) => void harness.quickPatch("sysone", { systemOne: { enabled: v } })}
    />
  </div>
  {#if info}
    <p class="num text-muted-foreground text-[12px]">{systemOneStatsLine(info)}</p>
  {/if}
  {#if cooldown !== undefined}
    <p class="text-muted-foreground text-[12px]">Cooldown until {etTime(cooldown)}</p>
  {/if}
  {#if info?.lastError}
    <p class="text-muted-foreground truncate text-[12px]" title={info.lastError}>{info.lastError}</p>
  {/if}
  <ToggleGroup.Root
    type="single"
    bind:value={() => current, change}
    disabled={!harness.status || !enabled}
    aria-label="System One gate"
    class="bg-muted/60 border-border inline-flex rounded-md border p-0.5 sm:max-w-sm"
  >
    {#each gates as g (g.value)}
      <ToggleGroup.Item
        value={g.value}
        title={g.title}
        class={cn(
          "text-muted-foreground h-11 min-w-12 flex-1 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors md:h-7",
          "hover:text-foreground data-[state=on]:shadow-sm",
          g.value === "off" && "data-[state=on]:bg-secondary data-[state=on]:text-foreground",
          g.value === "advise" && "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
          g.value === "block" && "data-[state=on]:bg-warn data-[state=on]:text-background",
        )}
      >
        {g.label}
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>
