import type { SubagentRole } from "@rh/shared";
import type { IconSvgElement } from "@hugeicons/svelte";
import { Analytics01Icon, SearchingIcon, Shield01Icon, TradeDownIcon, TradeUpIcon } from "./icons";

export const ROLE_META: Record<SubagentRole, { label: string; icon: IconSvgElement }> = {
  analyst: { label: "Analyst", icon: Analytics01Icon },
  bull: { label: "Bull", icon: TradeUpIcon },
  bear: { label: "Bear", icon: TradeDownIcon },
  risk_reviewer: { label: "Risk reviewer", icon: Shield01Icon },
  researcher: { label: "Researcher", icon: SearchingIcon },
};

/** Last non-empty line of the streamed text, else the last finished message, else the task. */
export function latestLine(draft: string | undefined, lastText: string | undefined, fallback: string): string {
  const pick = (s: string | undefined) =>
    (s ?? "")
      .split("\n")
      .map((l) => l.replace(/[*_`#>]/g, "").trim())
      .filter(Boolean)
      .pop();
  return pick(draft) ?? pick(lastText) ?? fallback;
}
