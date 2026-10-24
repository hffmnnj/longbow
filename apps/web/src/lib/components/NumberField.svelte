<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";

  let { id, label, unit, step, value = $bindable(), error, placeholder }: {
    id: string;
    label: string;
    unit: string;
    step: string;
    value: string;
    error?: string;
    placeholder?: string;
  } = $props();
</script>

<div class="flex flex-col gap-1">
  <Label for={id} class="text-[12.5px] font-medium">{label}</Label>
  <div class="relative">
    <Input
      {id}
      type="number"
      inputmode="decimal"
      {step}
      {placeholder}
      bind:value
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      class="num h-10 pr-[5.5rem] text-right md:h-9"
    />
    <span class="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px]">{unit}</span>
  </div>
  {#if error}<p id={`${id}-err`} class="text-destructive text-[12px]">{error}</p>{/if}
</div>
