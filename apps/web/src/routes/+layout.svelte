<script lang="ts">
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner/index.js";

  let { children } = $props();
</script>

<ModeWatcher defaultMode="dark" themeColors={{ dark: "#16191d", light: "#f6f7f8" }} />
<Toaster position="top-center" richColors={false} />
{@render children()}
