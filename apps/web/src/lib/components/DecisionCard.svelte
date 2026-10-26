<script lang="ts">
  import type { JournalEntry, OrderRecord } from "@rh/shared";
  import ActionBadge from "./ActionBadge.svelte";
  import Icon from "./Icon.svelte";
  import Ticker from "./Ticker.svelte";
  import { ArrowRight01Icon, Cancel01Icon, Tick02Icon } from "$lib/icons";
  import { clock } from "$lib/clock.svelte";
  import { ago } from "$lib/format";
  import { ruleName, STATUS_LABEL } from "$lib/orders";
  import { openOrder } from "$lib/ui.svelte";
  import { cn } from "$lib/utils.js";

  let { entry, order, linkable = true, class: className = "" }: {
    entry: JournalEntry;
    /** The order this decision produced, when there is one. */
    order?: OrderRecord;
    /** False in the lab, where orders live in the run rather than the live account. */
    linkable?: boolean;
    class?: string;
  } = $props();

  let open = $state(false);
  const checks = $derived(order?.verdict.checks ?? []);
  const failed = $derived(checks.filter((c) => !c.ok));
  const win = $derived(order ? { label: "win", value: order.intent.probabilityWin } : entry.confidence !== undefined ? { label: "conf", value: entry.confidence } : undefined);
  const detailsId = $props.id();
</script>

<article class={cn("border-border bg-card flex flex-col gap-2 rounded-lg border p-3", className)} aria-label={`${entry.action}${entry.symbol ? ` ${entry.symbol}` : ""} decision`}>
  <header class="flex items-center gap-2">
    <ActionBadge action={entry.action} />
    {#if entry.symbol}<Ticker symbol={entry.symbol} class="text-[14px]" />{/if}
    <span class="num text-muted-foreground ml-auto text-[11.5px]">{ago(entry.at, clock.now)}</span>
    {#if win}
      <span class="num bg-muted rounded px-1.5 py-0.5 text-[11.5px]" title={win.label === "win" ? "Stated probability of reaching target before invalidation" : "Agent confidence"}>
        {win.label} {Math.round(win.value * 100)}%
      </span>
    {/if}
  </header>

  <p class="text-[13.5px] leading-snug font-medium">{entry.summary}</p>
  <p class={cn("text-muted-foreground text-[12.5px] leading-relaxed", !open && "line-clamp-2")} id={detailsId}>{order?.intent.thesis ?? entry.rationale}</p>

  {#if entry.evidence.length > 0}
    <p class="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-[12px]">
      <span class="label-caps shrink-0">Evidence {entry.evidence.length}</span>
      {#if !open}<span class="truncate">{entry.evidence[0]}</span>{/if}
    </p>
    {#if open}
      <ul class="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-[12px]">
        {#each entry.evidence as ev, i (i)}<li>{ev}</li>{/each}
      </ul>
    {/if}
  {/if}
  {#if open && entry.regime}<p class="text-muted-foreground text-[12px]">Regime: {entry.regime}</p>{/if}
  {#if open && order && failed.length}
    <ul class="flex flex-col gap-1">
      {#each failed as c (c.rule)}
        <li class="text-destructive flex items-start gap-1.5 text-[12px]"><Icon icon={Cancel01Icon} class="mt-0.5 size-3.5 shrink-0" /><span><span class="font-medium">{ruleName(c.rule)}.</span> {c.detail}</span></li>
      {/each}
    </ul>
  {/if}

  <footer class="flex flex-wrap items-center gap-2">
    {#if order}
      <span
        class={cn(
          "inline-flex min-h-6 items-center gap-1 rounded px-1.5 text-[11.5px] font-medium",
          failed.length ? "bg-destructive/12 text-destructive" : "bg-gain/12 text-gain",
        )}
      >
        <Icon icon={failed.length ? Cancel01Icon : Tick02Icon} class="size-3" strokeWidth={2.4} />
        {#if failed.length}
          Risk: {failed.length} of {checks.length} failed
        {:else}
          Risk: all {checks.length} checks passed
        {/if}
      </span>
      {#if linkable}
        <button
          type="button"
          class="text-primary hover:bg-primary/10 -my-1 inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-[12px] font-medium"
          onclick={() => openOrder(order.id)}
          aria-label={`Open order: ${STATUS_LABEL[order.status]}`}
        >
          {STATUS_LABEL[order.status]}
          <Icon icon={ArrowRight01Icon} class="size-3" />
        </button>
      {:else}
        <span class="text-muted-foreground text-[12px]">{STATUS_LABEL[order.status]}</span>
      {/if}
    {:else if entry.orderId}
      <span class="text-muted-foreground text-[12px]">Order no longer in the recent list</span>
    {:else if entry.action === "buy" || entry.action === "sell"}
      <span class="text-muted-foreground text-[12px]">No order was submitted</span>
    {/if}
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground ml-auto min-h-8 rounded px-1.5 text-[12px]"
      aria-expanded={open}
      aria-controls={detailsId}
      onclick={() => (open = !open)}
    >
      {open ? "Less" : "Details"}
    </button>
  </footer>
</article>
