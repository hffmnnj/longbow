<script lang="ts">
  import type { SimExecution, SimMode, SimRunConfig } from "@rh/shared";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Slider } from "$lib/components/ui/slider/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import Icon from "../Icon.svelte";
  import NumberField from "../NumberField.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import { ArrowRight01Icon, Cancel01Icon, InformationCircleIcon, Loading03Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import { RISK_GROUPS, parseTickers, type RiskKey } from "$lib/settingsForm";
  import { sim } from "$lib/sim.svelte";
  import { defaultSimConfig, estimateMinutes, formatEstimate, riskOverrides, startDateProblem } from "$lib/sim";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  const live = $derived(harness.status?.settings);

  let name = $state("");
  let scenarioId = $state<string | null>(null);
  let scenarioTouched = $state(false);
  let mode = $state<SimMode>("blind");
  let modeTouched = $state(false);
  let execution = $state<SimExecution>("realistic");
  let model = $state<"main" | "subagent">("main");
  let seed = $state("");
  let startDate = $state("");
  let days = $state(10);
  let cash = $state("1200");
  let cycles = $state("2");
  let watchlist = $state<string[]>([]);
  let tickerInput = $state("");
  let tickerError = $state<string | null>(null);
  let strategy = $state("");
  let overrides = $state<Partial<Record<RiskKey, string>>>({});
  let riskOpen = $state(false);
  let serverError = $state<string | null>(null);

  const scenarios = $derived(sim.scenarios);
  const scenario = $derived(scenarios.find((s) => s.id === scenarioId) ?? null);
  const bootstrap = $derived(mode === "bootstrap");
  const maxDays = $derived(bootstrap ? 120 : 60);
  const minDays = $derived(bootstrap ? 5 : 1);

  // A fresh form, seeded from the live watchlist, each time the sheet opens.
  $effect(() => {
    if (!ui.newSim) return;
    const d = defaultSimConfig(live?.watchlist ?? []);
    name = "";
    mode = d.mode;
    modeTouched = false;
    execution = d.execution;
    model = d.model;
    seed = "";
    startDate = d.startDate ?? "";
    days = d.days;
    cash = String(d.startingCash);
    cycles = String(d.cyclesPerDay);
    watchlist = d.watchlist ?? [];
    tickerInput = "";
    tickerError = null;
    strategy = "";
    overrides = {};
    riskOpen = false;
    serverError = null;
    scenarioId = null;
    scenarioTouched = false;
    void sim.loadScenarios();
  });

  // Default to the first scenario (blind) once the library arrives.
  $effect(() => {
    if (!ui.newSim || scenarioTouched || scenarioId !== null || scenarios.length === 0) return;
    scenarioId = scenarios[0]!.id;
    if (!modeTouched) mode = "blind";
  });

  function pickScenario(id: string | null) {
    scenarioId = id;
    scenarioTouched = true;
    if (id && !modeTouched) mode = "blind";
  }

  function pickMode(next: SimMode) {
    mode = next;
    modeTouched = true;
    days = next === "bootstrap" ? 40 : 10;
  }

  const daysLabel = $derived(
    bootstrap ? `${days} bootstrap days` : scenario ? `${scenario.days} trading days` : `${days} trading days`,
  );
  const dateProblem = $derived(bootstrap || scenario ? null : !startDate ? "Pick a start date" : startDateProblem(startDate, days));
  const seedProblem = $derived(
    seed.trim() === "" ? null : !/^\d+$/.test(seed.trim()) || Number(seed) > 2_147_483_647 ? "Whole number up to 2147483647" : null,
  );
  const cashNum = $derived(Number(cash));
  const cashProblem = $derived(!Number.isFinite(cashNum) || cashNum <= 0 ? "Enter an amount above zero" : cashNum > 1_000_000 ? "Max $1,000,000" : null);
  const risk = $derived(riskOverrides(overrides));
  const canStart = $derived(
    !dateProblem && !seedProblem && !cashProblem && watchlist.length > 0 && Object.keys(risk.errors).length === 0 && !sim.starting,
  );
  const estimate = $derived(formatEstimate(estimateMinutes(scenario?.days ?? days, Number(cycles))));

  function addTickers() {
    const { added, rejected } = parseTickers(tickerInput, watchlist);
    watchlist = [...watchlist, ...added];
    tickerError = rejected.length ? `Not a ticker: ${rejected.join(", ")}` : null;
    tickerInput = rejected.join(" ");
  }

  async function start() {
    if (!canStart) return;
    serverError = null;
    const config: SimRunConfig = {
      mode,
      execution,
      model,
      days: scenario?.days ?? days,
      startingCash: cashNum,
      cyclesPerDay: Number(cycles) as 2 | 3 | 4,
      watchlist,
      ...(scenario ? { scenario: scenario.id } : { startDate }),
      ...(seed.trim() ? { seed: Number(seed.trim()) } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(strategy.trim() ? { strategy: strategy.trim() } : {}),
      ...(risk.risk ? { risk: risk.risk } : {}),
    };
    const res = await sim.start(config);
    if ("error" in res) {
      serverError = res.error;
      return;
    }
    ui.newSim = false;
    ui.comparing = false;
    ui.labTab = "runs";
    ui.suite = null;
    ui.run = res.run.id;
  }
</script>

<Sheet.Root bind:open={ui.newSim}>
  <Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
    <Sheet.Header class="border-border border-b">
      <div class="flex items-center gap-2 pr-10">
        <Sheet.Title>New simulation</Sheet.Title>
        <PaperBadge />
      </div>
      <Sheet.Description class="sr-only">Replay past trading days with a paper broker</Sheet.Description>
    </Sheet.Header>

    <form
      id="sim-form"
      class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4"
      onsubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <div class="flex flex-col gap-1">
        <Label for="sim-name" class="text-[12.5px] font-medium">Name</Label>
        <Input id="sim-name" bind:value={name} maxlength={80} placeholder="Optional" autocomplete="off" class="h-10 md:h-9" />
      </div>

      {#if !bootstrap}
        <section class="flex flex-col gap-2" aria-labelledby="sim-scenario">
          <h3 id="sim-scenario" class="label-caps">Scenario</h3>
          {#if scenarios.length === 0}
            <p class="text-muted-foreground text-[13px]">The scenario library did not load. Pick custom dates below.</p>
          {:else}
            <div class="grid gap-2" role="radiogroup" aria-label="Scenario">
              {#each scenarios as s (s.id)}
                {@const selected = scenarioId === s.id}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onclick={() => pickScenario(s.id)}
                  class={cn(
                    "border-border flex min-h-11 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    selected ? "border-lab/60 bg-lab-bg" : "hover:bg-muted/40",
                  )}
                >
                  <span class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{s.name}</span>
                    <Badge variant="secondary" class="shrink-0 text-[10.5px] tracking-wide uppercase">{s.regime}</Badge>
                  </span>
                  <span class="text-muted-foreground line-clamp-2 text-[12px] leading-snug">{s.description}</span>
                </button>
              {/each}
              <button
                type="button"
                role="radio"
                aria-checked={scenarioId === null}
                onclick={() => pickScenario(null)}
                class={cn(
                  "border-border flex min-h-11 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  scenarioId === null ? "border-lab/60 bg-lab-bg" : "hover:bg-muted/40",
                )}
              >
                <span class="text-[13.5px] font-medium">Custom dates</span>
                <span class="text-muted-foreground text-[12px] leading-snug">Pick any window from real history.</span>
              </button>
            </div>
          {/if}
        </section>
      {/if}

      <div class="flex flex-col gap-2">
        <span class="flex items-center gap-1.5 text-[12.5px] font-medium" id="sim-env-label">
          Environment
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger
                aria-label="What the environments mean"
                class="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded"
              >
                <Icon icon={InformationCircleIcon} class="size-4" />
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom" class="max-w-64 text-left leading-snug">
                Historical runs on real dates and tickers. Blind hides the dates and renames tickers, so memory cannot help. Bootstrap builds synthetic
                markets from ten years of resampled returns.
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        </span>
        <ToggleGroup.Root
          type="single"
          bind:value={() => mode, (v) => v && pickMode(v as SimMode)}
          aria-labelledby="sim-env-label"
          class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
        >
          {#each [["historical", "Historical"], ["blind", "Blind"], ["bootstrap", "Bootstrap"]] as [v, label] (v)}
            <ToggleGroup.Item
              value={v!}
              class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm md:h-10"
            >
              {label}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </div>

      {#if !bootstrap && scenarioId === null}
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <Label for="sim-start" class="text-[12.5px] font-medium">Start date</Label>
            <Input
              id="sim-start"
              type="date"
              bind:value={startDate}
              max={new Date().toISOString().slice(0, 10)}
              aria-invalid={dateProblem ? true : undefined}
              aria-describedby={dateProblem ? "sim-start-err" : undefined}
              class="num h-10 md:h-9"
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label for="sim-cash" class="text-[12.5px] font-medium">Starting cash</Label>
            <div class="relative">
              <span class="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px]">$</span>
              <Input id="sim-cash" type="number" inputmode="decimal" step="any" min="1" bind:value={cash} aria-invalid={cashProblem ? true : undefined} class="num h-10 pl-6 text-right md:h-9" />
            </div>
          </div>
        </div>
        {#if dateProblem}<p id="sim-start-err" class="text-destructive -mt-4 text-[12px]">{dateProblem}</p>{/if}
        {#if cashProblem}<p class="text-destructive -mt-4 text-[12px]">{cashProblem}</p>{/if}
      {:else}
        <div class="flex flex-col gap-1">
          <Label for="sim-cash" class="text-[12.5px] font-medium">Starting cash</Label>
          <div class="relative">
            <span class="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px]">$</span>
            <Input id="sim-cash" type="number" inputmode="decimal" step="any" min="1" bind:value={cash} aria-invalid={cashProblem ? true : undefined} class="num h-10 pl-6 text-right md:h-9" />
          </div>
        </div>
        {#if cashProblem}<p class="text-destructive -mt-4 text-[12px]">{cashProblem}</p>{/if}
      {/if}

      {#if bootstrap || scenarioId === null}
        <div class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between">
            <Label for="sim-days" class="text-[12.5px] font-medium">{bootstrap ? "Bootstrap days" : "Trading days"}</Label>
            <output for="sim-days" class="num text-[13px] font-medium">{days}</output>
          </div>
          <Slider
            id="sim-days"
            type="single"
            bind:value={days}
            min={minDays}
            max={maxDays}
            step={1}
            class="h-11 [&_[data-slot=slider-range]]:bg-lab [&_[data-slot=slider-thumb]]:border-lab"
            aria-label={bootstrap ? "Bootstrap days" : "Trading days"}
          />
        </div>
      {:else if scenario}
        <p class="text-muted-foreground num -mt-2 text-[12px]">{scenario.days} trading days from {scenario.startDate}.</p>
      {/if}

      <div class="flex flex-col gap-2">
        <span class="text-[12.5px] font-medium" id="sim-exec-label">Execution</span>
        <ToggleGroup.Root
          type="single"
          bind:value={() => execution, (v) => v && (execution = v as SimExecution)}
          aria-labelledby="sim-exec-label"
          class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
        >
          {#each [["realistic", "Realistic"], ["ideal", "Ideal"]] as [v, label] (v)}
            <ToggleGroup.Item
              value={v!}
              class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm md:h-10"
            >
              {label}
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        <p class="text-muted-foreground text-[12px] leading-snug">Realistic pays spread and slippage. Ideal fills at the limit.</p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <span class="text-[12.5px] font-medium" id="sim-model-label">Model</span>
          <ToggleGroup.Root
            type="single"
            bind:value={() => model, (v) => v && (model = v as "main" | "subagent")}
            aria-labelledby="sim-model-label"
            class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
          >
            {#each [["main", "Lead"], ["subagent", "Subagent"]] as [v, label] (v)}
              <ToggleGroup.Item
                value={v!}
                class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm md:h-10"
              >
                {label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="sim-seed" class="text-[12.5px] font-medium">Seed</Label>
          <Input
            id="sim-seed"
            bind:value={seed}
            placeholder="Random"
            inputmode="numeric"
            autocomplete="off"
            aria-invalid={seedProblem ? true : undefined}
            class="num h-11 md:h-10"
          />
          {#if seedProblem}<p class="text-destructive text-[12px]">{seedProblem}</p>{/if}
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-[12.5px] font-medium" id="sim-cycles-label">Cycles per day</span>
        <ToggleGroup.Root
          type="single"
          bind:value={() => cycles, (v) => v && (cycles = v)}
          aria-labelledby="sim-cycles-label"
          class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
        >
          {#each [["2", "Open · close"], ["3", "+ pre-open"], ["4", "+ midday"]] as [v, hint] (v)}
            <ToggleGroup.Item
              value={v!}
              class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 flex-col data-[state=on]:ring-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:shadow-sm md:h-10"
            >
              <span class="num text-[14px]">{v}</span>
              <span class="-mt-0.5 text-[10.5px] font-normal opacity-80">{hint}</span>
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
      </div>

      <section class="flex flex-col gap-2.5" aria-labelledby="sim-watch">
        <h3 id="sim-watch" class="label-caps">Watchlist</h3>
        <ul class="flex flex-wrap gap-1.5">
          {#each watchlist as t (t)}
            <li class="bg-secondary num flex h-8 items-center gap-1 rounded-md pr-1 pl-2.5 text-[12.5px] font-medium">
              {t}
              <button type="button" class="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 place-items-center rounded" aria-label={`Remove ${t}`} onclick={() => (watchlist = watchlist.filter((x) => x !== t))}>
                <Icon icon={Cancel01Icon} class="size-3.5" />
              </button>
            </li>
          {:else}
            <li class="text-muted-foreground text-[13px]">No tickers</li>
          {/each}
        </ul>
        <div class="flex gap-2">
          <Label for="sim-ticker" class="sr-only">Add tickers</Label>
          <Input
            id="sim-ticker"
            bind:value={tickerInput}
            placeholder="Add tickers"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            class="num h-10 md:h-9"
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTickers();
              }
            }}
          />
          <Button type="button" variant="outline" class="h-10 md:h-9" disabled={!tickerInput.trim()} onclick={addTickers}>Add</Button>
        </div>
        {#if tickerError}<p class="text-destructive text-[12px]">{tickerError}</p>{/if}
      </section>

      <div class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <Label for="sim-strategy" class="text-[12.5px] font-medium">Strategy</Label>
          <span class="num text-muted-foreground text-[11px]">{strategy.length}/2000</span>
        </div>
        <Textarea id="sim-strategy" bind:value={strategy} maxlength={2000} rows={4} placeholder="Instructions for this run's agent, for example a hypothesis to test" class="min-h-24 resize-y" />
      </div>

      <Collapsible.Root bind:open={riskOpen}>
        <Collapsible.Trigger class="hover:bg-muted/50 -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors">
          <Icon icon={ArrowRight01Icon} class={cn("text-muted-foreground size-3.5 transition-transform", riskOpen && "rotate-90")} />
          Risk overrides
          {#if Object.values(overrides).some((v) => v?.trim())}
            <span class="num text-lab ml-auto text-[12px]">{Object.values(overrides).filter((v) => v?.trim()).length} set</span>
          {/if}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="flex flex-col gap-5 pt-2">
            {#each RISK_GROUPS as group (group.title)}
              <div class="flex flex-col gap-2.5">
                <h4 class="label-caps">{group.title}</h4>
                <div class="grid grid-cols-2 gap-3">
                  {#each group.fields as f (f.key)}
                    <NumberField
                      id={`sim-r-${f.key}`}
                      label={f.label}
                      unit={f.unit}
                      step={f.step}
                      placeholder={live ? String(live.risk[f.key]) : ""}
                      bind:value={() => overrides[f.key] ?? "", (v) => (overrides[f.key] = v)}
                      error={risk.errors[`risk.${f.key}`]}
                    />
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </form>

    <Sheet.Footer class="border-border pb-safe flex-col gap-2 border-t sm:flex-col">
      {#if serverError}<p class="text-destructive text-[12.5px]" role="alert">{serverError}</p>{/if}
      <div class="flex items-center gap-3">
        <span class="num text-muted-foreground min-w-0 flex-1 text-[12px]">{daysLabel} · {estimate}</span>
        <Button type="submit" form="sim-form" class="bg-lab text-background hover:bg-lab/90 h-11 shrink-0 px-5 md:h-10" disabled={!canStart}>
          {#if sim.starting}<Icon icon={Loading03Icon} class="size-4 animate-spin" />{/if}
          Start simulation
        </Button>
      </div>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>
