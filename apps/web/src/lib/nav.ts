import type { IconSvgElement } from "@hugeicons/svelte";
import {
  AiBrain01Icon,
  Briefcase01Icon,
  ChartIncreaseIcon,
  FlaskConicalIcon,
  Globe02Icon,
  Message01Icon,
  News01Icon,
  Notebook01Icon,
} from "./icons";
import type { Section } from "./ui.svelte";

export interface NavItem {
  value: Section;
  label: string;
  icon: IconSvgElement;
}

/** Desktop navigation and the phone's bottom tabs share the first five; History and Lab live in the phone menu. */
export const PRIMARY_NAV: NavItem[] = [
  { value: "feed", label: "Feed", icon: Message01Icon },
  { value: "portfolio", label: "Portfolio", icon: Briefcase01Icon },
  { value: "markets", label: "Markets", icon: Globe02Icon },
  { value: "performance", label: "Performance", icon: ChartIncreaseIcon },
  { value: "agent", label: "Agent", icon: AiBrain01Icon },
];

export const SECONDARY_NAV: NavItem[] = [
  { value: "history", label: "Journal and orders", icon: Notebook01Icon },
  { value: "reports", label: "Reports", icon: News01Icon },
  { value: "lab", label: "Lab", icon: FlaskConicalIcon },
];

/** Desktop bar order: Reports sits after Performance; the phone keeps its five bottom tabs and finds Reports in the menu. */
export const DESKTOP_NAV: NavItem[] = [
  ...PRIMARY_NAV.filter((i) => i.value !== "agent"),
  SECONDARY_NAV.find((i) => i.value === "reports")!,
  PRIMARY_NAV.find((i) => i.value === "agent")!,
  SECONDARY_NAV.find((i) => i.value === "lab")!,
];

/** `?view=` values from shortcuts and old links. Every nav value opens its section; `live` is the old feed shortcut. */
const VIEW_ALIASES: Record<string, Section> = { live: "feed" };

export function sectionFromParam(v: string | null): Section | null {
  if (!v) return null;
  if (v in VIEW_ALIASES) return VIEW_ALIASES[v]!;
  return [...PRIMARY_NAV, ...SECONDARY_NAV].some((i) => i.value === v) ? (v as Section) : null;
}
