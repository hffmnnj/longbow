<script lang="ts">
  import type { RiskVerdict } from "@rh/shared";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import Icon from "./Icon.svelte";
  import { ArrowRight01Icon, Cancel01Icon, Tick02Icon } from "$lib/icons";
  import { ruleName } from "$lib/orders";
  import { cn } from "$lib/utils.js";

  let { verdict }: { verdict: RiskVerdict } = $props();
  let open = $state(false);

  const failed = $derived(verdict.checks.filter((c) => !c.ok));
  const passed = $derived(verdict.checks.length - failed.length);
</script>

<Collapsible.Root bind:open>
  <Collapsible.Trigger
    class="hover:bg-muted/60 -mx-1.5 flex min-h-8 w-[calc(100%+0.75rem)] items-center gap-1.5 rounded px-1.5 text-left text-[12.5px] transition-colors"
  >
    <Icon icon={ArrowRight01Icon} class={cn("text-muted-foreground size-3 transition-transform", open && "rotate-90")} />
    <span class="font-medium">Risk checks</span>
    <span class="text-muted-foreground num">
      {passed} passed{#if failed.length}, <span class="text-destructive">{failed.length} failed</span>{/if}
    </span>
  </Collapsible.Trigger>

  {#if failed.length && !open}
    <ul class="mt-1 flex flex-col gap-1">
      {#each failed as c (c.rule)}
        <li class="text-destructive flex items-start gap-1.5 text-[12.5px]">
          <Icon icon={Cancel01Icon} class="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} />
          <span><span class="font-medium">{ruleName(c.rule)}.</span> {c.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <Collapsible.Content>
    <ul class="mt-1 flex flex-col gap-1">
      {#each verdict.checks as c (c.rule)}
        <li class={cn("flex items-start gap-1.5 text-[12.5px]", c.ok ? "text-muted-foreground" : "text-destructive")}>
          <Icon icon={c.ok ? Tick02Icon : Cancel01Icon} class="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} />
          <span><span class={cn("font-medium", c.ok && "text-foreground")}>{ruleName(c.rule)}.</span> {c.detail}</span>
        </li>
      {/each}
    </ul>
  </Collapsible.Content>
</Collapsible.Root>
