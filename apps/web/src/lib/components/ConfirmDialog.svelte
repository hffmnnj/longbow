<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    destructive = false,
    onconfirm,
  }: {
    open?: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    onconfirm: () => unknown;
  } = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{description}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class={destructive ? "bg-destructive text-background hover:bg-destructive/90" : ""}
        onclick={() => onconfirm()}
      >
        {confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
