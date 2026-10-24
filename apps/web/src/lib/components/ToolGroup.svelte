<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import Icon from "./Icon.svelte";
  import ToolRow from "./ToolRow.svelte";
  import { ArrowRight01Icon } from "$lib/icons";
  import { cn } from "$lib/utils.js";

  let { messages, live = false }: { messages: ChatMessage[]; live?: boolean } = $props();

  const many = $derived(messages.length > 2);
  const errors = $derived(messages.filter((m) => m.isError).length);
  let userOpen = $state<boolean | null>(null);
  const open = $derived(userOpen ?? (live || !many));
  const names = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const m of messages) counts.set(m.toolName ?? "tool", (counts.get(m.toolName ?? "tool") ?? 0) + 1);
    return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
  });
</script>

<div class="border-border/70 rounded-lg border">
  {#if many}
    <Collapsible.Root open={open} onOpenChange={(v) => (userOpen = v)}>
      <Collapsible.Trigger
        class="hover:bg-muted/60 flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.5px] transition-colors"
      >
        <Icon icon={ArrowRight01Icon} class={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-90")} />
        <span class="font-medium">{messages.length} tool calls</span>
        <span class="text-muted-foreground num min-w-0 flex-1 truncate">{names}</span>
        {#if errors > 0}
          <span class="text-destructive border-destructive/40 shrink-0 rounded border px-1.5 text-[11px]">{errors} failed</span>
        {/if}
      </Collapsible.Trigger>
      <Collapsible.Content class="border-border/70 border-t p-0.5">
        {#each messages as m (m.id)}<ToolRow message={m} />{/each}
      </Collapsible.Content>
    </Collapsible.Root>
  {:else}
    <div class="p-0.5">
      {#each messages as m (m.id)}<ToolRow message={m} />{/each}
    </div>
  {/if}
</div>
