<script lang="ts">
  import { highlightJs } from "$lib/highlight";
  import { cn } from "$lib/utils.js";

  let { code, class: className = "" }: { code: string; class?: string } = $props();
  const html = $derived(highlightJs(code));
</script>

<pre class={cn("hljs num bg-muted/50 overflow-auto rounded-md p-3 text-[12px] leading-relaxed", className)}><code>{@html html}</code></pre>
