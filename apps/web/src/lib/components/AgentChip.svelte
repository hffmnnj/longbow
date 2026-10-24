<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import { Loading03Icon, PlayIcon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import { clock } from "$lib/clock.svelte";
  import { countdown, etTime } from "$lib/format";
  import { cn } from "$lib/utils.js";

  const agent = $derived(harness.status?.agent);
  const label = $derived(
    agent ? { idle: "Agent idle", running: "Agent working", error: "Agent error", needs_login: "Agent needs login" }[agent.state] : "",
  );
</script>

{#if agent}
  <div class="flex items-center justify-between gap-2.5">
    <div class="flex flex-col leading-tight">
      <span class="flex items-center gap-1.5 text-[13px] font-medium">
        {#if agent.state === "running"}
          <Icon icon={Loading03Icon} class="text-live size-3.5 animate-spin" />
        {:else}
          <span class={cn("size-1.5 rounded-full", agent.state === "idle" ? "bg-muted-foreground/60" : "bg-warn")}></span>
        {/if}
        {label}
      </span>
      <span class="text-muted-foreground text-[12px]" title={agent.lastError}>
        {#if agent.state === "error" && agent.lastError}
          <span class="text-destructive block max-w-48 truncate">{agent.lastError}</span>
        {:else if agent.nextCycleAt}
          Next <span class="num text-foreground/85">{etTime(agent.nextCycleAt)}</span>
          <span class="num"> · {countdown(agent.nextCycleAt - clock.now)}</span>
        {:else}
          No cycle scheduled
        {/if}
      </span>
    </div>
    <Button
      size="sm"
      variant="outline"
      class="h-8"
      onclick={() => harness.runCycle()}
      disabled={agent.state === "running" || harness.busy.cycle}
    >
      <Icon icon={PlayIcon} class="size-3.5" />
      Run now
    </Button>
  </div>
{:else}
  <div class="bg-muted h-8 w-40 animate-pulse rounded"></div>
{/if}
