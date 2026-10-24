<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import type { IconSvgElement } from "@hugeicons/svelte";

  let { icon, class: className = "size-4", strokeWidth = 1.8 }: {
    icon: IconSvgElement;
    class?: string;
    strokeWidth?: number;
  } = $props();
</script>

<HugeiconsIcon {icon} {strokeWidth} class={className} aria-hidden="true" />
