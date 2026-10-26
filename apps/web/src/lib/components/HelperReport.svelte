<script lang="ts">
  import type { ChatMessage } from "@rh/shared";
  import {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceDescription,
    TraceIcon,
    TraceLine,
    TraceTitle,
  } from "$lib/components/ui/trace/index.js";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import { etTime } from "$lib/format";
  import { ROLE_META } from "$lib/roles";
  import { helperReport } from "$lib/steps";
  import { toolIcon } from "$lib/toolMeta";

  /**
   * A long-running helper's report (AI Elements Tool pattern): a collapsed
   * Trace line with the helper's role glyph, "<name> reported" as the title
   * and the subagent role as the description, expanding to the report body.
   * Deliberately not a "You" bubble and not lead-agent prose: the tinted card
   * marks it as untrusted third-party data, never something the owner wrote.
   */
  let { message }: { message: ChatMessage } = $props();

  const report = $derived(helperReport(message));
  const icon = $derived(toolIcon("delegate", undefined, report.role));
  const roleLabel = $derived(
    report.role && report.role in ROLE_META ? ROLE_META[report.role as keyof typeof ROLE_META].label : report.role,
  );
  const collapsedLabel = $derived(`${report.name} reported${roleLabel ? `, ${roleLabel}` : ""}`);
</script>

<section class="rise-in border-border bg-muted/40 rounded-lg border px-3 py-2" aria-label={`Helper report from ${report.name}`}>
  <Trace>
    <TraceCollapsible>
      <TraceCollapsibleTrigger aria-label={collapsedLabel}>
        <TraceLine>
          <TraceIcon><Icon {icon} /></TraceIcon>
          <TraceTitle>{report.name} reported</TraceTitle>
          <TraceDescription class="truncate">
            {#if roleLabel}{roleLabel} · {/if}<span class="num">{etTime(message.at)}</span>
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div class="text-foreground text-[14px]"><Markdown text={report.body} /></div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</section>
