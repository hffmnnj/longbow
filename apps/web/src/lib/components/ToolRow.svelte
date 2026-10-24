<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import Icon from "./Icon.svelte";
  import { AlertCircleIcon, ArrowRight01Icon, Wrench01Icon } from "$lib/icons";
  import { cn } from "$lib/utils.js";

  let { message }: { message: ChatMessage } = $props();
  let open = $state(false);

  const summary = $derived(message.text.split("\n", 1)[0] ?? "");
</script>

<Collapsible.Root bind:open>
  <Collapsible.Trigger
    class="hover:bg-muted/60 flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors"
    aria-label={`${message.toolName ?? "Tool"} ${message.isError ? "failed" : "call"}: ${summary}`}
  >
    <Icon
      icon={ArrowRight01Icon}
      class={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-90")}
    />
    <Icon
      icon={message.isError ? AlertCircleIcon : Wrench01Icon}
      class={cn("size-3.5 shrink-0", message.isError ? "text-destructive" : "text-muted-foreground")}
    />
    <span class="num shrink-0 font-medium">{message.toolName ?? "tool"}</span>
    <span class={cn("min-w-0 flex-1 truncate", message.isError ? "text-destructive" : "text-muted-foreground")}>
      {summary}
    </span>
    {#if message.isError}
      <span class="text-destructive border-destructive/40 shrink-0 rounded border px-1.5 text-[11px]">Error</span>
    {/if}
  </Collapsible.Trigger>
  <Collapsible.Content>
    <pre
      class="num text-muted-foreground bg-muted/50 mx-2 mt-1 mb-1.5 max-h-72 overflow-auto rounded-md p-2.5 text-[12px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</pre>
  </Collapsible.Content>
</Collapsible.Root>
