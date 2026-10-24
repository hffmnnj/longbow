<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";
  import { PowerIcon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import { cn } from "$lib/utils.js";

  let { compact = false, class: className = "" }: { compact?: boolean; class?: string } = $props();

  const engaged = $derived(harness.status?.settings.killSwitch ?? false);
  let confirmRelease = $state(false);

  function press() {
    if (engaged) confirmRelease = true;
    else void harness.quickPatch("kill", { killSwitch: true }, "Kill switch engaged");
  }
</script>

<Button
  onclick={press}
  disabled={!harness.status || harness.busy.kill}
  aria-pressed={engaged}
  aria-label={engaged ? "Kill switch engaged. Release" : "Engage kill switch"}
  class={cn(
    "h-9 gap-1.5 px-3 font-semibold tracking-wide",
    engaged
      ? "bg-destructive text-background hover:bg-destructive/90 ring-destructive/40 ring-2 ring-offset-1 ring-offset-transparent"
      : "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 border",
    className,
  )}
>
  <Icon icon={PowerIcon} class="size-4" strokeWidth={2.2} />
  {#if engaged}
    {compact ? "Killed" : "KILLED · Release"}
  {:else}
    {compact ? "Kill" : "Kill switch"}
  {/if}
</Button>

<ConfirmDialog
  bind:open={confirmRelease}
  title="Release the kill switch?"
  description="Orders can be placed again, subject to the current mode and risk limits."
  confirmLabel="Release"
  onconfirm={() => harness.quickPatch("kill", { killSwitch: false }, "Kill switch released")}
/>
