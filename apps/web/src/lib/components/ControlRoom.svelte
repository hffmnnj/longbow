<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import DataState from "./viz/DataState.svelte";
  import Panel from "./viz/Panel.svelte";
  import DecisionCard from "./DecisionCard.svelte";
  import Icon from "./Icon.svelte";
  import KillSwitch from "./KillSwitch.svelte";
  import ModeControl from "./ModeControl.svelte";
  import { AiBrain01Icon, Cancel01Icon, Chip02Icon, Clock01Icon, Loading03Icon, LockIcon, PlayIcon, PowerIcon, Tick02Icon } from "$lib/icons";
  import { clock } from "$lib/clock.svelte";
  import { controlState, parseModelSpec, type Capability } from "$lib/control";
  import { ago, countdown, etTime } from "$lib/format";
  import { ROLE_META } from "$lib/roles";
  import { harness } from "$lib/store.svelte";
  import { openAgent } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  const status = $derived(harness.status);
  const state = $derived(status ? controlState(status) : undefined);
  const agent = $derived(status?.agent);
  const broker = $derived(status?.broker);
  const market = $derived(status?.market);

  const runs = $derived(harness.subagents.filter((r) => !r.background && r.status === "running"));
  const helpers = $derived(harness.subagents.filter((r) => r.background));
  const recent = $derived(harness.journal.filter((j) => j.action !== "none").slice(0, 4));
  const orders = $derived(new Map(harness.orders.map((o) => [o.id, o])));

  const HALT_LABEL = { kill_switch: "Kill switch engaged", mode_off: "Mode is Off", daily_loss: "Daily loss limit reached", drawdown: "Monthly drawdown halt", broker_disconnected: "Robinhood disconnected" } as const;
  const BROKER_LABEL = { connected: "Connected", disconnected: "Not connected", needs_auth: "Sign-in needed", connecting: "Connecting", error: "Error" } as const;
  const SESSION_LABEL = { regular: "Market open", pre: "Pre-market", post: "After hours", closed: "Market closed" } as const;
  const AGENT_LABEL = { idle: "Idle", running: "Working", error: "Error", needs_login: "Needs login" } as const;
  const cap = (c: Capability) => ({ yes: { icon: Tick02Icon, cls: "text-gain", word: "On" }, gated: { icon: Clock01Icon, cls: "text-warn", word: "Needs you" }, no: { icon: Cancel01Icon, cls: "text-muted-foreground", word: "Off" } })[c.state];

  function model(spec: string | undefined) {
    return spec ? parseModelSpec(spec) : undefined;
  }
  const lead = $derived(model(status?.models?.main ?? agent?.model));
  const subs = $derived(model(status?.models?.subagents));
  const row = "flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]";
</script>

