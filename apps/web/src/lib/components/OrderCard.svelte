<script lang="ts">
  import type { OrderRecord } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import RiskChecks from "./RiskChecks.svelte";
  import MiniChart from "./MiniChart.svelte";
  import SideBadge from "./SideBadge.svelte";
  import Ticker from "./Ticker.svelte";
  import { ago, isoDay, pctSigned, priceExact, priceFor, qtyExact, qtyFor, qtyUnit, usd } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import {
    expectedValuePct,
    fractionalQuoteLabel,
    isOptionIntent,
    isValidOptionIntent,
    notional,
    optionLimitPerShare,
    optionProblem,
    optionSideLabel,
    optionStrike,
    optionTotal,
    optionTypeLabel,
  } from "$lib/orders";
  import { harness } from "$lib/store.svelte";

  let { order }: { order: OrderRecord } = $props();
  const i = $derived(order.intent);
  const ev = $derived(expectedValuePct(i));
  const busy = $derived(harness.busy[`order:${order.id}`] ?? false);
  const isOwner = $derived(order.ownerMessageId != null);
  const isPendingOwner = $derived(isOwner && order.status === "pending_approval");
  const fractionalQuote = $derived(fractionalQuoteLabel(i));
  const isOption = $derived(isOptionIntent(i));
  const ticket = $derived(i.longOption);
  const validOption = $derived(isValidOptionIntent(i));
  const problem = $derived(isOption ? optionProblem(i) : undefined);
  const approveBlocked = $derived(busy || harness.status?.settings.killSwitch || problem != null);
  const cardLabel = $derived(
    isOption && ticket && validOption
      ? `${optionSideLabel(ticket)} ${ticket.contracts} ${ticket.symbol} ${usd(optionStrike(ticket))} ${ticket.contractType}`
      : `${i.side} ${i.symbol}`,
  );
  let rejecting = $state(false);
  let reason = $state("");
  let expanded = $state(false);
</script>

