<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import Empty from "../Empty.svelte";
  import Icon from "../Icon.svelte";
  import CompareView from "./CompareView.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import RunCard from "./RunCard.svelte";
  import RunDetail from "./RunDetail.svelte";
  import SuiteCard from "./SuiteCard.svelte";
  import SuiteDetail from "./SuiteDetail.svelte";
  import { Add01Icon, FlaskConicalIcon, GitCompareIcon } from "$lib/icons";
  import { viewport } from "$lib/media.svelte";
  import { sim } from "$lib/sim.svelte";
  import { isActive } from "$lib/sim";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  const run = $derived(sim.run(ui.run));
  const suite = $derived(sim.suite(ui.suite));
  const picked = $derived(ui.compare.flatMap((id) => sim.run(id) ?? []));
  const showCompare = $derived(ui.comparing && picked.length >= 2);
  const activeRuns = $derived(sim.runs.filter((r) => isActive(r.status)).length);
  const activeSuites = $derived(sim.suites.filter((s) => isActive(s.status)).length);

  function toggle(id: string) {
    ui.compare = ui.compare.includes(id) ? ui.compare.filter((x) => x !== id) : [...ui.compare, id].slice(-5);
    if (ui.compare.length < 2) ui.comparing = false;
  }
  function open(id: string) {
    ui.run = id;
    ui.suite = null;
    ui.comparing = false;
  }
  function openSuite(id: string) {
    ui.suite = id;
    ui.run = null;
    ui.comparing = false;
  }
  function back() {
    ui.run = null;
    ui.suite = null;
    ui.comparing = false;
  }

  // Drop ticks and selections for runs and suites that no longer exist after a reload.
  $effect(() => {
    if (!sim.loaded) return;
    const ids = new Set(sim.runs.map((r) => r.id));
    if (ui.compare.some((id) => !ids.has(id))) ui.compare = ui.compare.filter((id) => ids.has(id));
    if (ui.run && !ids.has(ui.run)) ui.run = null;
    const suiteIds = new Set(sim.suites.map((s) => s.id));
    if (ui.suite && !suiteIds.has(ui.suite)) ui.suite = null;
  });
</script>

{#snippet tabs()}
  <div class="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2.5" role="tablist" aria-label="Lab sections">
    <h2 class="sr-only">Lab</h2>
    {#each [["runs", "Runs"], ["suites", "Suites"]] as [value, label] (value)}
      <button
        type="button"
        role="tab"
        aria-selected={ui.labTab === value}
        onclick={() => (ui.labTab = value as "runs" | "suites")}
        class={cn(
          "h-10 flex-1 rounded-md px-3 text-[13.5px] font-medium transition-colors md:h-9",
          ui.labTab === value ? "bg-lab/15 text-lab" : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
        )}
      >
        {label}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet list()}
  <div class="flex h-full min-h-0 flex-col">
    {@render tabs()}
    <div class="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
      {#if ui.labTab === "runs"}
        <h2 class="text-[14px] font-semibold">Runs</h2>
      {:else}
        <h2 class="text-[14px] font-semibold">Suites</h2>
      {/if}
      <PaperBadge />
      {#if activeRuns + activeSuites > 0}
        <span class="text-lab num flex items-center gap-1.5 text-[12px]">
          <span class="bg-lab soft-pulse size-1.5 rounded-full" aria-hidden="true"></span>
          {activeRuns} running{activeSuites > 0 ? ` · ${activeSuites} suite${activeSuites > 1 ? "s" : ""}` : ""}
        </span>
      {/if}
      <span class="flex-1"></span>
      {#if ui.labTab === "runs"}
        <Button class="bg-lab text-background hover:bg-lab/90 h-10 gap-1.5 md:h-9" onclick={() => (ui.newSim = true)}>
          <Icon icon={Add01Icon} class="size-4" strokeWidth={2.2} /> New simulation
        </Button>
      {:else}
        <Button class="bg-lab text-background hover:bg-lab/90 h-10 gap-1.5 md:h-9" onclick={() => (ui.newSuite = true)}>
          <Icon icon={Add01Icon} class="size-4" strokeWidth={2.2} /> New suite
        </Button>
      {/if}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if ui.labTab === "runs"}
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
      {:else if !sim.loaded}
        <div class="flex flex-col gap-2.5">
          {#each [0, 1] as i (i)}<div class="bg-muted/60 h-28 animate-pulse rounded-lg"></div>{/each}
        </div>
      {:else if sim.loadError && sim.suites.length === 0}
        <Empty text={`Could not load suites: ${sim.loadError}`}>
          <Button size="sm" variant="outline" onclick={() => sim.loadRuns()}>Retry</Button>
        </Empty>
      {:else if sim.suites.length === 0}
        <div class="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <span class="bg-lab/12 text-lab grid size-12 place-items-center rounded-xl"><Icon icon={GitCompareIcon} class="size-6" /></span>
          <p class="text-[14px] font-medium">No suites yet</p>
          <p class="text-muted-foreground max-w-64 text-[13px] leading-snug">Run two variants on identical markets and see which one holds up.</p>
          <Button class="bg-lab text-background hover:bg-lab/90 h-11" onclick={() => (ui.newSuite = true)}>New suite</Button>
        </div>
      {:else}
        <ul class="flex flex-col gap-2.5">
          {#each sim.suites as s (s.id)}
            <li>
              <SuiteCard suite={s} runs={sim.runs} active={ui.suite === s.id} onopen={() => openSuite(s.id)} />
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if ui.labTab === "runs" && ui.compare.length >= 2}
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
        {:else if suite}
          {#key suite.id}<SuiteDetail {suite} />{/key}
        {:else}
          <div class="text-muted-foreground grid flex-1 place-items-center text-[13px]">Select a run or a suite</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class={cn("flex h-full min-h-0 flex-col")}>
      {#if showCompare}
        <CompareView runs={picked} onback={() => (ui.comparing = false)} />
      {:else if run}
        {#key run.id}<RunDetail {run} onback={back} />{/key}
      {:else if suite}
        {#key suite.id}<SuiteDetail {suite} onback={back} />{/key}
      {:else}
        {@render list()}
      {/if}
    </div>
  {/if}
</div>