<div class="mx-auto flex w-full max-w-[1100px] flex-col gap-3">
  {#if !status || !state}
    <div class="bg-muted/50 h-56 animate-pulse rounded-lg" aria-hidden="true"></div>
  {:else}
    <!-- Authority: what the system may do right now, who decides, how to stop it. -->
    <section
      aria-labelledby="authority"
      class={cn(
        "bg-card flex flex-col gap-4 rounded-lg border p-4",
        state.authority === "killed" && "border-destructive bg-destructive/8",
        state.authority === "auto" && "border-warn/60",
      )}
    >
      <div class="flex flex-wrap items-start gap-3">
        <span
          class={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg",
            state.authority === "killed" ? "bg-destructive text-background" : state.authority === "auto" ? "bg-warn-bg text-warn" : "bg-secondary text-foreground",
          )}
        >
          <Icon icon={state.authority === "killed" ? PowerIcon : LockIcon} class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 id="authority" class="text-[18px] leading-tight font-semibold">{state.headline}</h2>
          <p class="text-muted-foreground mt-0.5 text-[13px]">{state.detail}</p>
          {#if state.liveLocked && state.authority === "killed"}<p class="text-muted-foreground mt-0.5 text-[12.5px]">Live trading is also locked on the server.</p>{/if}
          {#if state.authority === "locked"}<p class="text-muted-foreground mt-0.5 text-[12.5px]">Mode is {status.settings.mode === "off" ? "Off" : status.settings.mode === "approve" ? "Approve" : "Auto"}, but the server lock overrides it.</p>{/if}
        </div>
        <KillSwitch class="h-11 shrink-0 md:h-10" />
      </div>

      <div class="flex flex-col gap-1.5">
        <h3 class="label-caps">Mode</h3>
        <ModeControl block class="sm:max-w-sm" />
      </div>

      <div>
        <h3 class="label-caps mb-1.5">What it can do right now</h3>
        <ul class="border-border divide-border divide-y rounded-md border">
          {#each state.capabilities as c (c.key)}
            {@const v = cap(c)}
            <li class="flex items-center gap-3 px-3 py-2 text-[13px]">
              <Icon icon={v.icon} class={cn("size-4 shrink-0", v.cls)} strokeWidth={2.2} />
              <span class="min-w-0 flex-1">
                <span class="block">{c.label}</span>
                <span class="text-muted-foreground block text-[12px]">{c.detail}</span>
              </span>
              <span class={cn("shrink-0 text-[11.5px] font-medium", v.cls)}>{v.word}</span>
            </li>
          {/each}
        </ul>
      </div>

      {#if status.halts.length > 0}
        <ul class="flex flex-wrap gap-1.5" aria-label="Active halts">
          {#each status.halts as h (h)}<li class="bg-warn-bg text-warn rounded px-2 py-1 text-[12px] font-medium">{HALT_LABEL[h]}</li>{/each}
        </ul>
      {/if}
    </section>

    <div class="grid gap-3 lg:grid-cols-2">
      <Panel title="Models">
        <dl class="divide-border divide-y">
          {#each [{ label: "Lead agent", m: lead, icon: AiBrain01Icon }, { label: "Subagents", m: subs, icon: Chip02Icon }] as r (r.label)}
            <div class={row}>
              <dt class="text-muted-foreground flex items-center gap-2"><Icon icon={r.icon} class="size-4" />{r.label}</dt>
              <dd class="num min-w-0 truncate text-right">
                {#if r.m}
                  {r.m.model}{#if r.m.thinking}<span class="text-muted-foreground">&nbsp;·&nbsp;{r.m.thinking}</span>{/if}
                  {#if r.m.provider}<span class="text-muted-foreground block text-[11.5px]">{r.m.provider}</span>{/if}
                {:else}&mdash;{/if}
              </dd>
            </div>
          {/each}
        </dl>
      </Panel>

      <Panel title="Connections and cycle">
        <dl class="divide-border divide-y">
          <div class={row}>
            <dt class="text-muted-foreground">Robinhood</dt>
            <dd class="flex items-center gap-2">
              <span class={cn("size-1.5 rounded-full", broker?.state === "connected" ? "bg-live" : broker?.state === "error" ? "bg-destructive" : "bg-muted-foreground/60")}></span>
              {broker ? BROKER_LABEL[broker.state] : "\u2014"}
              {#if broker && broker.state !== "connected" && broker.state !== "connecting"}
                <Button size="sm" class="h-8" onclick={() => harness.connectRobinhood()} disabled={harness.busy.connect}>Connect</Button>
              {/if}
            </dd>
          </div>
          <div class={row}>
            <dt class="text-muted-foreground">Market</dt>
            <dd>{market ? SESSION_LABEL[market.session] : "\u2014"}</dd>
          </div>
          <div class={row}>
            <dt class="text-muted-foreground">Agent</dt>
            <dd class="flex items-center gap-1.5">
              {#if agent?.state === "running"}<Icon icon={Loading03Icon} class="text-live size-3.5 animate-spin" />{/if}
              {agent ? AGENT_LABEL[agent.state] : "\u2014"}
            </dd>
          </div>
          <div class={row}>
            <dt class="text-muted-foreground">Last cycle</dt>
            <dd class="num">{agent?.lastCycleAt ? ago(agent.lastCycleAt, clock.now) : "\u2014"}</dd>
          </div>
          <div class={row}>
            <dt class="text-muted-foreground">Next cycle</dt>
            <dd class="flex items-center gap-2">
              <span class="num">{agent?.nextCycleAt ? `${etTime(agent.nextCycleAt)} · in ${countdown(agent.nextCycleAt - clock.now)}` : "Not scheduled"}</span>
              <Button size="sm" variant="outline" class="h-8" onclick={() => harness.runCycle()} disabled={agent?.state === "running" || harness.busy.cycle}>
                <Icon icon={PlayIcon} class="size-3.5" />Run now
              </Button>
            </dd>
          </div>
        </dl>
      </Panel>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <Panel title="Working now" reading={runs.length ? `${runs.length} subagent${runs.length === 1 ? "" : "s"} running` : "No subagents running"}>
        {#if runs.length > 0}
          <ul class="divide-border divide-y">
            {#each runs as r (r.id)}
              {@const meta = ROLE_META[r.role]}
              <li>
                <button class="hover:bg-muted/50 flex min-h-11 w-full items-start gap-2.5 px-3.5 py-2.5 text-left" onclick={() => openAgent(r.id)}>
                  <Icon icon={meta.icon} class="text-live mt-0.5 size-4 shrink-0" />
                  <span class="min-w-0 flex-1">
                    <span class="block text-[13px] font-medium">{meta.label}{#if r.symbol}<span class="num font-normal">&nbsp;on {r.symbol}</span>{/if}</span>
                    <span class="text-muted-foreground line-clamp-2 block text-[12px]">{r.task}</span>
                  </span>
                  <span class="num text-muted-foreground shrink-0 text-[11.5px]">{ago(r.startedAt, clock.now)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </Panel>

      <Panel title="Long-running helpers" reading={helpers.length ? `${helpers.filter((h) => h.status === "running").length} working, ${helpers.filter((h) => h.status !== "running").length} idle` : "None started"}>
        {#if helpers.length > 0}
          <ul class="divide-border divide-y">
            {#each helpers as h (h.id)}
              {@const meta = ROLE_META[h.role]}
              <li>
                <button class="hover:bg-muted/50 flex min-h-11 w-full items-start gap-2.5 px-3.5 py-2.5 text-left" onclick={() => openAgent(h.id)}>
                  <Icon icon={meta.icon} class={cn("mt-0.5 size-4 shrink-0", h.status === "running" ? "text-live" : "text-muted-foreground")} />
                  <span class="min-w-0 flex-1">
                    <span class="block text-[13px] font-medium">{h.name ?? meta.label}<span class="text-muted-foreground font-normal">&nbsp;·&nbsp;{meta.label}</span></span>
                    <span class="text-muted-foreground line-clamp-2 block text-[12px]">{h.task}</span>
                  </span>
                  <span class={cn("shrink-0 rounded px-1.5 text-[11px] font-medium", h.status === "running" ? "bg-live/15 text-live" : h.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
                    {h.status === "running" ? "Working" : h.status === "failed" ? "Failed" : "Idle"}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </Panel>
    </div>

    <Panel title="What it just did" reading={recent.length ? undefined : "No decisions recorded yet"}>
      {#if recent.length > 0}
        <ul class="flex flex-col gap-2 px-3.5 pb-3.5">
          {#each recent as e (e.id)}
            <li><DecisionCard entry={e} order={e.orderId ? orders.get(e.orderId) : undefined} /></li>
          {/each}
        </ul>
      {/if}
    </Panel>
  {/if}
</div>
