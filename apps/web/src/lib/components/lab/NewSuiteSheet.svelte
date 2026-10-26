<script lang="ts">
  import type { SimExecution, SimSuiteConfig } from "@rh/shared";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Slider } from "$lib/components/ui/slider/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import Icon from "../Icon.svelte";
  import PaperBadge from "./PaperBadge.svelte";
  import { Loading03Icon, Tick02Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import { sim } from "$lib/sim.svelte";
  import { ui } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let name = $state("");
  let picked = $state<string[]>([]);
  let scenarioMode = $state<"historical" | "blind">("blind");
  let bootstrapRuns = $state(0);
  let bootstrapDays = $state(40);
  let execution = $state<SimExecution>("realistic");
  let cycles = $state("2");
  let cash = $state("1200");
  let variantCount = $state("2");
  let labelA = $state("A");
  let strategyA = $state("");
  let modelA = $state<"main" | "subagent">("main");
  let labelB = $state("B");
  let strategyB = $state("");
  let modelB = $state<"main" | "subagent">("subagent");
  let serverError = $state<string | null>(null);

  const scenarios = $derived(sim.scenarios);

  $effect(() => {
    if (!ui.newSuite) return;
    name = "";
    scenarioMode = "blind";
    bootstrapRuns = 0;
    bootstrapDays = 40;
    execution = "realistic";
    cycles = "2";
    cash = "1200";
    variantCount = "2";
    labelA = "A";
    strategyA = "";
    modelA = "main";
    labelB = "B";
    strategyB = "";
    modelB = "subagent";
    serverError = null;
    picked = scenarios.length ? [scenarios[0]!.id, scenarios[1]?.id ?? scenarios[0]!.id].filter((v, i, a) => a.indexOf(v) === i) : [];
    void sim.loadScenarios();
  });

  function toggleScenario(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(0, 12);
  }

  const two = $derived(variantCount === "2");
  const cashNum = $derived(Number(cash));
  const cashProblem = $derived(!Number.isFinite(cashNum) || cashNum <= 0 ? "Enter an amount above zero" : cashNum > 1_000_000 ? "Max $1,000,000" : null);
  const nameProblem = $derived(!name.trim() ? "Name the suite" : null);
  const markets = $derived(picked.length + bootstrapRuns);
  const marketsProblem = $derived(markets === 0 ? "Pick at least one scenario or bootstrap market" : null);
  const labelProblem = $derived(
    two && labelA.trim() && labelB.trim() && labelA.trim() === labelB.trim() ? "Variant labels must differ" : null,
  );
  const canStart = $derived(!nameProblem && !cashProblem && !marketsProblem && !labelProblem && !sim.startingSuite);

  async function start() {
    if (!canStart) return;
    serverError = null;
    const config: SimSuiteConfig = {
      name: name.trim(),
      scenarios: picked,
      bootstrapRuns,
      scenarioMode,
      bootstrapDays,
      startingCash: cashNum,
      cyclesPerDay: Number(cycles) as 2 | 3 | 4,
      execution,
      watchlist: harness.status?.settings.watchlist,
      variants: [
        { label: labelA.trim() || "A", ...(strategyA.trim() ? { strategy: strategyA.trim() } : {}), model: modelA },
        ...(two ? [{ label: labelB.trim() || "B", ...(strategyB.trim() ? { strategy: strategyB.trim() } : {}), model: modelB }] : []),
      ],
    };
    const res = await sim.startSuite(config);
    if ("error" in res) {
      serverError = res.error;
      return;
    }
    ui.newSuite = false;
    ui.labTab = "suites";
    ui.run = null;
    ui.suite = res.suite.id;
  }
</script>

<Sheet.Root bind:open={ui.newSuite}>
  <Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
    <Sheet.Header class="border-border border-b">
      <div class="flex items-center gap-2 pr-10">
        <Sheet.Title>New suite</Sheet.Title>
        <PaperBadge />
      </div>
      <Sheet.Description class="sr-only">Run every variant on identical markets and compare them</Sheet.Description>
    </Sheet.Header>

    <form
      id="suite-form"
      class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4"
      onsubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <div class="flex flex-col gap-1">
        <Label for="suite-name" class="text-[12.5px] font-medium">Name</Label>
        <Input
          id="suite-name"
          bind:value={name}
          maxlength={80}
          placeholder="Momentum vs defensive"
          autocomplete="off"
          class="h-10 md:h-9"
          aria-invalid={nameProblem ? true : undefined}
        />
        {#if nameProblem && name.length > 0}<p class="text-destructive text-[12px]">{nameProblem}</p>{/if}
      </div>

      <section class="flex flex-col gap-2" aria-labelledby="suite-scenarios">
        <h3 id="suite-scenarios" class="label-caps">Scenarios · {picked.length} picked</h3>
        {#if scenarios.length === 0}
          <p class="text-muted-foreground text-[13px]">The scenario library did not load. Add bootstrap markets below.</p>
        {:else}
          <div class="grid gap-2">
            {#each scenarios as s (s.id)}
              {@const selected = picked.includes(s.id)}
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                onclick={() => toggleScenario(s.id)}
                class={cn(
                  "border-border flex min-h-11 items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  selected ? "border-lab/60 bg-lab-bg" : "hover:bg-muted/40",
                )}
              >
                <span class={cn("border-input mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors", selected && "bg-lab border-lab text-background")}>
                  {#if selected}<Icon icon={Tick02Icon} class="size-3.5" strokeWidth={2.6} />{/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{s.name}</span>
                    <Badge variant="secondary" class="shrink-0 text-[10.5px] tracking-wide uppercase">{s.regime}</Badge>
                  </span>
                  <span class="text-muted-foreground line-clamp-2 text-[12px] leading-snug">{s.description}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      {#if picked.length > 0}
        <div class="flex flex-col gap-2">
          <span class="text-[12.5px] font-medium" id="suite-mode-label">Scenarios run</span>
          <ToggleGroup.Root
            type="single"
            bind:value={() => scenarioMode, (v) => v && (scenarioMode = v as "historical" | "blind")}
            aria-labelledby="suite-mode-label"
            class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
          >
            {#each [["blind", "Blind"], ["historical", "Historical"]] as [v, label] (v)}
              <ToggleGroup.Item
                value={v!}
                class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm md:h-10"
              >
                {label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
          <p class="text-muted-foreground text-[12px] leading-snug">Blind is recommended: it hides dates and tickers so memory cannot help.</p>
        </div>
      {/if}

      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <Label for="suite-bootstrap" class="text-[12.5px] font-medium">Bootstrap markets</Label>
          <output for="suite-bootstrap" class="num text-[13px] font-medium">{bootstrapRuns}</output>
        </div>
        <Slider
          id="suite-bootstrap"
          type="single"
          bind:value={bootstrapRuns}
          min={0}
          max={10}
          step={1}
          class="h-11 [&_[data-slot=slider-range]]:bg-lab [&_[data-slot=slider-thumb]]:border-lab"
          aria-label="Bootstrap markets"
        />
        {#if bootstrapRuns > 0}
          <div class="flex items-baseline justify-between pt-1">
            <Label for="suite-bdays" class="text-[12.5px] font-medium">Bootstrap days</Label>
            <output for="suite-bdays" class="num text-[13px] font-medium">{bootstrapDays}</output>
          </div>
          <Slider
            id="suite-bdays"
            type="single"
            bind:value={bootstrapDays}
            min={5}
            max={120}
            step={1}
            class="h-11 [&_[data-slot=slider-range]]:bg-lab [&_[data-slot=slider-thumb]]:border-lab"
            aria-label="Bootstrap days"
          />
        {/if}
        {#if marketsProblem}<p class="text-destructive text-[12px]">{marketsProblem}</p>{/if}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <span class="text-[12.5px] font-medium" id="suite-exec-label">Execution</span>
          <ToggleGroup.Root
            type="single"
            bind:value={() => execution, (v) => v && (execution = v as SimExecution)}
            aria-labelledby="suite-exec-label"
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
        </div>
        <div class="flex flex-col gap-1">
          <Label for="suite-cash" class="text-[12.5px] font-medium">Cash per run</Label>
          <div class="relative">
            <span class="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px]">$</span>
            <Input id="suite-cash" type="number" inputmode="decimal" step="any" min="1" bind:value={cash} aria-invalid={cashProblem ? true : undefined} class="num h-11 pl-6 text-right md:h-10" />
          </div>
        </div>
      </div>
      {#if cashProblem}<p class="text-destructive -mt-4 text-[12px]">{cashProblem}</p>{/if}

      <div class="flex flex-col gap-2">
        <span class="text-[12.5px] font-medium" id="suite-cycles-label">Cycles per day</span>
        <ToggleGroup.Root
          type="single"
          bind:value={() => cycles, (v) => v && (cycles = v)}
          aria-labelledby="suite-cycles-label"
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

      <div class="flex flex-col gap-2">
        <span class="text-[12.5px] font-medium" id="suite-count-label">Variants</span>
        <ToggleGroup.Root
          type="single"
          bind:value={() => variantCount, (v) => v && (variantCount = v)}
          aria-labelledby="suite-count-label"
          class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
        >
          <ToggleGroup.Item value="1" class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm md:h-10">One</ToggleGroup.Item>
          <ToggleGroup.Item value="2" class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-11 flex-1 rounded-[5px] px-2 text-[13px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm md:h-10">Two, compared</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>

      {#snippet variantEditor(prefix: string, label: () => string, setLabel: (v: string) => void, strategy: () => string, setStrategy: (v: string) => void, model: () => "main" | "subagent", setModel: (v: "main" | "subagent") => void)}
        <div class="border-border flex flex-col gap-3 rounded-lg border p-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1">
              <Label for={`${prefix}-label`} class="text-[12.5px] font-medium">Label</Label>
              <Input id={`${prefix}-label`} value={label()} oninput={(e) => setLabel(e.currentTarget.value)} maxlength={24} class="num h-10 text-center font-semibold md:h-9" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-[12.5px] font-medium" id={`${prefix}-model-label`}>Model</span>
              <ToggleGroup.Root
                type="single"
                value={model()}
                onValueChange={(v) => v && setModel(v as "main" | "subagent")}
                aria-labelledby={`${prefix}-model-label`}
                class="bg-muted/60 border-border flex w-full rounded-md border p-0.5"
              >
                <ToggleGroup.Item value="main" class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-10 flex-1 rounded-[5px] px-2 text-[12.5px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm">Lead</ToggleGroup.Item>
                <ToggleGroup.Item value="subagent" class="text-muted-foreground hover:text-foreground data-[state=on]:bg-lab/15 data-[state=on]:text-lab data-[state=on]:ring-lab/40 h-10 flex-1 rounded-[5px] px-2 text-[12.5px] font-medium data-[state=on]:ring-1 data-[state=on]:shadow-sm">Subagent</ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <Label for={`${prefix}-strategy`} class="text-[12.5px] font-medium">Strategy</Label>
            <Textarea id={`${prefix}-strategy`} value={strategy()} oninput={(e) => setStrategy(e.currentTarget.value)} maxlength={2000} rows={3} placeholder="What this variant does differently" class="resize-y" />
          </div>
        </div>
      {/snippet}

      {@render variantEditor("suite-a", () => labelA, (v) => (labelA = v), () => strategyA, (v) => (strategyA = v), () => modelA, (v) => (modelA = v))}
      {#if two}
        {@render variantEditor("suite-b", () => labelB, (v) => (labelB = v), () => strategyB, (v) => (strategyB = v), () => modelB, (v) => (modelB = v))}
      {/if}
      {#if labelProblem}<p class="text-destructive text-[12px]">{labelProblem}</p>{/if}

      <div class="flex flex-col gap-1">
        <span class="text-[12.5px] font-medium">Watchlist</span>
        <p class="text-muted-foreground text-[12px] leading-snug">Every run trades the live watchlist ({harness.status?.settings.watchlist.length ?? 0} tickers).</p>
      </div>
    </form>

    <Sheet.Footer class="border-border pb-safe flex-col gap-2 border-t sm:flex-col">
      {#if serverError}<p class="text-destructive text-[12.5px]" role="alert">{serverError}</p>{/if}
      <div class="flex items-center gap-3">
        <span class="num text-muted-foreground min-w-0 flex-1 text-[12px]">{markets} markets × {two ? 2 : 1} variant{two ? "s" : ""}</span>
        <Button type="submit" form="suite-form" class="bg-lab text-background hover:bg-lab/90 h-11 shrink-0 px-5 md:h-10" disabled={!canStart}>
          {#if sim.startingSuite}<Icon icon={Loading03Icon} class="size-4 animate-spin" />{/if}
          Start suite
        </Button>
      </div>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>
