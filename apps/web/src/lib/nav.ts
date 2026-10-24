import type { IconSvgElement } from "@hugeicons/svelte";
import {
  AiBrain01Icon,
  Briefcase01Icon,
  ChartIncreaseIcon,
  FlaskConicalIcon,
  Globe02Icon,
  Message01Icon,
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
  { value: "lab", label: "Lab", icon: FlaskConicalIcon },
];

/** `?view=` values from shortcuts and old links. */
export function sectionFromParam(v: string | null): Section | null {
  if (v === "live") return "feed";
  return v && [...PRIMARY_NAV, ...SECONDARY_NAV].some((i) => i.value === v) ? (v as Section) : null;
}
