<script lang="ts">
  import Icon from "./Icon.svelte";
  import { AlertCircleIcon, File01Icon, Loading03Icon } from "$lib/icons";
  import { etTime } from "$lib/format";

  /**
   * A quiet timeline marker for context compaction. The committed history card
   * reads "Context compacted" with its original timestamp; it never renders
   * the message text (the server strips summaries from API chat). The lead
   * feed adds one live card while the agent is compacting, or an honest
   * failure card without any raw error payload.
   */
  let { kind, at }: { kind: "compacted" | "compacting" | "failed"; at?: number } = $props();

  const label = $derived(
    kind === "compacting" ? "Context compacting…" : kind === "failed" ? "Context compaction failed" : "Context compacted",
  );
  const aria = $derived(
    kind === "compacting" ? "Context is compacting" : kind === "failed" ? "Context compaction failed" : "Context compacted",
  );
</script>

<section class="rise-in border-border bg-muted/40 rounded-lg border px-3 py-2" aria-label={aria}>
  <div class="flex min-h-8 items-center gap-2">
    {#if kind === "compacting"}
      <span class="text-live flex items-center"><Icon icon={Loading03Icon} class="size-3.5 animate-spin" /></span>
    {:else if kind === "failed"}
      <Icon icon={AlertCircleIcon} class="text-muted-foreground size-3.5 shrink-0" />
    {:else}
      <Icon icon={File01Icon} class="text-muted-foreground size-3.5 shrink-0" />
    {/if}
    <p class="text-[13px] font-medium">
      {label}
      {#if at !== undefined}
        <span class="num text-muted-foreground ml-1.5 font-normal">{etTime(at)}</span>
      {/if}
    </p>
  </div>
</section>
