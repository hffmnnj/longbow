import type { IconSvgElement } from "@hugeicons/svelte";
import type { ChatMessage, OrderRecord, SubagentRole, ToolCallSummary } from "@rh/shared";
import {
  BookOpen01Icon,
  Briefcase01Icon,
  ChartLineData01Icon,
  CodeIcon,
  CommandIcon,
  FlaskConicalIcon,
  Note01Icon,
  Notebook01Icon,
  Search01Icon,
  Shield01Icon,
  Wrench01Icon,
} from "./icons";
import { ROLE_META } from "./roles";

/**
 * Human titles, icons and grouping for the agent feed's Trace lines.
 * One icon per tool family (Robinhood, market data, SEC, web, skills, notes,
 * journal, risk and orders, delegate), following the AI Elements Tool pattern:
 * a sentence-like title plus the duration as the description.
 */

export type ToolFamily =
  | "robinhood"
  | "market"
  | "sec"
  | "web"
  | "skills"
  | "notes"
  | "journal"
  | "risk"
  | "delegate"
  | "lab"
  | "code"
  | "other";

export function toolFamily(name: string | undefined): ToolFamily {
  if (!name) return "other";
  if (name === "delegate") return "delegate";
  if (name === "codemode") return "code";
  if (name === "submit_order" || name === "get_risk_state") return "risk";
  if (name === "record_decision") return "journal";
  if (name.startsWith("rh_") || name === "get_portfolio" || name === "get_quote") return "robinhood";
  if (name === "market" || name.startsWith("market_")) return "market";
  if (name.startsWith("sec_")) return "sec";
  if (name === "web_search" || name === "open_page" || name === "find_in_page") return "web";
  if (name === "skills" || name.startsWith("skills_")) return "skills";
  if (name.startsWith("notes_")) return "notes";
  if (name.startsWith("sim_")) return "lab";
  return "other";
}

const FAMILY_ICON: Record<ToolFamily, IconSvgElement> = {
  robinhood: Briefcase01Icon,
  market: ChartLineData01Icon,
  sec: BookOpen01Icon,
  web: Search01Icon,
  skills: CommandIcon,
  notes: Notebook01Icon,
  journal: Note01Icon,
  risk: Shield01Icon,
  delegate: Wrench01Icon,
  lab: FlaskConicalIcon,
  code: CodeIcon,
  other: Wrench01Icon,
};

const ROLES: readonly SubagentRole[] = ["analyst", "bull", "bear", "risk_reviewer", "researcher"];

/** Subagent role named in a delegate call's summary (JSON arguments, possibly truncated). */
export function delegateRole(call: Pick<ToolCallSummary, "summary">): SubagentRole | undefined {
  const m = call.summary?.match(/"role"\s*:\s*"([a-z_]+)"/);
  const role = m?.[1] as SubagentRole | undefined;
  return role && ROLES.includes(role) ? role : undefined;
}

/** Family icon; delegate calls use their subagent role glyph when it parses. */
export function toolIcon(name: string | undefined, summary?: string, role?: string): IconSvgElement {
  if (name === "delegate") {
    const parsed = summary === undefined ? undefined : delegateRole({ summary });
    const direct = role && (ROLES as readonly string[]).includes(role) ? (role as SubagentRole) : undefined;
    const found = direct ?? parsed;
    if (found) return ROLE_META[found].icon;
  }
  return FAMILY_ICON[toolFamily(name)];
}

/** Best-effort parse of a call summary, which is usually JSON-encoded arguments. */
export function toolArgs(summary: string | undefined): Record<string, unknown> {
  if (!summary) return {};
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Plain-text summaries (transcript tool messages) carry no arguments.
  }
  return {};
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Shorten long queries, URLs and text to a readable length. */
export function truncate(text: string, max = 64): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** First line of a tool message, for the TraceDescription slot. */
export function firstLine(text: string | undefined, max = 72): string | undefined {
  if (!text) return undefined;
  const line = text.split("\n", 1)[0]?.trim();
  return line ? truncate(line, max) : undefined;
}

