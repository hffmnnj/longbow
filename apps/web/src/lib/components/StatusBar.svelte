<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import AgentChip from "./AgentChip.svelte";
  import BrokerChip from "./BrokerChip.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";
  import KillSwitch from "./KillSwitch.svelte";
  import ModeControl from "./ModeControl.svelte";
  import LiveLock from "./LiveLock.svelte";
  import SectionNav from "./SectionNav.svelte";
  import Pnl from "./Pnl.svelte";
  import SessionChip from "./SessionChip.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { Menu01Icon, Settings02Icon, Search01Icon } from "$lib/icons";
  import { SECONDARY_NAV } from "$lib/nav";
  import { ui } from "$lib/ui.svelte";
  import { usd } from "$lib/format";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { onsettings }: { onsettings: () => void } = $props();

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const status = $derived(harness.status);
  const killed = $derived(status?.settings.killSwitch ?? false);
  const account = $derived(status?.account);
  const lab = $derived(ui.section === "lab");
  let menuOpen = $state(false);
  /** Runs once the menu sheet has finished closing, so the next sheet does not open underneath it. */
  let afterMenu: (() => void) | null = null;
  const runAfterMenu = () => {
    const fn = afterMenu;
    afterMenu = null;
    fn?.();
  };
  function fromMenu(fn: () => void) {
    afterMenu = fn;
    menuOpen = false;
    // Fallback if the close transition never reports completion (reduced motion, interrupted animation).
    setTimeout(runAfterMenu, 350);
  }
  let confirmDisconnect = $state(false);
</script>

{#snippet equity()}
  {#if status}
    <div class={cn("flex flex-col leading-tight transition-opacity", lab && "opacity-60")}>
      <span class="num text-[17px] font-semibold md:text-[18px]">
        {account ? usd(account.equity) : "\u2014"}
      </span>
      {#if status.dayPnl !== undefined || status.dayPnlPct !== undefined}
        <span class="text-[12px]">
          <span class="text-muted-foreground mr-1">Day</span><Pnl amount={status.dayPnl} percent={status.dayPnlPct} />
        </span>
      {:else}
        <span class="text-muted-foreground text-[12px]">Day P&amp;L unavailable</span>
      {/if}
    </div>
  {:else}
    <div class="bg-muted h-9 w-32 animate-pulse rounded"></div>
  {/if}
{/snippet}

{#snippet mark()}
  <div class="flex items-center gap-2" aria-label="Longbow">
    <img src="/brand/longbow-mark.svg" alt="" width="32" height="32" class={cn("size-8 rounded-lg transition-[filter]", lab && "hue-rotate-[60deg]")} />
    <span class="hidden text-[15px] font-semibold tracking-tight md:inline">Longbow</span>
  </div>
{/snippet}

<header
  class={cn(
    "no-print bg-bar pt-safe relative z-30 shrink-0 border-b transition-colors",
    lab && !killed && "bg-lab-bg border-lab/40",
    killed && "border-destructive bg-destructive/10 border-b-2",
  )}
>
  {#if killed}
    <div class="bg-destructive absolute inset-x-0 top-0 h-0.5"></div>
  {/if}

  <!-- Desktop and tablet -->
  <div class="hidden md:block">
    <div class="flex items-center gap-5 px-4 pt-1.5">
      {@render mark()}
      <SectionNav />
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          onclick={() => (ui.palette = true)}
          aria-label="Open command palette"
          aria-keyshortcuts="Control+K Meta+K"
          class="border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 mr-1 flex h-8 items-center gap-2 rounded-md border px-2.5 text-[12px] transition-colors"
        >
          <Icon icon={Search01Icon} class="size-3.5" />
          <kbd class="num text-[11px]">{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <Button variant="ghost" size="icon" onclick={onsettings} aria-label="Open settings">
          <Icon icon={Settings02Icon} />
        </Button>
        <ThemeToggle />
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-1.5 2xl:gap-x-7">
      {@render equity()}
      <SessionChip />
      <BrokerChip bar />
      <AgentChip />
      <div class="ml-auto flex items-center gap-3">
        <LiveLock />
        <ModeControl />
        <KillSwitch />
      </div>
    </div>
  </div>

  <!-- Phone -->
  <div class="flex items-center gap-3 py-1.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:hidden">
    {@render mark()}
    <div class="min-w-0 flex-1">{@render equity()}</div>
    <Button variant="outline" size="icon" class="size-11" onclick={() => (ui.palette = true)} aria-label="Open command palette">
      <Icon icon={Search01Icon} />
    </Button>
    <KillSwitch compact class="h-11 px-3.5" />
    <Button variant="outline" size="icon" class="size-11" onclick={() => (menuOpen = true)} aria-label="Open menu">
      <Icon icon={Menu01Icon} />
    </Button>
  </div>
</header>

<Sheet.Root bind:open={menuOpen} onOpenChangeComplete={(o) => !o && runAfterMenu()}>
  <Sheet.Content side="bottom" class="pb-safe max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl">
    <Sheet.Header class="pb-2">
      <Sheet.Title>Menu</Sheet.Title>
      <Sheet.Description class="sr-only">Mode, broker, agent, journal, reports, lab and settings</Sheet.Description>
    </Sheet.Header>
    <div class="flex flex-col gap-4 px-4 pb-4">
      <LiveLock class="h-11 justify-center text-[13px]" />
      <ModeControl block />
      <div class="border-border divide-border divide-y rounded-lg border [&>*]:px-3 [&>*]:py-2.5">
        <SessionChip />
        <AgentChip />
        <BrokerChip />
      </div>
      <nav aria-label="More" class="border-border divide-border divide-y overflow-hidden rounded-lg border">
        {#each SECONDARY_NAV as item (item.value)}
          <button
            type="button"
            class="hover:bg-muted/60 flex h-12 w-full items-center gap-3 px-3 text-left text-[14px]"
            onclick={() => fromMenu(() => (ui.section = item.value))}
          >
            <Icon icon={item.icon} class="text-muted-foreground size-5" />
            {item.label}
          </button>
        {/each}
      </nav>
      <div class="flex gap-2">
        <Button variant="outline" class="h-11 flex-1" onclick={() => fromMenu(onsettings)}>
          <Icon icon={Settings02Icon} /> Settings
        </Button>
        <ThemeToggle class="border-border size-11 border" />
      </div>
      {#if status?.broker.state === "connected"}
        <Button variant="ghost" class="text-muted-foreground h-11" onclick={() => fromMenu(() => (confirmDisconnect = true))}>
          Disconnect Robinhood
        </Button>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>

<ConfirmDialog
  bind:open={confirmDisconnect}
  title="Disconnect Robinhood?"
  description="The agent keeps researching but cannot read the account or place orders until you reconnect."
  confirmLabel="Disconnect"
  destructive
  onconfirm={() => harness.disconnectRobinhood()}
/>
