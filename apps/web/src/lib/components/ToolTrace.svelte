<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import { Trace } from "$lib/components/ui/trace/index.js";
  import TraceCall from "./TraceCall.svelte";
  import TraceCallGroup from "./TraceCallGroup.svelte";
  import { useScope } from "$lib/scope";
  import { groupConsecutive, isMessageCall, matchSubmitOrder, type AnyCall } from "$lib/toolMeta";

  /** Consecutive tool messages as one Trace (AI Elements Task pattern). */
  let { messages }: { messages: ChatMessage[] } = $props();

  const scope = useScope();
  const groups = $derived(groupConsecutive(messages, (m) => m.toolName ?? "tool"));
  const orderFor = (item: AnyCall) =>
    isMessageCall(item) && item.toolName === "submit_order" ? matchSubmitOrder(item.text, scope.feed.orders) : undefined;
</script>

<Trace>
  {#each groups as group (group.items[0]?.id ?? group.name)}
    {@const first = group.items[0]}
    {#if first && group.items.length > 1}
      <TraceCallGroup name={group.name} items={group.items} getOrder={orderFor} simRunId={scope.simRunId} />
    {:else if first}
      <TraceCall call={first} order={orderFor(first)} simRunId={scope.simRunId} />
    {/if}
  {/each}
</Trace>
