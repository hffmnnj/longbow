<script lang="ts">
  import type { ChatMessage, ToolCallSummary } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import CodeBlock from "./CodeBlock.svelte";
  import Icon from "./Icon.svelte";
  import { AlertCircleIcon, ArrowRight01Icon, ArrowUpRight01Icon, CodeIcon, Tick02Icon } from "$lib/icons";
  import { clock } from "$lib/clock.svelte";
  import { durationShort } from "$lib/format";
  import { groupCalls, isRunning, matchRuns, type CallChip } from "$lib/steps";
  import { useScope } from "$lib/scope";
  import { openAgent } from "$lib/ui.svelte";
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
  let open = $state(false);
  const chipClass = "num border-border bg-background/60 inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11.5px]";

  const calls = $derived(result?.calls ?? (live ? (liveCalls ?? scope.feed.calls) : []));
  const chips = $derived(groupCalls(calls));
  const failed = $derived(calls.filter((c) => c.isError).length);
  const running = $derived(calls.filter(isRunning).length);
  const runs = $derived(matchRuns(calls, scope.feed.subagents, code.at, (result?.at ?? clock.now) + 1000));
  const elapsed = $derived.by(() => {
    if (result) {
      const wall = result.at - code.at;
      return wall > 0 ? wall : Math.max(0, ...calls.map((c) => c.durationMs ?? 0));
    }
    return live ? Math.max(0, clock.now - code.at) : undefined;
  });

  function openDelegate(name: string) {
    const hit = runs.find((r, i) => r && calls[i]?.name === name) ?? scope.feed.subagents[0];
    if (hit) openAgent(hit.id, scope.simRunId);
  }
</script>

{#snippet chipBody(chip: CallChip)}
  {#if chip.running > 0}
    <span class="bg-live soft-pulse size-1.5 shrink-0 rounded-full" role="img" aria-label="running"></span>
  {/if}
  {chip.label}
  {#if chip.failed > 0}<span class="opacity-80">· {chip.failed} failed</span>{/if}
{/snippet}

<Collapsible.Root bind:open>
  <div class="rise-in border-border/70 bg-card/40 rounded-lg border">
    <Collapsible.Trigger
      class="hover:bg-muted/50 flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors"
      aria-label={`${live ? "Working" : "Worked"}, ${calls.length} calls`}
    >
      <Icon icon={ArrowRight01Icon} class={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-90")} />
      <Icon icon={CodeIcon} class="text-muted-foreground size-3.5 shrink-0" />
      <span class="font-medium">{live ? "Working" : result ? "Worked" : "Script"}</span>
      {#if calls.length > 0}<span class="num text-muted-foreground">{calls.length} {calls.length === 1 ? "call" : "calls"}</span>{/if}
      {#if live && running > 0}<span class="bg-live soft-pulse size-1.5 rounded-full" aria-hidden="true"></span>{/if}
      <span class="flex-1"></span>
      {#if failed > 0}
        <span class="text-destructive border-destructive/40 num shrink-0 rounded border px-1.5 text-[11px]">{failed} failed</span>
      {/if}
      {#if elapsed !== undefined}<span class="num text-muted-foreground shrink-0">{durationShort(elapsed)}</span>{/if}
    </Collapsible.Trigger>

    {#if chips.length > 0}
      <ul class="flex flex-wrap gap-1.5 px-2.5 pb-2.5" aria-label="Calls">
        {#each chips as chip (chip.name)}
          {@const delegate = chip.name.endsWith("delegate")}
          <li>
            {#if delegate}
              <button
                type="button"
                onclick={() => openDelegate(chip.name)}
                class={cn(chipClass, "hover:border-primary/60 hover:text-primary focus-visible:border-primary transition-colors", chip.failed > 0 && "border-destructive/50 text-destructive")}
              >
                {@render chipBody(chip)}
                <Icon icon={ArrowUpRight01Icon} class="size-3 opacity-60" />
              </button>
            {:else}
              <span class={cn(chipClass, chip.failed > 0 && "border-destructive/50 text-destructive")}>{@render chipBody(chip)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <Collapsible.Content>
      <div class="border-border/70 flex flex-col gap-3 border-t p-2.5">
        {#if code.code}
          <section class="flex flex-col gap-1.5" aria-label="Script">
            <h4 class="label-caps">Script</h4>
            <CodeBlock code={code.code} class="max-h-72" />
          </section>
        {/if}
        {#if calls.length > 0}
          <section class="flex flex-col gap-1.5" aria-label="Calls in order">
            <h4 class="label-caps">Calls</h4>
            <ol class="flex flex-col">
              {#each calls as c, i (i)}
                {@const run = runs[i]}
                <li class="flex min-h-8 items-start gap-2 py-1 text-[12.5px]">
                  <span class="mt-1.5 grid size-3 shrink-0 place-items-center">
                    {#if c.isError}
                      <Icon icon={AlertCircleIcon} class="text-destructive size-3.5" />
                    {:else if isRunning(c)}
                      <span class="bg-live soft-pulse size-1.5 rounded-full" aria-label="running"></span>
                    {:else}
                      <Icon icon={Tick02Icon} class="text-muted-foreground size-3" />
                    {/if}
                  </span>
                  <span class="num shrink-0 font-medium">{c.name}</span>
                  <span class={cn("num min-w-0 flex-1 truncate", c.isError ? "text-destructive" : "text-muted-foreground")} title={c.summary}>
                    {c.summary ?? ""}
                  </span>
                  {#if run}
                    <button class="text-primary shrink-0 text-[12px] hover:underline" onclick={() => openAgent(run.id)}>Open</button>
                  {/if}
                  {#if c.durationMs !== undefined}<span class="num text-muted-foreground shrink-0">{durationShort(c.durationMs)}</span>{/if}
                </li>
              {/each}
            </ol>
          </section>
        {/if}
        {#if result?.text}
          <section class="flex flex-col gap-1.5" aria-label="Output">
            <h4 class="label-caps">Output</h4>
            <pre
              class={cn(
                "num bg-muted/50 max-h-56 overflow-auto rounded-md p-3 text-[12px] leading-relaxed break-words whitespace-pre-wrap",
                result.isError ? "text-destructive" : "text-muted-foreground",
              )}>{result.text}</pre>
          </section>
        {/if}
      </div>
    </Collapsible.Content>
  </div>
</Collapsible.Root>
