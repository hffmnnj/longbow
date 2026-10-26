<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
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
  import { ArrowRight01Icon, File01Icon } from "$lib/icons";
  import { etTime } from "$lib/format";
  import { cycleLabel } from "$lib/steps";
  import { cn } from "$lib/utils.js";

  let { message }: { message: ChatMessage } = $props();
  let open = $state(false);

  const title = $derived(cycleLabel(message.text));
  const hasBody = $derived(message.text.trim().includes("\n"));
  const bodyLines = $derived(message.text.trim().split("\n").length);
</script>

<Collapsible.Root bind:open>
  <div class="flex items-center gap-3">
    <span class="bg-border h-px flex-1"></span>
    <Collapsible.Trigger
      disabled={!hasBody}
      class="text-muted-foreground hover:text-foreground flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none"
    >
      {#if hasBody}
        <Icon icon={ArrowRight01Icon} class={cn("size-3 transition-transform", open && "rotate-90")} />
      {/if}
      {title}
      <span class="num font-normal">{etTime(message.at)}</span>
    </Collapsible.Trigger>
    <span class="bg-border h-px flex-1"></span>
  </div>
  <Collapsible.Content>
    <div class="mx-auto max-w-prose pt-2">
      <Trace>
        <TraceCollapsible>
          <TraceCollapsibleTrigger aria-label={`Cycle input, ${bodyLines} lines`}>
            <TraceLine>
              <TraceIcon><Icon icon={File01Icon} /></TraceIcon>
              <TraceTitle>Cycle input</TraceTitle>
              <TraceDescription>{bodyLines} {bodyLines === 1 ? "line" : "lines"}</TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <pre
              class="num text-muted-foreground bg-muted/50 max-h-80 overflow-auto rounded-md p-3 text-[12px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</pre>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </div>
  </Collapsible.Content>
</Collapsible.Root>
