<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import type { Loadable } from "$lib/store.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let { loadable, onretry, skeleton = "h-40", children }: {
    loadable: Loadable<T> | undefined;
    onretry: () => void;
    /** Height of the loading block, matched to the loaded layout so nothing jumps. */
    skeleton?: string;
    children: Snippet<[T]>;
  } = $props();
</script>

{#if loadable?.data !== undefined}
  {@render children(loadable.data)}
  {#if loadable.error}
    <p class="text-warn px-3.5 pb-2 text-[12px]">Could not refresh: {loadable.error}</p>
  {/if}
{:else if loadable?.state === "error"}
  <div class={cn("text-muted-foreground flex flex-col items-start justify-center gap-2 px-3.5 pb-4 text-[13px]", skeleton)} role="alert">
    <span>Could not load this: {loadable.error}</span>
    <Button size="sm" variant="outline" onclick={onretry}>Retry</Button>
  </div>
{:else}
  <div class={cn("bg-muted/50 mx-3.5 mb-3.5 animate-pulse rounded-md", skeleton)} aria-hidden="true"></div>
{/if}