export function humanize(name: string): string {
  const s = name.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Tool";
}

function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return truncate(`${u.host}${path}`, 56);
  } catch {
    return truncate(url, 56);
  }
}

/**
 * Sentence-like title for one tool call ("Indicators for NVDA",
 * "Searched the web for …", "Delegated to bear · SMH"). Falls back to a
 * plain sentence when the summary is not JSON arguments.
 */
export function toolTitle(name: string, summary?: string): string {
  const args = toolArgs(summary);
  const hasArgs = Object.keys(args).length > 0;
  if (hasArgs) {
    const symbol = str(args.symbol);
    switch (name) {
      case "market_indicators":
        return symbol ? `Indicators for ${symbol}` : "Checked indicators";
      case "market_price_history":
        return symbol ? `Price history for ${symbol}` : "Fetched price history";
      case "market_compare": {
        const symbols = Array.isArray(args.symbols) ? args.symbols.filter((s): s is string => typeof s === "string") : [];
        return symbols.length > 0 ? `Compared ${symbols.join(" vs ")}` : "Compared symbols";
      }
      case "market_earnings":
        return symbol ? `Earnings for ${symbol}` : "Checked earnings";
      case "market_earnings_calendar":
        return "Earnings calendar";
      case "market_economic_calendar":
        return "Economic calendar";
      case "market_volatility":
        return symbol ? `Volatility for ${symbol}` : "Checked volatility";
      case "market_yields":
        return "Treasury yields";
      case "market":
        return "Market overview";
      case "sec_company":
        return symbol ?? str(args.cik) ? `SEC profile for ${symbol ?? str(args.cik)}` : "Checked SEC profile";
      case "get_quote":
        return symbol ? `Quote for ${symbol}` : "Checked quote";
      case "get_portfolio":
        return "Portfolio snapshot";
      case "web_search": {
        const query = str(args.query);
        return query ? `Searched the web for ${truncate(query)}` : "Searched the web";
      }
      case "open_page": {
        const url = str(args.url);
        return url ? `Opened ${hostAndPath(url)}` : "Opened page";
      }
      case "find_in_page": {
        const pattern = str(args.pattern);
        return pattern ? `Searched the page for ${truncate(pattern, 48)}` : "Searched within page";
      }
      case "skills_load": {
        const skill = str(args.name);
        return skill ? `Loaded skill ${skill}` : "Loaded skill";
      }
      case "skills_read_file": {
        const path = str(args.path);
        return path ? `Read ${path}` : "Read skill file";
      }
      case "skills":
        return "Listed skills";
      case "notes_list":
        return "Listed notes";
      case "notes_read":
        return str(args.path) ? `Read ${str(args.path)}` : "Read note";
      case "notes_write":
        return str(args.path) ? `Wrote ${str(args.path)}` : "Wrote note";
      case "notes_append":
        return str(args.path) ? `Appended to ${str(args.path)}` : "Appended to note";
      case "record_decision": {
        const action = str(args.action);
        if (action && symbol) return `Recorded ${action} ${symbol}`;
        if (action) return `Recorded ${action}`;
        if (symbol) return `Recorded decision for ${symbol}`;
        return "Recorded decision";
      }
      case "submit_order": {
        const side = str(args.side);
        const quantity = num(args.quantity);
        if (side && quantity !== undefined && symbol) return `Submitted ${side} ${quantity} ${symbol}`;
        if (symbol) return `Submitted order for ${symbol}`;
        return "Submitted order";
      }
      case "get_risk_state":
        return "Checked risk state";
      case "delegate": {
        const role = str(args.role);
        if (role && symbol) return `Delegated to ${role} · ${symbol}`;
        if (role) return `Delegated to ${role}`;
        return "Delegated";
      }
      case "codemode":
        return "Ran script";
      default:
        if (name.startsWith("rh_")) return humanize(name.slice(3));
        return humanize(name);
    }
  }
  switch (name) {
    case "market_indicators":
      return "Checked indicators";
    case "market_price_history":
      return "Fetched price history";
    case "market_compare":
      return "Compared symbols";
    case "market_earnings":
      return "Checked earnings";
    case "market_earnings_calendar":
      return "Checked earnings calendar";
    case "market_economic_calendar":
      return "Checked economic calendar";
    case "market_volatility":
      return "Checked volatility";
    case "market_yields":
      return "Checked Treasury yields";
    case "market":
      return "Checked market data";
    case "sec_company":
      return "Checked SEC profile";
    case "get_quote":
      return "Checked quote";
    case "get_portfolio":
      return "Checked portfolio";
    case "rh_status":
      return "Checked broker status";
    case "web_search":
      return "Searched the web";
    case "open_page":
      return "Opened page";
    case "find_in_page":
      return "Searched within page";
    case "skills_load":
      return "Loaded skill";
    case "skills_read_file":
      return "Read skill file";
    case "skills":
      return "Listed skills";
    case "notes_list":
      return "Listed notes";
    case "notes_read":
      return "Read note";
    case "notes_write":
      return "Wrote note";
    case "notes_append":
      return "Appended to note";
    case "record_decision":
      return "Recorded decision";
    case "submit_order":
      return "Submitted order";
    case "get_risk_state":
      return "Checked risk state";
    case "delegate":
      return "Delegated";
    case "codemode":
      return "Ran script";
    default:
      if (name.startsWith("rh_")) return humanize(name.slice(3));
      return humanize(name);
  }
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** URLs found in a call summary or message text, for the Sources pattern. */
export function extractUrls(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.match(URL_RE) ?? []) {
    const url = m.replace(/[.,;:!?]+$/, "");
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= 12) break;
  }
  return out;
}

