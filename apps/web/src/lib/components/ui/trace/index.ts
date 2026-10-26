import Content from "./trace-collapsible-content.svelte";
import Trigger from "./trace-collapsible-trigger.svelte";
import Collapsible from "./trace-collapsible.svelte";
import Description from "./trace-description.svelte";
import Icon from "./trace-icon.svelte";
import Line from "./trace-line.svelte";
import Title from "./trace-title.svelte";
import Root from "./trace.svelte";

export {
	Root,
	Line,
	Icon,
	Title,
	Description,
	Collapsible,
	Trigger,
	Content,
	//
	Root as Trace,
	Line as TraceLine,
	Icon as TraceIcon,
	Title as TraceTitle,
	Description as TraceDescription,
	Collapsible as TraceCollapsible,
	Trigger as TraceCollapsibleTrigger,
	Content as TraceCollapsibleContent,
};
