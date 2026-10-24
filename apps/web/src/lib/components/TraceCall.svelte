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
  import RiskChecks from "./RiskChecks.svelte";
  import { ArrowUpRight01Icon, Link04Icon } from "$lib/icons";
  import { durationShort } from "$lib/format";
  import { isRunning } from "$lib/steps";
  import { openAgent } from "$lib/ui.svelte";
  import { ROLE_META } from "$lib/roles";
  import {
    callName,
    callSummary,
    delegateRole,
    extractUrls,
    firstLine,
    isMessageCall,
    sourceMeta,
    submitOrderFailed,
    toolIcon,
    toolTitle,
    type AnyCall,
  } from "$lib/toolMeta";
  import { cn } from "$lib/utils.js";

  /**
   * One tool call as a Trace line (AI Elements Tool pattern): family icon,
   * sentence title, duration or summary text as the description, running or
   * error status. Expands into the Sources pattern, the linked subagent or
   * risk checks, and the full text when there is more to show.
   */
  let {
    call,
    run,
    order,
    simRunId,
  }: {
    call: AnyCall;
    /** Matched subagent run for a `delegate` summary call. */
    run?: SubagentRun;
    /** Matched order for a `submit_order` message. */
    order?: OrderRecord;
    /** Simulation run that owns the transcript, to route the agent sheet back. */
    simRunId?: string;
  } = $props();

  const name = $derived(callName(call));
  const summary = $derived(callSummary(call) ?? (isMessageCall(call) ? call.text : undefined));
  const message = $derived(isMessageCall(call) ? call : undefined);
  const text = $derived(message?.text);
  const failed = $derived(call.isError === true || submitOrderFailed(order));
  const running = $derived(!isMessageCall(call) && isRunning(call));
  const status = $derived(failed ? ("error" as const) : running ? ("running" as const) : undefined);
  const icon = $derived(toolIcon(name, callSummary(call), message?.agentRole));
  const title = $derived(toolTitle(name, callSummary(call) ?? text));
  const urls = $derived(extractUrls(summary ?? text));
  const duration = $derived(!isMessageCall(call) && call.durationMs !== undefined ? durationShort(call.durationMs) : undefined);
  const description = $derived(duration ?? firstLine(text));

  const delegateTarget = $derived.by(() => {
    if (run) return { id: run.id, label: ROLE_META[run.role].label };
    const childId = message?.childConversationId;
    if (!childId) return undefined;
    return { id: childId, label: message?.agentRole ?? delegateRole({ summary: callSummary(call) }) ?? "agent" };
  });
  const detailText = $derived.by(() => {
    if (text === undefined || text.trim() === "") return undefined;
    const shown = firstLine(text);
    if (shown === undefined) return undefined;
    return text.trim().length > shown.length || text.includes("\n") ? text : undefined;
  });
  const expandable = $derived(
    order !== undefined || delegateTarget !== undefined || urls.length > 0 || detailText !== undefined,
  );
  const label = $derived(status ? `${title}, ${status}` : undefined);
</script>

{#snippet line()}
  <TraceLine {status} aria-label={label}>
    <TraceIcon><Icon {icon} /></TraceIcon>
    <TraceTitle>{title}</TraceTitle>
    {#if description}<TraceDescription class="truncate">{description}</TraceDescription>{/if}
  </TraceLine>
{/snippet}

{#snippet detail()}
  {#if delegateTarget}
    <button
      type="button"
      class="text-primary flex min-h-8 items-center text-[12px] hover:underline"
      onclick={() => openAgent(delegateTarget.id, simRunId)}
    >
      Open {delegateTarget.label} transcript
    </button>
  {/if}
  {#if order}
    <RiskChecks verdict={order.verdict} />
  {/if}
  {#if urls.length > 0}
    <TraceCollapsible>
      <TraceCollapsibleTrigger aria-label={`Used ${urls.length} ${urls.length === 1 ? "source" : "sources"}`}>
        <TraceLine>
          <TraceIcon><Icon icon={Link04Icon} /></TraceIcon>
          <TraceTitle>Used {urls.length} {urls.length === 1 ? "source" : "sources"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {#each urls as url (url)}
            {@const meta = sourceMeta(url)}
            <a href={url} target="_blank" rel="noopener noreferrer">
              <TraceLine>
                <TraceIcon>
                  <span class="relative block size-4">
                    <Icon icon={Link04Icon} class="absolute inset-0 size-4" />
                    <img
                      src={`https://${meta.host}/favicon.ico`}
                      alt=""
                      loading="lazy"
                      class="absolute inset-0 size-4 rounded-full"
                      onerror={(e) => e.currentTarget.remove()}
                    />
                  </span>
                </TraceIcon>
                <TraceTitle>{meta.label}<span class="sr-only"> (opens in a new tab)</span></TraceTitle>
                <TraceIcon><Icon icon={ArrowUpRight01Icon} /></TraceIcon>
              </TraceLine>
            </a>
          {/each}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  {/if}
  {#if detailText}
    <pre
      class={cn(
        "num text-muted-foreground bg-muted/50 max-h-72 overflow-auto rounded-md p-2.5 text-[12px] leading-relaxed break-words whitespace-pre-wrap",
        failed && "text-destructive",
      )}>{detailText}</pre>
  {/if}
{/snippet}

{#if expandable}
  <TraceCollapsible>
    <TraceCollapsibleTrigger aria-label={label}>
      {@render line()}
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <div class="flex min-w-0 flex-col gap-2">
        {@render detail()}
      </div>
    </TraceCollapsibleContent>
  </TraceCollapsible>
{:else}
  {@render line()}
{/if}
