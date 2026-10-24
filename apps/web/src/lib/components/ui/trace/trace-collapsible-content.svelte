<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CollapsiblePrimitive.ContentProps = $props();
</script>

<CollapsiblePrimitive.Content
	bind:ref
	data-slot="trace-collapsible-content"
	class="min-w-0 overflow-hidden duration-200 [--radix-accordion-content-height:var(--bits-collapsible-content-height)] data-open:animate-accordion-down data-closed:animate-accordion-up"
	{...restProps}
>
	<div
		data-slot="trace-collapsible-content-inner"
		class={cn(
			"mt-2 mb-1 ml-[calc(--spacing(2)-1px)] min-w-0 border-l pr-1 pl-4 leading-relaxed wrap-break-word text-muted-foreground",
			className
		)}
	>
		{@render children?.()}
	</div>
</CollapsiblePrimitive.Content>
