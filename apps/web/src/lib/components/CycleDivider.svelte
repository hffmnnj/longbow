<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import Icon from "./Icon.svelte";
  import { ArrowRight01Icon } from "$lib/icons";
  import { etTime } from "$lib/format";
  import { cycleLabel } from "$lib/steps";
  import { cn } from "$lib/utils.js";

  let { message }: { message: ChatMessage } = $props();
  let open = $state(false);

  const title = $derived(cycleLabel(message.text));
  const hasBody = $derived(message.text.trim().includes("\n"));
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
    <pre
      class="num text-muted-foreground bg-muted/50 mx-auto mt-2 max-h-80 max-w-prose overflow-auto rounded-md p-3 text-[12px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</pre>
  </Collapsible.Content>
</Collapsible.Root>
