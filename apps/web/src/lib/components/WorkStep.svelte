<script lang="ts">
  import type { ChatMessage, SubagentRun, ToolCallSummary } from "@rh/shared";
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
  import CodeBlock from "./CodeBlock.svelte";
  import Icon from "./Icon.svelte";
  import TraceCall from "./TraceCall.svelte";
  import TraceCallGroup from "./TraceCallGroup.svelte";
  import { CodeIcon, CommandIcon } from "$lib/icons";
  import { clock } from "$lib/clock.svelte";
  import { durationShort } from "$lib/format";
  import { matchRuns } from "$lib/steps";
  import { groupConsecutive, isMessageCall } from "$lib/toolMeta";
  import { useScope } from "$lib/scope";
  import { cn } from "$lib/utils.js";

  let { code, result, live = false, calls: liveCalls }: {
    code: ChatMessage;
    result?: ChatMessage;
    /** True while this is the running script; nested calls then come from live events. */
    live?: boolean;
    /** Override for transcripts that carry their own live calls. */
    calls?: ToolCallSummary[];
  } = $props();

  const scope = useScope();
  let userOpen = $state<boolean | undefined>(undefined);
  const open = $derived(userOpen ?? live);

  const calls = $derived(result?.calls ?? (live ? (liveCalls ?? scope.feed.calls) : []));
  const groups = $derived(groupConsecutive(calls, (c) => c.name));
  const failed = $derived(calls.filter((c) => c.isError).length);
  const runs = $derived(matchRuns(calls, scope.feed.subagents, code.at, (result?.at ?? clock.now) + 1000));
  const runByCall = $derived(
    new Map<ToolCallSummary, SubagentRun | undefined>(calls.map((c, i) => [c, runs[i]] as const)),
  );
  const elapsed = $derived.by(() => {
    if (result) {
      const wall = result.at - code.at;
      return wall > 0 ? wall : Math.max(0, ...calls.map((c) => c.durationMs ?? 0));
    }
    return live ? Math.max(0, clock.now - code.at) : undefined;
  });

  const countLabel = $derived(`${calls.length} ${calls.length === 1 ? "call" : "calls"}`);
  const summaryTitle = $derived.by(() => {
    if (live) {
      if (calls.length === 0) return "Working…";
      const e = elapsed !== undefined ? ` for ${durationShort(elapsed)}` : "";
      return `Working${e} · ${countLabel}`;
    }
    if (result) {
      const e = elapsed !== undefined ? ` for ${durationShort(elapsed)}` : "";
      const f = failed > 0 ? ` · ${failed} failed` : "";
      return `Worked${e} · ${countLabel}${f}`;
    }
    return "Script";
  });
  const status = $derived(live ? ("running" as const) : failed > 0 ? ("error" as const) : undefined);
  const label = $derived(status ? `${summaryTitle}, ${status}` : `${summaryTitle}, ${countLabel}`);

  const scriptLines = $derived(code.code ? code.code.split("\n").length : 0);
</script>

<div class="rise-in">
  <Trace>
    <TraceCollapsible {open} onOpenChange={(v) => (userOpen = v)}>
      <TraceCollapsibleTrigger aria-label={label}>
        <TraceLine {status}>
          <TraceIcon><Icon icon={CodeIcon} /></TraceIcon>
          <TraceTitle>{summaryTitle}</TraceTitle>
          {#if failed > 0 && !live}<TraceDescription>{failed} failed</TraceDescription>{/if}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {#each groups as group, gi (`${group.name}-${gi}`)}
            {@const first = group.items[0]}
            {#if first && group.items.length > 1}
              <TraceCallGroup
                name={group.name}
                items={group.items}
                getRun={(item) => (!isMessageCall(item) ? runByCall.get(item) : undefined)}
                simRunId={scope.simRunId}
              />
            {:else if first}
              <TraceCall call={first} run={runByCall.get(first)} simRunId={scope.simRunId} />
            {/if}
          {/each}
          {#if code.code}
            <TraceCollapsible>
              <TraceCollapsibleTrigger aria-label={`Script, ${scriptLines} lines`}>
                <TraceLine>
                  <TraceIcon><Icon icon={CodeIcon} /></TraceIcon>
                  <TraceTitle>Script</TraceTitle>
                  <TraceDescription>{scriptLines} {scriptLines === 1 ? "line" : "lines"}</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <CodeBlock code={code.code} class="text-foreground max-h-72" />
              </TraceCollapsibleContent>
            </TraceCollapsible>
          {/if}
          {#if result?.text}
            <TraceCollapsible>
              <TraceCollapsibleTrigger aria-label={result.isError ? "Output, failed" : "Output"}>
                <TraceLine status={result.isError ? "error" : undefined}>
                  <TraceIcon><Icon icon={CommandIcon} /></TraceIcon>
                  <TraceTitle>Output</TraceTitle>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <pre
                  class={cn(
                    "num bg-muted/50 max-h-56 overflow-auto rounded-md p-3 text-[12px] leading-relaxed break-words whitespace-pre-wrap",
                    result.isError ? "text-destructive" : "text-foreground",
                  )}>{result.text}</pre>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          {/if}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</div>
