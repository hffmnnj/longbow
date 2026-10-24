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
  import SettingsSheet from "$lib/components/SettingsSheet.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import { Message01Icon, Briefcase01Icon, FlashIcon, Notebook01Icon } from "$lib/icons";
  import { startClock } from "$lib/clock.svelte";
  import { viewport, watchViewport } from "$lib/media.svelte";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let settingsOpen = $state(false);
  let tab = $state("feed");

  onMount(() => {
    const stopClock = startClock();
    const stopViewport = watchViewport();
    void harness.start();

    const url = new URL(window.location.href);
    const result = url.searchParams.get("robinhood");
    if (result) {
      if (result === "connected") toast.success("Robinhood connected");
      else toast.error("Robinhood sign-in failed", { description: "Try connecting again." });
      url.searchParams.delete("robinhood");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }

    return () => {
      stopClock();
      stopViewport();
      harness.stop();
    };
  });

  const tabs = [
    { value: "feed", label: "Feed", icon: Message01Icon },
    { value: "approvals", label: "Approvals", icon: FlashIcon },
    { value: "positions", label: "Positions", icon: Briefcase01Icon },
    { value: "journal", label: "Journal", icon: Notebook01Icon },
  ];
</script>

<svelte:head><title>{harness.pending.length ? `(${harness.pending.length}) ` : ""}Harness</title></svelte:head>

<div class="flex h-dvh flex-col overflow-hidden">
  <StatusBar onsettings={() => (settingsOpen = true)} />
  <HaltBanner />

  {#if harness.connection === "offline"}
    <div role="status" class="bg-muted text-muted-foreground shrink-0 px-4 py-1 text-center text-[12px]">
      Reconnecting to the server…
    </div>
  {/if}

  {#if viewport.desktop}
    <main class="grid min-h-0 flex-1 grid-cols-[3fr_2fr]">
      <div class="border-border min-h-0 border-r"><Feed /></div>
      <div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <Approvals />
        <Positions />
        <HistoryTabs class="min-h-[17rem] flex-1" />
      </div>
    </main>
  {:else}
    <Tabs.Root bind:value={tab} class="min-h-0 flex-1 gap-0">
      <main class="min-h-0 flex-1">
        <Tabs.Content value="feed" class="h-full"><Feed /></Tabs.Content>
        <Tabs.Content value="approvals" class="h-full overflow-y-auto p-3"><Approvals showEmpty /></Tabs.Content>
        <Tabs.Content value="positions" class="h-full overflow-y-auto p-3"><Positions /></Tabs.Content>
        <Tabs.Content value="journal" class="flex h-full flex-col p-3"><HistoryTabs class="flex-1" /></Tabs.Content>
      </main>
      <Tabs.List class="bg-bar border-border pb-safe grid h-auto! w-full shrink-0 grid-cols-4 rounded-none border-t p-0">
        {#each tabs as t (t.value)}
          <Tabs.Trigger
            value={t.value}
            class={cn(
              "text-muted-foreground data-[state=active]:text-foreground relative h-14! flex-col gap-0.5 rounded-none text-[11px] font-medium",
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

<SettingsSheet bind:open={settingsOpen} />
