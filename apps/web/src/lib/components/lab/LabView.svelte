<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import Empty from "../Empty.svelte";
  import Icon from "../Icon.svelte";
  import CompareView from "./CompareView.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import RunCard from "./RunCard.svelte";
  import RunDetail from "./RunDetail.svelte";
  import { Add01Icon, FlaskConicalIcon, GitCompareIcon } from "$lib/icons";
  import { viewport } from "$lib/media.svelte";
  import { sim } from "$lib/sim.svelte";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  const run = $derived(sim.run(ui.run));
  const picked = $derived(ui.compare.flatMap((id) => sim.run(id) ?? []));
  const showCompare = $derived(ui.comparing && picked.length >= 2);

  function toggle(id: string) {
    ui.compare = ui.compare.includes(id) ? ui.compare.filter((x) => x !== id) : [...ui.compare, id].slice(-5);
    if (ui.compare.length < 2) ui.comparing = false;
  }
  function open(id: string) {
    ui.run = id;
    ui.comparing = false;
  }
  function back() {
    ui.run = null;
    ui.comparing = false;
  }

  // Drop ticks for runs that no longer exist after a reload.
  $effect(() => {
    if (!sim.loaded) return;
    const ids = new Set(sim.runs.map((r) => r.id));
    if (ui.compare.some((id) => !ids.has(id))) ui.compare = ui.compare.filter((id) => ids.has(id));
    if (ui.run && !ids.has(ui.run)) ui.run = null;
  });
</script>

{#snippet list()}
  <div class="flex h-full min-h-0 flex-col">
    <div class="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
      <h2 class="text-[14px] font-semibold">Runs</h2>
      <PaperBadge />
      <span class="flex-1"></span>
      <Button class="bg-lab text-background hover:bg-lab/90 h-10 gap-1.5 md:h-9" onclick={() => (ui.newSim = true)}>
        <Icon icon={Add01Icon} class="size-4" strokeWidth={2.2} /> New simulation
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if !sim.loaded}
        <div class="flex flex-col gap-2.5">
          {#each [0, 1, 2] as i (i)}<div class="bg-muted/60 h-32 animate-pulse rounded-lg"></div>{/each}
        </div>
      {:else if sim.loadError && sim.runs.length === 0}
        <Empty text={`Could not load simulations: ${sim.loadError}`}>
          <Button size="sm" variant="outline" onclick={() => sim.loadRuns()}>Retry</Button>
        </Empty>
      {:else if sim.runs.length === 0}
        <div class="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <span class="bg-lab/12 text-lab grid size-12 place-items-center rounded-xl"><Icon icon={FlaskConicalIcon} class="size-6" /></span>
          <p class="text-[14px] font-medium">No simulations yet</p>
          <Button class="bg-lab text-background hover:bg-lab/90 h-11" onclick={() => (ui.newSim = true)}>New simulation</Button>
        </div>
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each sim.runs as r (r.id)}
            <li>
              <RunCard run={r} active={!ui.comparing && ui.run === r.id} selected={ui.compare.includes(r.id)} onopen={() => open(r.id)} ontoggle={() => toggle(r.id)} />
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if ui.compare.length >= 2}
      <div class="border-border bg-bar shrink-0 border-t p-2.5">
        <Button
          class="bg-lab text-background hover:bg-lab/90 h-11 w-full gap-2 md:h-10"
          onclick={() => {
            ui.comparing = true;
          }}
        >
          <Icon icon={GitCompareIcon} class="size-4" /> Compare {ui.compare.length} runs
        </Button>
      </div>
    {/if}
  </div>
{/snippet}

<div class="bg-lab-bg/40 min-h-0 flex-1 border-t-2 border-t-lab/70" data-lab>
  {#if viewport.desktop}
    <div class="grid h-full min-h-0 grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
      <div class="border-border min-h-0 border-r">{@render list()}</div>
      <div class="flex min-h-0 flex-col">
        {#if showCompare}
          <CompareView runs={picked} onback={back} />
        {:else if run}
          {#key run.id}<RunDetail {run} />{/key}
        {:else}
          <div class="text-muted-foreground grid flex-1 place-items-center text-[13px]">Select a run</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class={cn("flex h-full min-h-0 flex-col")}>
      {#if showCompare}
        <CompareView runs={picked} onback={() => (ui.comparing = false)} />
      {:else if run}
        {#key run.id}<RunDetail {run} onback={back} />{/key}
      {:else}
        {@render list()}
      {/if}
    </div>
  {/if}
</div>
