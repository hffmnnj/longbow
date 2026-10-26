<script lang="ts">
  import type { HaltReason } from "@rh/shared";
  import { Button } from "$lib/components/ui/button/index.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";
  import { Alert02Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";

  const words: Record<HaltReason, string> = {
    kill_switch: "Kill switch is engaged. No orders will be placed.",
    mode_off: "Mode is Off. The agent only researches.",
    daily_loss: "Daily loss limit reached. New entries are paused until the next session.",
    drawdown: "Monthly drawdown limit reached. New entries stay halted until you re-arm.",
    broker_disconnected: "Robinhood is not connected. Nothing can trade.",
  };

  const halts = $derived(harness.status?.halts ?? []);
  const canRearm = $derived(halts.includes("drawdown") || (harness.status?.settings.drawdownHalted ?? false));
  let confirm = $state(false);
</script>

{#if halts.length > 0}
  <div
    role="status"
    class="bg-warn-bg text-warn border-warn/30 flex shrink-0 items-start gap-2.5 border-b px-4 py-2 text-[13px]"
  >
    <Icon icon={Alert02Icon} class="mt-0.5 size-4 shrink-0" />
    <ul class="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-0.5">
      {#each halts as h (h)}
        <li>{words[h]}</li>
      {/each}
    </ul>
    {#if canRearm}
      <Button size="sm" variant="outline" class="border-warn/50 h-7 shrink-0 bg-transparent" onclick={() => (confirm = true)}>
        Re-arm
      </Button>
    {/if}
  </div>
{/if}

<ConfirmDialog
  bind:open={confirm}
  title="Re-arm after drawdown halt?"
  description="New entries are allowed again, subject to the mode and every risk limit. Only do this after reviewing why the drawdown tripped."
  confirmLabel="Re-arm"
  onconfirm={() => harness.quickPatch("rearm", { drawdownHalted: false }, "Drawdown halt cleared")}
/>
