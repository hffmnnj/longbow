<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import Approvals from "$lib/components/Approvals.svelte";
  import Feed from "$lib/components/Feed.svelte";
  import HaltBanner from "$lib/components/HaltBanner.svelte";
  import HistoryTabs from "$lib/components/HistoryTabs.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Positions from "$lib/components/Positions.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import LabView from "$lib/components/lab/LabView.svelte";
  import NewSimSheet from "$lib/components/lab/NewSimSheet.svelte";
  import AgentSheet from "$lib/components/AgentSheet.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import DocSheet from "$lib/components/DocSheet.svelte";
  import SettingsSheet from "$lib/components/SettingsSheet.svelte";
  import SymbolSheet from "$lib/components/SymbolSheet.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import { Message01Icon, Briefcase01Icon, FlashIcon, Notebook01Icon, FlaskConicalIcon } from "$lib/icons";
  import { startClock } from "$lib/clock.svelte";
  import { viewport, watchViewport } from "$lib/media.svelte";
  import { haptic, registerServiceWorker, setBadge } from "$lib/pwa.svelte";
  import { ago } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";
  import { clock } from "$lib/clock.svelte";
  import { CloudOffIcon } from "$lib/icons";
  import { cn } from "$lib/utils.js";

  let tab = $state("feed");

  onMount(() => {
    const stopClock = startClock();
    const stopViewport = watchViewport();
    void harness.start();
    registerServiceWorker();

    const url = new URL(window.location.href);
    const result = url.searchParams.get("robinhood");
    if (result) {
      if (result === "connected") toast.success("Robinhood connected");
      else toast.error("Robinhood sign-in failed", { description: "Try connecting again." });
      url.searchParams.delete("robinhood");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }

    const view = url.searchParams.get("view");
    if (view === "lab" || view === "live") ui.view = view;
    if (url.searchParams.get("action") === "kill") ui.confirmKill = true;
    for (const key of ["view", "action"]) url.searchParams.delete(key);
    if (view || ui.confirmKill) history.replaceState(history.state, "", url.pathname + url.search + url.hash);

    return () => {
      stopClock();
      stopViewport();
      harness.stop();
    };
  });

  $effect(() => {
    if (harness.loaded) setBadge(harness.alerts);
  });

  const lab = $derived(ui.view === "lab");

  const tabs = [
    { value: "feed", label: "Feed", icon: Message01Icon },
    { value: "approvals", label: "Approvals", icon: FlashIcon },
    { value: "positions", label: "Positions", icon: Briefcase01Icon },
    { value: "journal", label: "Journal", icon: Notebook01Icon },
    { value: "lab", label: "Lab", icon: FlaskConicalIcon },
  ];
</script>

<svelte:head><title>{harness.pending.length ? `(${harness.pending.length}) ` : ""}Harness</title></svelte:head>

<svelte:window
  onkeydown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      ui.palette = !ui.palette;
    }
  }}
/>

<div class="flex h-dvh flex-col overflow-hidden">
  <StatusBar onsettings={() => (ui.settings = true)} />
  <HaltBanner />

  {#if harness.connection === "offline"}
    <div role="status" class="bg-muted text-muted-foreground flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-center text-[12px]">
      {#if harness.cachedAt}
        <Icon icon={CloudOffIcon} class="size-3.5" />
        <span>Offline. Showing the last known account from {ago(harness.cachedAt, clock.now)}.</span>
      {:else}
        Reconnecting to the server…
      {/if}
    </div>
  {/if}

  {#if lab && viewport.desktop}
    <main class="flex min-h-0 flex-1 flex-col"><LabView /></main>
  {:else if viewport.desktop}
    <main class="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div class="border-border min-h-0 border-r"><Feed /></div>
      <div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <Approvals />
        <Positions />
        <HistoryTabs class="min-h-[17rem] flex-1" />
      </div>
    </main>
  {:else}
    <Tabs.Root
      bind:value={() => (lab ? "lab" : tab), (v) => {
        ui.view = v === "lab" ? "lab" : "live";
        if (v !== "lab") tab = v;
      }}
      class="min-h-0 flex-1 gap-0"
    >
      <main class="min-h-0 flex-1">
        <Tabs.Content value="lab" class="flex h-full flex-col"><LabView /></Tabs.Content>
        <Tabs.Content value="feed" class="h-full"><Feed /></Tabs.Content>
        <Tabs.Content value="approvals" class="h-full overflow-y-auto p-3"><Approvals showEmpty /></Tabs.Content>
        <Tabs.Content value="positions" class="h-full overflow-y-auto p-3"><Positions /></Tabs.Content>
        <Tabs.Content value="journal" class="flex h-full flex-col p-3"><HistoryTabs class="flex-1" /></Tabs.Content>
      </main>
      <Tabs.List class="bg-bar border-border pb-safe grid h-auto! w-full shrink-0 grid-cols-5 rounded-none border-t p-0">
        {#each tabs as t (t.value)}
          <Tabs.Trigger
            value={t.value}
            class={cn(
              "text-muted-foreground data-[state=active]:text-foreground relative h-14! min-w-0 flex-col gap-0.5 rounded-none text-[11px] font-medium",
              t.value === "lab" && "data-[state=active]:text-lab",
              "border-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:after:opacity-100 after:!inset-x-4 after:!bottom-auto after:!top-0",
            )}
          >
            <span class="relative">
              <Icon icon={t.icon} class="size-5" />
              {#if t.value === "approvals" && harness.pending.length > 0}
                <span class="num bg-warn text-background absolute -top-1.5 -right-2.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                  {harness.pending.length}
                </span>
              {/if}
            </span>
            {t.label}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
    </Tabs.Root>
  {/if}
</div>

<ConfirmDialog
  bind:open={ui.confirmKill}
  title="Engage the kill switch?"
  description="All order placement stops immediately. Release it from the status bar when you are ready."
  confirmLabel="Engage kill switch"
  destructive
  onconfirm={async () => {
    if (await harness.quickPatch("kill", { killSwitch: true }, "Kill switch engaged")) haptic();
  }}
/>
<NewSimSheet />
<SettingsSheet bind:open={ui.settings} />
<SymbolSheet />
<AgentSheet />
<DocSheet />
<CommandPalette />
