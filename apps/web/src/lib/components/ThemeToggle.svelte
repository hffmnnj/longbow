<script lang="ts">
  import { mode, toggleMode } from "mode-watcher";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import { Moon02Icon, Sun03Icon } from "$lib/icons";

  let { class: className = "" }: { class?: string } = $props();
</script>

<Button
  variant="ghost"
  size="icon"
  class={className}
  onclick={toggleMode}
  aria-label={mode.current === "dark" ? "Switch to light theme" : "Switch to dark theme"}
>
  <Icon icon={mode.current === "dark" ? Sun03Icon : Moon02Icon} />
</Button>
