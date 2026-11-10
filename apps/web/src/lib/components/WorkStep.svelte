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
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import CodeBlock from "./CodeBlock.svelte";
  import Icon from "./Icon.svelte";
  import TraceCall from "./TraceCall.svelte";
  import TraceCallGroup from "./TraceCallGroup.svelte";
  import { CodeIcon, File01Icon } from "$lib/icons";
  import { toast } from "svelte-sonner";
  import { isNativeApp, nativeCall } from "$lib/native";
  import { clock } from "$lib/clock.svelte";
  import { durationShort } from "$lib/format";
  import { isRunning, isStepFailed, matchRuns, stepStatus } from "$lib/steps";
  import { groupConsecutive, isMessageCall, toolTitle } from "$lib/toolMeta";
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
  let detailsOpen = $state(false);
  let detailsPicked = $state<string | undefined>(undefined);
  const detailsTab = $derived(detailsPicked ?? (code.code ? "script" : "result"));

  const calls = $derived(result?.calls ?? (live ? (liveCalls ?? scope.feed.calls) : []));
  const groups = $derived(groupConsecutive(calls, (c) => c.name));
  const failedCalls = $derived(calls.filter((c) => c.isError).length);
  const resultFailed = $derived(result?.isError === true);
  const failed = $derived(isStepFailed(calls, result));
  const status = $derived(stepStatus(live, calls, result));
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
  const elapsedLabel = $derived(elapsed !== undefined ? ` · ${durationShort(elapsed)} elapsed` : "");
  const metadata = $derived(`${countLabel}${elapsedLabel}`);
  // Outcome once in the title; count/elapsed/failure live in the wrappable
  // secondary slot so narrow widths reflow instead of truncating mid-fact.
  const summaryTitle = $derived.by(() => {
    if (live) return calls.length === 0 ? "Using tools…" : "Using tools";
    if (result) return failed ? "Tool run failed" : "Tools completed";
    return "Script";
  });
  /** The newest still-running nested call; its title replaces a vague "Working". */
  const runningCall = $derived(live ? [...calls].reverse().find((c) => isRunning(c)) ?? calls.at(-1) : undefined);
  const runningTitle = $derived(runningCall ? toolTitle(runningCall.name, runningCall.summary) : undefined);
  const description = $derived.by(() => {
    if (live) return runningTitle ? `${runningTitle} · ${metadata}` : "Starting…";
    if (!result) return undefined;
    if (failed) return failedCalls > 0 ? `${failedCalls} failed · ${metadata}` : metadata;
    return metadata;
  });
  const label = $derived(
    live
      ? `${summaryTitle} · ${metadata}${runningTitle ? ` · ${runningTitle}` : ""}, running`
      : failed && failedCalls > 0
        ? `${summaryTitle} · ${failedCalls} failed · ${metadata}`
        : `${summaryTitle} · ${metadata}`,
  );

  const scriptLines = $derived(code.code ? code.code.split("\n").length : 0);
  const detailsSummary = $derived.by(() => {
    const left = code.code ? `Script` : "No script";
    if (!result) return live ? `${left} · running` : `${left} · no result yet`;
    return `${left} · ${resultFailed ? "output failed" : "output"}`;
  });

  async function copyText(text: string, what: string) {
    if (isNativeApp()) {
      try {
        await nativeCall("copy", { text });
        toast.success(`${what} copied`);
      } catch {
        toast.error(`Could not copy the ${what.toLowerCase()}`);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}`);
    }
  }
</script>

<div class="rise-in">
  <Trace>
    <TraceCollapsible {open} onOpenChange={(v) => (userOpen = v)}>
      <TraceCollapsibleTrigger aria-label={label}>
        <TraceLine {status}>
          <TraceIcon><Icon icon={CodeIcon} /></TraceIcon>
          <TraceTitle>{summaryTitle}</TraceTitle>
          {#if description}<TraceDescription class="min-w-0 shrink overflow-visible whitespace-normal">{description}</TraceDescription>{/if}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {#if groups.length === 0}
            <p class="text-muted-foreground px-1 py-1 text-[12px]">
              {#if live}Starting… calls appear here as they run.
              {:else if result}No tool calls recorded.
              {:else}Waiting for the script result.{/if}
            </p>
          {:else}
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
          {/if}
          <TraceCollapsible open={detailsOpen} onOpenChange={(v) => (detailsOpen = v)}>
            <TraceCollapsibleTrigger aria-label={`Details: script and result, ${detailsSummary}`}>
              <TraceLine status={resultFailed ? "error" : undefined}>
                <TraceIcon><Icon icon={File01Icon} /></TraceIcon>
                <TraceTitle>Details</TraceTitle>
                <TraceDescription class="truncate">{detailsSummary}</TraceDescription>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              {#if detailsOpen}
                <Tabs.Root bind:value={() => detailsTab, (v) => (detailsPicked = v)} class="flex min-w-0 flex-col gap-2">
                  <Tabs.List class="w-fit">
                    <Tabs.Trigger value="script">Script{#if scriptLines} · {scriptLines}{/if}</Tabs.Trigger>
                    <Tabs.Trigger value="result">Result{#if resultFailed} · failed{/if}</Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content value="script" class="min-w-0">
                    {#if code.code}
                      <div class="mb-1 flex items-center justify-end">
                        <Button variant="ghost" size="xs" onclick={() => void copyText(code.code!, "Script")}>Copy</Button>
                      </div>
                      <CodeBlock code={code.code} class="text-foreground max-h-72" />
                    {:else}
                      <p class="text-muted-foreground px-1 py-1 text-[12px]">No script recorded.</p>
                    {/if}
                  </Tabs.Content>
                  <Tabs.Content value="result" class="min-w-0">
                    {#if result?.text}
                      <div class="mb-1 flex items-center justify-end">
                        <Button variant="ghost" size="xs" onclick={() => void copyText(result!.text, "Result")}>Copy</Button>
                      </div>
                      <pre
                        class={cn(
                          "num bg-muted/50 max-h-56 overflow-auto rounded-md p-3 text-[12px] leading-relaxed break-words whitespace-pre-wrap",
                          resultFailed ? "text-destructive" : "text-foreground",
                        )}>{result.text}</pre>
                    {:else if live}
                      <p class="text-muted-foreground px-1 py-1 text-[12px]">Running… the result appears here when the script finishes.</p>
                    {:else if result}
                      <p class={cn("px-1 py-1 text-[12px]", resultFailed ? "text-destructive" : "text-muted-foreground")}>
                        {resultFailed ? "The script failed with no output text." : "The script finished with no output text."}
                      </p>
                    {:else}
                      <p class="text-muted-foreground px-1 py-1 text-[12px]">No result yet.</p>
                    {/if}
                  </Tabs.Content>
                </Tabs.Root>
              {/if}
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</div>
