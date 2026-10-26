<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import { Link04Icon, Loading03Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { bar = false }: { bar?: boolean } = $props();
  const broker = $derived(harness.status?.broker);
  const needsConnect = $derived(
    broker ? broker.state === "disconnected" || broker.state === "needs_auth" || broker.state === "error" : false,
  );
  const text = $derived(
    broker
      ? { connected: "Connected", disconnected: "Not connected", needs_auth: "Sign-in needed", connecting: "Connecting", error: "Error" }[broker.state]
      : "",
  );
</script>

{#if broker}
  <div class="flex items-center justify-between gap-2.5">
    <div class={cn("flex flex-col leading-tight", bar && needsConnect && "sr-only")}>
      <span class="text-[13px] font-medium">Robinhood</span>
      <span class={cn("flex items-center gap-1.5 text-[12px]", broker.state === "error" ? "text-destructive" : "text-muted-foreground")}>
        <span
          class={cn(
            "size-1.5 rounded-full",
            broker.state === "connected" ? "bg-live" : broker.state === "connecting" ? "bg-warn" : "bg-muted-foreground/60",
            broker.state === "error" && "bg-destructive",
          )}
        ></span>
        {text}
      </span>
    </div>
    {#if needsConnect}
      <Button size="sm" onclick={() => harness.connectRobinhood()} disabled={harness.busy.connect} class="h-8">
        <Icon icon={harness.busy.connect ? Loading03Icon : Link04Icon} class={cn("size-3.5", harness.busy.connect && "animate-spin")} />
        Connect Robinhood
      </Button>
    {/if}
  </div>
{:else}
  <div class="bg-muted h-8 w-32 animate-pulse rounded"></div>
{/if}