<article class="border-border bg-card flex flex-col gap-2.5 rounded-lg border p-3" aria-label={cardLabel}>
  {#if isOption && ticket && validOption}
    <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <SideBadge side={i.side} />
      <span
        class="border-primary/40 text-primary inline-flex h-5 items-center rounded border px-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
        title="Standard 100-share long option"
      >
        Option
      </span>
      <Ticker symbol={i.symbol} class="text-[15px]" />
      {#if isOwner}
        <span class="bg-primary/15 text-primary inline-flex h-5 items-center rounded px-1.5 text-[10.5px] font-semibold tracking-wider uppercase">Owner order</span>
      {/if}
      <span class="num text-muted-foreground">{usd(optionStrike(ticket))} {optionTypeLabel(ticket).toLowerCase()} · Exp {isoDay(ticket.expiration)} {ticket.expiration.slice(0, 4)}</span>
      <span class="num ml-auto text-[13px] font-medium">{usd(optionTotal(ticket))}</span>
    </header>

    <div class="border-primary/30 bg-primary/5 rounded-md border px-2.5 py-2" aria-label="Option order details">
      <p class="label-caps">Long option · 100-share</p>
      <p class="num mt-1 text-[12.5px] leading-relaxed">
        {optionSideLabel(ticket)}
        {ticket.contracts} {ticket.contracts === 1 ? "contract" : "contracts"} of {ticket.symbol} ·
        {usd(optionStrike(ticket))} {ticket.contractType} · Exp {isoDay(ticket.expiration)} {ticket.expiration.slice(0, 4)} ·
        Limit {usd(optionLimitPerShare(ticket))} per share ·
        Total {usd(optionTotal(ticket))} {ticket.side === "buy-to-open" ? "debit" : "proceeds"} before fees ·
        Order expires at today's close
      </p>
      <p class="text-muted-foreground mt-1 text-[12.5px] leading-relaxed">
        If exercised, this can create {ticket.symbol} stock. A fill is not guaranteed at the limit.
      </p>
      {#if i.ownerInstruction}
        <p class="text-muted-foreground mt-1 truncate text-[12.5px]">From your message: “{i.ownerInstruction}”</p>
      {/if}
    </div>
  {:else if isOption}
    <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <SideBadge side={i.side} />
      <span
        class="border-destructive/40 text-destructive inline-flex h-5 items-center rounded border px-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
        title="Option details need review"
      >
        Option
      </span>
      <Ticker symbol={i.symbol} class="text-[15px]" />
      {#if isOwner}
        <span class="bg-primary/15 text-primary inline-flex h-5 items-center rounded px-1.5 text-[10.5px] font-semibold tracking-wider uppercase">Owner order</span>
      {/if}
    </header>
    <div class="border-destructive/30 bg-destructive/5 rounded-md border px-2.5 py-2" aria-label="Option details need review">
      <p class="text-[12.5px] leading-relaxed font-medium">Option details need review.</p>
      <p class="text-muted-foreground mt-0.5 text-[12.5px] leading-relaxed">{problem ?? "Contract details are incomplete or malformed."} Do not approve from this ticket.</p>
    </div>
  {:else}
    <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <SideBadge side={i.side} />
      <Ticker symbol={i.symbol} class="text-[15px]" />
      {#if isOwner}
        <span class="bg-primary/15 text-primary inline-flex h-5 items-center rounded px-1.5 text-[10.5px] font-semibold tracking-wider uppercase">Owner order</span>
      {/if}
      {#if fractionalQuote}
        <span class="num text-muted-foreground">{qtyFor(i.symbol, i.quantity)} {qtyUnit(i.symbol)} · {fractionalQuote} {priceFor(i.symbol, i.limitPrice)}</span>
      {:else}
        <span class="num text-muted-foreground">{qtyFor(i.symbol, i.quantity)} @ {priceFor(i.symbol, i.limitPrice)}</span>
      {/if}
      {#if i.orderType === "stop_limit" && i.stopPrice}
        <span class="num text-muted-foreground text-[12px]">stop {priceFor(i.symbol, i.stopPrice)}</span>
      {/if}
      <span class="num ml-auto text-[13px] font-medium">{usd(notional(i))}</span>
    </header>
  {/if}

  {#if !isOption && isPendingOwner}
    <div class="border-primary/30 bg-primary/5 rounded-md border px-2.5 py-2" aria-label="Owner order details">
      <p class="num text-[12.5px] leading-relaxed">
        {i.side === "buy" ? "Buy" : "Sell"}
        {qtyExact(i.quantity)} {qtyUnit(i.symbol)} of {i.symbol} ·
        {#if fractionalQuote}{fractionalQuote} {priceExact(i.limitPrice)}{:else}{i.orderType === "stop_limit" ? "Stop limit" : "Limit"} @ {priceExact(i.limitPrice)}{/if}{#if i.orderType === "stop_limit" && i.stopPrice} · Stop {priceExact(i.stopPrice)}{/if} ·
        Expires at today's close
      </p>
      {#if fractionalQuote}
        <p class="text-muted-foreground mt-1 text-[12.5px] leading-relaxed">
          If the quote passes, this is sent as a market order. The fill price can differ.
        </p>
      {/if}
      {#if i.ownerInstruction}
        <p class="text-muted-foreground mt-1 truncate text-[12.5px]">From your message: “{i.ownerInstruction}”</p>
      {/if}
    </div>
  {:else if !isOption && fractionalQuote && order.status === "pending_approval"}
    <p class="text-muted-foreground text-[12.5px] leading-relaxed">
      If the quote passes, this is sent as a market order. The fill price can differ.
    </p>
  {/if}

  <div>
    <p class={expanded ? "text-[13px] leading-relaxed" : "line-clamp-2 text-[13px] leading-relaxed"}>{i.thesis}</p>
    {#if i.thesis.length > 110}
      <button class="text-primary mt-0.5 min-h-6 text-[12px] hover:underline" onclick={() => (expanded = !expanded)}>
        {expanded ? "Show less" : "Show more"}
      </button>
    {/if}
  </div>

  {#if !isOption}
    <MiniChart symbol={i.symbol} limit={i.limitPrice} invalidation={i.invalidationPrice} limitLabel={fractionalQuote} />
  {/if}

  {#if isOption && ticket && validOption}
    <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-[12.5px]">
      <div>
        <dt class="label-caps">Contracts</dt>
        <dd class="num mt-0.5">{ticket.contracts}</dd>
      </div>
      <div>
        <dt class="label-caps">Limit / share</dt>
        <dd class="num mt-0.5">{usd(optionLimitPerShare(ticket))}</dd>
      </div>
      <div>
        <dt class="label-caps">Total at limit</dt>
        <dd class="num mt-0.5">{usd(optionTotal(ticket))} {ticket.side === "buy-to-open" ? "debit" : "proceeds"}</dd>
      </div>
      <div>
        <dt class="label-caps">Strike</dt>
        <dd class="num mt-0.5">{usd(optionStrike(ticket))} {optionTypeLabel(ticket).toLowerCase()}</dd>
      </div>
      <div>
        <dt class="label-caps">Expiration</dt>
        <dd class="num mt-0.5" title={ticket.expiration}>{isoDay(ticket.expiration)} {ticket.expiration.slice(0, 4)}</dd>
      </div>
      <div>
        <dt class="label-caps">Expected value</dt>
        <dd class={`num mt-0.5 ${ev >= 0 ? "" : "text-loss"}`}>
          {pctSigned(ev)}
          <span class="text-muted-foreground block text-[11.5px]">win {Math.round(i.probabilityWin * 100)}%</span>
        </dd>
      </div>
      <div>
        <dt class="label-caps">Underlying invalidation</dt>
        <dd class="num mt-0.5">{priceFor(i.symbol, i.invalidationPrice)}</dd>
      </div>
      <div>
        <dt class="label-caps">Time stop</dt>
        <dd class="num mt-0.5">{i.timeStopDate}</dd>
      </div>
    </dl>
  {:else if !isOption}
    <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-[12.5px]">
      <div>
        <dt class="label-caps">Invalidation</dt>
        <dd class="num mt-0.5">{priceFor(i.symbol, i.invalidationPrice)}</dd>
      </div>
      <div>
        <dt class="label-caps">Time stop</dt>
        <dd class="num mt-0.5">{i.timeStopDate}</dd>
      </div>
      <div>
        <dt class="label-caps">Expected value</dt>
        <dd class={`num mt-0.5 ${ev >= 0 ? "" : "text-loss"}`}>
          {pctSigned(ev)}
          <span class="text-muted-foreground block text-[11.5px]">win {Math.round(i.probabilityWin * 100)}%</span>
        </dd>
      </div>
    </dl>
  {/if}

  <RiskChecks verdict={order.verdict} />

  {#if rejecting}
    <form
      class="flex flex-col gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void harness.reject(order.id, reason);
      }}
    >
      <label class="sr-only" for={`reason-${order.id}`}>Reason for rejecting (optional)</label>
      <Input id={`reason-${order.id}`} bind:value={reason} placeholder="Reason (optional)" maxlength={500} class="h-10" />
      <div class="flex gap-2">
        <Button type="submit" variant="destructive" class="h-10 flex-1" disabled={busy}>Confirm reject</Button>
        <Button type="button" variant="ghost" class="h-10" onclick={() => (rejecting = false)}>Cancel</Button>
      </div>
    </form>
  {:else}
    <div class="flex items-center gap-2">
      <Button class="h-10 flex-1 md:h-9" disabled={approveBlocked} onclick={() => harness.approve(order.id)}>
        Approve
      </Button>
      <Button variant="outline" class="h-10 flex-1 md:h-9" disabled={busy} onclick={() => (rejecting = true)}>Reject</Button>
      <span class="num text-muted-foreground w-16 text-right text-[11px]">{ago(order.createdAt, clock.now)}</span>
    </div>
    {#if problem}
      <p class="text-destructive text-[12px]">{problem} Approval is blocked; rejecting is still available.</p>
    {/if}
    {#if harness.status?.settings.killSwitch}
      <p class="text-warn text-[12px]">Kill switch is engaged. Release it to approve.</p>
    {/if}
  {/if}
</article>
