<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.js";

  let { title, reading, class: className = "", actions, children }: {
    title: string;
    /** One plain sentence saying what the figures below show. */
    reading?: string;
    class?: string;
    actions?: Snippet;
    children?: Snippet;
  } = $props();
  const id = $props.id();
</script>

<section class={cn("border-border bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border", className)} aria-labelledby={id}>
  <header class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 pt-3 pb-2">
    <div class="min-w-0 flex-1 basis-40">
      <h2 {id} class="label-caps">{title}</h2>
      {#if reading}<p class="mt-1 text-[13px] leading-snug">{reading}</p>{/if}
    </div>
    {#if actions}<div class="max-w-full shrink-0">{@render actions()}</div>{/if}
  </header>
  {@render children?.()}
</section>
