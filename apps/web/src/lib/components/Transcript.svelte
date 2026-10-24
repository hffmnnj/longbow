<script lang="ts">
  import type { ChatMessage, JournalEntry, OrderRecord, ToolCallSummary } from "@rh/shared";
  import CycleDivider from "./CycleDivider.svelte";
  import DecisionCard from "./DecisionCard.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import ToolTrace from "./ToolTrace.svelte";
  import WorkStep from "./WorkStep.svelte";
  import { Loading03Icon } from "$lib/icons";
  import { etTime } from "$lib/format";
  import { buildItems, liveStepKey, withDecisions } from "$lib/steps";
  import { harness } from "$lib/store.svelte";
  import type { OutboxItem } from "$lib/reducer";

  let { messages, draft = "", calls, running = false, outbox = [], agentLabel = "Agent", decisions = [], orders = [] }: {
    /** Journal entries to show in place among the messages. */
    decisions?: JournalEntry[];
    orders?: OrderRecord[];
    messages: ChatMessage[];
    draft?: string;
    /** Live nested calls for the trailing running script. */
    calls?: ToolCallSummary[];
    running?: boolean;
    outbox?: OutboxItem[];
    agentLabel?: string;
  } = $props();

  const items = $derived(withDecisions(buildItems(messages), decisions));
  const orderById = $derived(new Map(orders.map((o) => [o.id, o])));
  const liveKey = $derived(running ? liveStepKey(items) : undefined);
  const lastIsLiveStep = $derived(liveKey !== undefined && liveKey === items.findLast((i) => i.kind === "step")?.key);
</script>

{#each items as item (item.key)}
  {#if item.kind === "cycle"}
    <div class="rise-in pt-2"><CycleDivider message={item.message} /></div>
  {:else if item.kind === "step"}
    <WorkStep code={item.code} result={item.result} live={item.key === liveKey} {calls} />
  {:else if item.kind === "decision"}
    <div class="rise-in"><DecisionCard entry={item.entry} order={item.entry.orderId ? orderById.get(item.entry.orderId) : undefined} /></div>
  {:else if item.kind === "tools"}
    <div class="rise-in"><ToolTrace messages={item.messages} /></div>
  {:else if item.kind === "user"}
    <div class="rise-in flex flex-col items-end gap-1">
      <div class="bg-accent max-w-[85%] rounded-xl rounded-br-sm px-3.5 py-2 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
        {item.message.text}
      </div>
      <span class="num text-muted-foreground text-[11px]">You · {etTime(item.message.at)}</span>
    </div>
  {:else}
    <article class="rise-in flex flex-col gap-1">
      <span class="text-muted-foreground text-[11px]">
        {agentLabel} · <span class="num">{etTime(item.message.at)}</span>
      </span>
      <div class="text-[14px]"><Markdown text={item.message.text} /></div>
    </article>
  {/if}
{/each}

{#each outbox as o (o.id)}
  <div class="rise-in flex flex-col items-end gap-1">
    <div class={`bg-accent max-w-[85%] rounded-xl rounded-br-sm px-3.5 py-2 text-[14px] leading-relaxed break-words whitespace-pre-wrap ${o.failed ? "opacity-70" : "opacity-60"}`}>
      {o.text}
    </div>
    {#if o.failed}
      <span class="text-destructive flex items-center gap-2 text-[11px]">
        Not sent
        <button class="underline" onclick={() => harness.send(o.text, o.id)}>Retry</button>
        <button class="text-muted-foreground underline" onclick={() => harness.discardOutbox(o.id)}>Discard</button>
      </span>
    {:else}
      <span class="num text-muted-foreground text-[11px]">Sending…</span>
    {/if}
  </div>
{/each}

{#if draft}
  <article class="flex flex-col gap-1" aria-label={`${agentLabel} is writing`}>
    <span class="text-live text-[11px]">{agentLabel} · writing</span>
    <div class="stream-caret text-[14px]"><Markdown text={draft} /></div>
  </article>
{:else if running && !lastIsLiveStep}
  <div class="text-live flex items-center gap-1.5 text-[12px]">
    <Icon icon={Loading03Icon} class="size-3.5 animate-spin" /> Working
  </div>
{/if}