export interface CallGroup<T> {
  name: string;
  items: T[];
}

/**
 * Group consecutive calls of the same tool into runs ("market_indicators ×11").
 * Delegate calls always stay solo so each keeps its own subagent link.
 */
export function groupConsecutive<T>(items: readonly T[], nameOf: (item: T) => string): CallGroup<T>[] {
  const groups: CallGroup<T>[] = [];
  for (const item of items) {
    const name = nameOf(item);
    const last = groups[groups.length - 1];
    if (last && last.name === name && name !== "delegate" && name !== "submit_order") {
      last.items.push(item);
    } else {
      groups.push({ name, items: [item] });
    }
  }
  return groups;
}

/** Link a `submit_order` tool message ("order ord-1: pending_approval …") to its order. */
export function matchSubmitOrder(text: string, orders: readonly OrderRecord[]): OrderRecord | undefined {
  const id = /\border\s+([A-Za-z0-9_-]+):/.exec(text)?.[1];
  return id === undefined ? undefined : orders.find((o) => o.id === id);
}

const BAD_ORDER_STATUS = new Set(["rejected_risk", "rejected_user", "failed", "expired"]);

/** True when the linked order ended badly, so the TraceLine shows the error status. */
export function submitOrderFailed(order: OrderRecord | undefined): boolean {
  return order !== undefined && BAD_ORDER_STATUS.has(order.status);
}

/** Display host for a source URL, with a favicon served from the domain. */
export function sourceMeta(url: string): { host: string; label: string } {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return { host: u.host, label: truncate(`${u.host}${path}`, 56) };
  } catch {
    return { host: url, label: truncate(url, 56) };
  }
}

export type AnyCall = ChatMessage | ToolCallSummary;

export function isMessageCall(call: AnyCall): call is ChatMessage {
  return "role" in call;
}

export function callName(call: AnyCall): string {
  return isMessageCall(call) ? (call.toolName ?? "tool") : call.name;
}

export function callSummary(call: AnyCall): string | undefined {
  return isMessageCall(call) ? undefined : call.summary;
}
