<script lang="ts">
  import { isTicker } from "$lib/chart";
  import { renderMarkdown } from "$lib/markdown";
  import { harness } from "$lib/store.svelte";
  import { openSymbol } from "$lib/ui.svelte";

  let { text }: { text: string } = $props();
  const html = $derived(renderMarkdown(text));
  let root = $state<HTMLDivElement | null>(null);

  /** Inline code that is exactly a known ticker becomes a chart link. */
  function tickerOf(el: EventTarget | null): string | null {
    if (!(el instanceof HTMLElement) || el.tagName !== "CODE" || el.closest("pre")) return null;
    const t = el.textContent?.trim() ?? "";
    return isTicker(t) && harness.symbols.has(t) ? t : null;
  }

  $effect(() => {
    html;
    harness.symbols;
    if (!root) return;
    for (const code of root.querySelectorAll("code")) {
      if (!tickerOf(code)) continue;
      code.classList.add("md-ticker");
      code.setAttribute("role", "button");
      code.tabIndex = 0;
    }
  });

  function activate(e: Event) {
    const t = tickerOf(e.target);
    if (t) openSymbol(t);
  }
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in renderMarkdown -->
<div class="md" bind:this={root} onclick={activate} onkeydown={(e) => (e.key === "Enter" ? activate(e) : undefined)} role="presentation">{@html html}</div>
