<script lang="ts">
  import type { NoteFile } from "@rh/shared";
  import Empty from "./Empty.svelte";
  import Icon from "./Icon.svelte";
  import { File01Icon } from "$lib/icons";
  import { ago } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { harness } from "$lib/store.svelte";
  import { openNote } from "$lib/ui.svelte";

  const plan = $derived(harness.notes.find((n) => n.path === "plan.md"));
  const theses = $derived(
    harness.notes
      .filter((n) => n.path.startsWith("theses/"))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );
  const others = $derived(harness.notes.filter((n) => n !== plan && !n.path.startsWith("theses/")));
  const ticker = (n: NoteFile) => n.path.slice("theses/".length).replace(/\.md$/, "");
  const title = (n: NoteFile) => n.path.replace(/\.md$/, "");
</script>

{#snippet row(n: NoteFile, label: string, mono = false)}
  <li>
    <button
      type="button"
      class="hover:bg-muted/50 flex min-h-10 w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors"
      onclick={() => openNote(n.path)}
    >
      <Icon icon={File01Icon} class="text-muted-foreground size-3.5 shrink-0" />
      <span class={mono ? "num font-semibold" : "text-[13px] font-medium"}>{label}</span>
      <span class="num text-muted-foreground ml-auto text-[11.5px]">{ago(n.updatedAt, clock.now)}</span>
    </button>
  </li>
{/snippet}

{#if !harness.loaded}
  <div class="bg-muted/60 m-3 h-12 animate-pulse rounded"></div>
{:else if harness.notes.length === 0}
  <Empty text="No notes yet" />
{:else}
  <div class="flex flex-col">
    {#if plan}
      <ul class="border-border border-b">{@render row(plan, "Plan")}</ul>
    {/if}
    {#if theses.length > 0}
      <h3 class="label-caps px-3.5 pt-3 pb-1">Theses</h3>
      <ul class="border-border divide-border divide-y border-b">
        {#each theses as n (n.path)}{@render row(n, ticker(n), true)}{/each}
      </ul>
    {/if}
    {#if others.length > 0}
      <h3 class="label-caps px-3.5 pt-3 pb-1">Other</h3>
      <ul class="divide-border divide-y">
        {#each others as n (n.path)}{@render row(n, title(n))}{/each}
      </ul>
    {/if}
  </div>
{/if}
