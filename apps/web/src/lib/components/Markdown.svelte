<script lang="ts">
  import { renderMarkdown } from "$lib/markdown";
  let { text }: { text: string } = $props();
  const html = $derived(renderMarkdown(text));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in renderMarkdown -->
<div class="md">{@html html}</div>
