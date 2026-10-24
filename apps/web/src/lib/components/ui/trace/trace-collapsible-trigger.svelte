<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from "bits-ui";
	import { HugeiconsIcon } from "@hugeicons/svelte";
	import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
	import { cn } from "$lib/utils.js";
	import TraceIcon from "./trace-icon.svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CollapsiblePrimitive.TriggerProps = $props();
</script>

<CollapsiblePrimitive.Trigger
	bind:ref
	data-slot="trace-collapsible-trigger"
	class={cn(
		"group/trace-collapsible-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<TraceIcon class="transition-transform group-aria-expanded/trace-collapsible-trigger:rotate-90">
		<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} class="size-4" />
	</TraceIcon>
</CollapsiblePrimitive.Trigger>
