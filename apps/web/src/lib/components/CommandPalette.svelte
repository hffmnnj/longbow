<script lang="ts">
  import * as Command from "$lib/components/ui/command/index.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";
  import { isTicker } from "$lib/chart";
  import { File01Icon, PlayIcon, PowerIcon, Settings02Icon, ChartLineData01Icon, Target01Icon, Notebook01Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import { openNote, openSkill, openSymbol, ui } from "$lib/ui.svelte";

  let search = $state("");
  let confirmAuto = $state(false);
  let confirmRelease = $state(false);

  const mode = $derived(harness.status?.settings.mode);
  const killed = $derived(harness.status?.settings.killSwitch ?? false);
  const held = $derived(harness.positions.map((p) => p.symbol));
  const watch = $derived((harness.status?.settings.watchlist ?? []).filter((s) => !held.includes(s)));
  const typed = $derived(search.trim().toUpperCase());
  const typedNew = $derived(isTicker(typed) && !held.includes(typed) && !watch.includes(typed) ? typed : null);

  const modes = [
    { value: "off", label: "Off" },
    { value: "approve", label: "Approve" },
    { value: "auto", label: "Auto" },
  ] as const;

  function run(fn: () => unknown) {
    ui.palette = false;
    // Let the palette close before dialogs or sheets open, so focus lands correctly.
    setTimeout(fn, 60);
  }

  $effect(() => {
    if (!ui.palette) search = "";
  });
</script>

<Command.Dialog bind:open={ui.palette} title="Command palette" description="Jump to a chart, run an action, open a note or skill" class="sm:max-w-lg">
  <Command.Input bind:value={search} placeholder="Type a ticker or a command" />
  <Command.List class="max-h-[min(60dvh,26rem)]">
    <Command.Empty>No match</Command.Empty>

    {#if typedNew}
      <Command.Group heading="Chart">
        <Command.Item value={`chart ${typedNew}`} forceMount onSelect={() => run(() => openSymbol(typedNew))}>
          <Icon icon={ChartLineData01Icon} />
          Open chart for <span class="num font-semibold">{typedNew}</span>
        </Command.Item>
      </Command.Group>
    {/if}

    {#if held.length || watch.length}
      <Command.Group heading="Symbols">
        {#each held as s (s)}
          <Command.Item value={`symbol ${s} held`} onSelect={() => run(() => openSymbol(s))}>
            <Icon icon={ChartLineData01Icon} /><span class="num font-semibold">{s}</span>
            <span class="text-muted-foreground ml-1 text-[12px]">held</span>
          </Command.Item>
        {/each}
        {#each watch as s (s)}
          <Command.Item value={`symbol ${s} watchlist`} onSelect={() => run(() => openSymbol(s))}>
            <Icon icon={ChartLineData01Icon} /><span class="num font-semibold">{s}</span>
            <span class="text-muted-foreground ml-1 text-[12px]">watchlist</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}

    <Command.Group heading="Actions">
      <Command.Item value="run cycle now" onSelect={() => run(() => harness.runCycle())}>
        <Icon icon={PlayIcon} />Run cycle now
      </Command.Item>
      {#each modes as m (m.value)}
        {#if m.value !== mode}
          <Command.Item
            value={`mode ${m.label}`}
            onSelect={() => run(() => (m.value === "auto" ? (confirmAuto = true) : harness.quickPatch("mode", { mode: m.value })))}
          >
            <Icon icon={Target01Icon} />Switch mode to {m.label}
          </Command.Item>
        {/if}
      {/each}
      <Command.Item value="kill switch engage release" onSelect={() => run(() => (killed ? (confirmRelease = true) : harness.quickPatch("kill", { killSwitch: true }, "Kill switch engaged")))}>
        <Icon icon={PowerIcon} class="text-destructive size-4" />
        <span class={killed ? "" : "text-destructive"}>{killed ? "Release kill switch" : "Engage kill switch"}</span>
      </Command.Item>
      <Command.Item value="open settings" onSelect={() => run(() => (ui.settings = true))}>
        <Icon icon={Settings02Icon} />Open settings
      </Command.Item>
    </Command.Group>

    {#if harness.notes.length}
      <Command.Group heading="Notes">
        {#each harness.notes as n (n.path)}
          <Command.Item value={`note ${n.path}`} onSelect={() => run(() => openNote(n.path))}>
            <Icon icon={File01Icon} /><span class="num">{n.path}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}

    {#if harness.skills.length}
      <Command.Group heading="Skills">
        {#each harness.skills as s (s.name)}
          <Command.Item value={`skill ${s.name} ${s.description}`} onSelect={() => run(() => openSkill(s.name))}>
            <Icon icon={Notebook01Icon} /><span class="num">{s.name}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>

<ConfirmDialog
  bind:open={confirmAuto}
  title="Switch to Auto?"
  description="Risk-approved orders will be placed on Robinhood immediately, without waiting for you. The kill switch still blocks everything."
  confirmLabel="Enable Auto"
  onconfirm={() => harness.quickPatch("mode", { mode: "auto" }, "Auto mode on")}
/>
<ConfirmDialog
  bind:open={confirmRelease}
  title="Release the kill switch?"
  description="Orders can be placed again, subject to the current mode and risk limits."
  confirmLabel="Release"
  onconfirm={() => harness.quickPatch("kill", { killSwitch: false }, "Kill switch released")}
/>
