<script lang="ts">
  import type { OrderRecord, SubagentRun } from "@rh/shared";
  import {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceDescription,
    TraceIcon,
    TraceLine,
    TraceTitle,
  } from "$lib/components/ui/trace/index.js";
  import Icon from "./Icon.svelte";
  import TraceCall from "./TraceCall.svelte";
  import { durationShort } from "$lib/format";
  import { isRunning } from "$lib/steps";
  import { humanize, isMessageCall, toolIcon, type AnyCall } from "$lib/toolMeta";

  /**
   * A long run of the same tool as one collapsible Trace line
   * ("Market indicators ×11"), expanding into one line per call.
   */
  let {
    name,
    items,
    getRun,
    getOrder,
    simRunId,
  }: {
    name: string;
    items: AnyCall[];
    getRun?: (item: AnyCall) => SubagentRun | undefined;
    getOrder?: (item: AnyCall) => OrderRecord | undefined;
    simRunId?: string;
  } = $props();

  const failed = $derived(items.filter((c) => c.isError).length);
  const running = $derived(items.filter((c) => !isMessageCall(c) && isRunning(c)).length);
  const status = $derived(failed > 0 ? ("error" as const) : running > 0 ? ("running" as const) : undefined);
  const totalMs = $derived(
    items.reduce((a, c) => a + (!isMessageCall(c) && c.durationMs !== undefined ? c.durationMs : 0), 0),
  );
  const parts = $derived([
    ...(totalMs > 0 ? [durationShort(totalMs)] : []),
    `${items.length} ${items.length === 1 ? "call" : "calls"}`,
  ]);
  const label = $derived(
    `${humanize(name)} ×${items.length}, ${parts.join(", ")}${status ? `, ${status}` : ""}`,
  );
</script>

<TraceCollapsible>
  <TraceCollapsibleTrigger aria-label={label}>
    <TraceLine {status}>
      <TraceIcon><Icon icon={toolIcon(name)} /></TraceIcon>
      <TraceTitle>{humanize(name)} ×{items.length}</TraceTitle>
      <TraceDescription>{parts.join(" · ")}</TraceDescription>
    </TraceLine>
  </TraceCollapsibleTrigger>
  <TraceCollapsibleContent>
    <Trace>
      {#each items as item, i (i)}
        <TraceCall call={item} run={getRun?.(item)} order={getOrder?.(item)} {simRunId} />
      {/each}
    </Trace>
  </TraceCollapsibleContent>
</TraceCollapsible>
