<script lang="ts">
  import type { Snippet } from "svelte";
  let { text, children }: { text: string; children?: Snippet } = $props();
</script>

<div class="text-muted-foreground flex flex-wrap items-center gap-3 px-4 py-6 text-[13px]">
  <span>{text}</span>
  {@render children?.()}
</div>
