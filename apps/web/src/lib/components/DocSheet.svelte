<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import Markdown from "./Markdown.svelte";
  import { ago } from "$lib/format";
  import { clock } from "$lib/clock.svelte";
  import { harness } from "$lib/store.svelte";
  import { ui } from "$lib/ui.svelte";

  let lastNote = $state("");
  let lastSkill = $state("");
  $effect(() => {
    if (ui.note) lastNote = ui.note;
  });
  $effect(() => {
    if (ui.skill) lastSkill = ui.skill;
  });

  const kind = $derived(ui.skill ? "skill" : ui.note ? "note" : lastSkill && !lastNote ? "skill" : "note");
  const id = $derived(kind === "skill" ? (ui.skill ?? lastSkill) : (ui.note ?? lastNote));
  const doc = $derived(harness.docs[`${kind}:${id}`]);
  const meta = $derived(kind === "note" ? harness.notes.find((n) => n.path === id) : undefined);
  const description = $derived(kind === "skill" ? harness.skills.find((s) => s.name === id)?.description : undefined);
  const open = $derived(ui.note !== null || ui.skill !== null);

  $effect(() => {
    if (ui.note) void harness.loadDoc("note", ui.note);
  });
  $effect(() => {
    if (ui.skill) void harness.loadDoc("skill", ui.skill);
  });
</script>

<Sheet.Root
  {open}
  onOpenChange={(o) => {
    if (!o) {
      ui.note = null;
      ui.skill = null;
    }
  }}
>
  <Sheet.Content
    side="right"
    class="data-[side=right]:w-full data-[side=right]:sm:max-w-xl gap-0"
    onOpenAutoFocus={(e) => e.preventDefault()}
  >
    <Sheet.Header class="border-border border-b pr-14">
      <Sheet.Title class="num text-[15px] break-all">{id}</Sheet.Title>
      <Sheet.Description class="text-muted-foreground text-[12px]">
        {#if meta}Updated {ago(meta.updatedAt, clock.now)}{:else if description}{description}{:else}<span class="sr-only">Read only</span>{/if}
      </Sheet.Description>
    </Sheet.Header>
    <div class="pb-safe min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[14px]">
      {#if doc?.state === "ready" && doc.data !== undefined}
        <Markdown text={doc.data} />
      {:else if doc?.state === "error"}
        <div class="text-muted-foreground flex flex-col items-start gap-3 text-[13px]">
          <span>Could not load: {doc.error}</span>
          <Button size="sm" variant="outline" onclick={() => harness.loadDoc(kind, id)}>Retry</Button>
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          <div class="bg-muted/60 h-5 w-1/3 animate-pulse rounded"></div>
          <div class="bg-muted/60 h-4 w-full animate-pulse rounded"></div>
          <div class="bg-muted/60 h-4 w-5/6 animate-pulse rounded"></div>
        </div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
