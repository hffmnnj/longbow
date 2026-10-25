<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import Approvals from "$lib/components/Approvals.svelte";
  import Feed from "$lib/components/Feed.svelte";
  import HaltBanner from "$lib/components/HaltBanner.svelte";
  import HistoryTabs from "$lib/components/HistoryTabs.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ControlRoom from "$lib/components/ControlRoom.svelte";
  import MarketsView from "$lib/components/MarketsView.svelte";
  import OrderSheet from "$lib/components/OrderSheet.svelte";
  import PerformanceView from "$lib/components/PerformanceView.svelte";
  import PortfolioView from "$lib/components/PortfolioView.svelte";
  import ReportSheet from "$lib/components/ReportSheet.svelte";
  import ReportView from "$lib/components/ReportView.svelte";
  import ReportsView from "$lib/components/ReportsView.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import LabView from "$lib/components/lab/LabView.svelte";
  import NewSimSheet from "$lib/components/lab/NewSimSheet.svelte";
  import NewSuiteSheet from "$lib/components/lab/NewSuiteSheet.svelte";
  import AgentSheet from "$lib/components/AgentSheet.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import DocSheet from "$lib/components/DocSheet.svelte";
  import SettingsSheet from "$lib/components/SettingsSheet.svelte";
  import SymbolSheet from "$lib/components/SymbolSheet.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
    import { startClock } from "$lib/clock.svelte";
  import { viewport, watchViewport } from "$lib/media.svelte";
  import { haptic, registerServiceWorker, setBadge } from "$lib/pwa.svelte";
  import { runSectionTransition } from "$lib/native";
  import { ago } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";
  import { clock } from "$lib/clock.svelte";
  import { page } from "$app/stores";
  import { CloudOffIcon } from "$lib/icons";
  import { PRIMARY_NAV, sectionFromParam } from "$lib/nav";
  import { cn } from "$lib/utils.js";

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
    const target = sectionFromParam(view);
    if (target) ui.section = target;
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

  const section = $derived(ui.section);

  /** `?report=<id>` deep links (push notifications, copied links) open the brief, including when the app is already open. */
  const deepReport = $derived($page.url.searchParams.get("report"));
  $effect(() => {
    if (deepReport) {
      runSectionTransition(() => {
        ui.section = "reports";
        ui.report = deepReport;
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("report");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  });

  function select(next: typeof ui.section) {
    if (ui.section === next) return;
    haptic("selection");
    runSectionTransition(() => {
      ui.section = next;
    });
  }
</script>

<svelte:head><title>{harness.pending.length ? `(${harness.pending.length}) ` : ""}Longbow</title></svelte:head>

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

  {#if section === "lab"}
    <main class="flex min-h-0 flex-1 flex-col"><LabView /></main>
  {:else if viewport.desktop && section === "feed"}
    <main class="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div class="border-border min-h-0 border-r"><Feed /></div>
      <div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <Approvals />
        <PortfolioView compact />
        <HistoryTabs class="min-h-[22rem] flex-1" />
      </div>
    </main>
  {:else if section === "feed"}
    <main class="flex min-h-0 flex-1 flex-col">
      {#if harness.pending.length > 0}
        <div class="border-border max-h-[40dvh] shrink-0 overflow-y-auto overscroll-contain border-b p-3"><Approvals /></div>
      {/if}
      <div class="min-h-0 flex-1"><Feed /></div>
    </main>
  {:else}
    <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:p-4">
      {#if section === "portfolio"}<PortfolioView />
      {:else if section === "markets"}<MarketsView />
      {:else if section === "performance"}<PerformanceView />
      {:else if section === "reports"}
        {#if ui.report && viewport.desktop}
          <ReportView id={ui.report} onback={() => (ui.report = null)} />
        {:else}
          <ReportsView />
        {/if}
      {:else if section === "agent"}<ControlRoom />
      {:else if section === "history"}<HistoryTabs class="min-h-[70dvh]" />{/if}
    </main>
  {/if}

  {#if !viewport.desktop}
    <nav aria-label="Sections" class="bg-bar border-border pb-safe pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] grid shrink-0 grid-cols-5 border-t">
      {#each PRIMARY_NAV as item (item.value)}
        {@const active = section === item.value}
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          onclick={() => select(item.value)}
          class={cn(
            "text-muted-foreground relative flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
            "after:bg-foreground after:absolute after:inset-x-5 after:top-0 after:h-0.5 after:rounded-full after:opacity-0",
            active && "text-foreground after:opacity-100",
          )}
        >
          <span class="relative">
            <Icon icon={item.icon} class="size-5" />
            {#if item.value === "feed" && harness.pending.length > 0}
              <span class="num bg-warn text-background absolute -top-1.5 -right-3 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                {harness.pending.length}
              </span>
            {/if}
          </span>
          {item.label}
        </button>
      {/each}
    </nav>
  {/if}
</div>

<ConfirmDialog
  bind:open={ui.confirmKill}
  title="Engage the kill switch?"
  description="All order placement stops immediately. Release it from the status bar when you are ready."
  confirmLabel="Engage kill switch"
  destructive
  onconfirm={async () => {
    if (await harness.quickPatch("kill", { killSwitch: true }, "Kill switch engaged")) haptic("heavy");
  }}
/>
<NewSimSheet />
<NewSuiteSheet />
<SettingsSheet bind:open={ui.settings} />
<SymbolSheet />
<ReportSheet />
<OrderSheet />
<AgentSheet />
<DocSheet />
<CommandPalette />
