<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		open = $bindable(false),
		class: className,
		children,
		...restProps
	}: CollapsiblePrimitive.RootProps = $props();
</script>

<CollapsiblePrimitive.Root
	bind:ref
	bind:open
	data-slot="trace-collapsible"
	class={cn("flex w-full min-w-0 flex-col", className)}
	{...restProps}
>
	{@render children?.()}
</CollapsiblePrimitive.Root>
