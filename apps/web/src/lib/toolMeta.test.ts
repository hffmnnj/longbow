import { describe, expect, it } from "vitest";
import { ROLE_META } from "./roles.ts";
import {
  BookOpen01Icon,
  Briefcase01Icon,
  ChartLineData01Icon,
  CommandIcon,
  FlaskConicalIcon,
  Note01Icon,
  Notebook01Icon,
  Search01Icon,
  Shield01Icon,
  Wrench01Icon,
} from "./icons.ts";
import {
  extractUrls,
  groupConsecutive,
  matchSubmitOrder,
  submitOrderFailed,
  toolFamily,
  toolIcon,
  toolTitle,
} from "./toolMeta.ts";

describe("toolFamily", () => {
  it.each([
    ["rh_status", "robinhood"],
    ["rh_review_equity_order", "robinhood"],
    ["get_portfolio", "robinhood"],
    ["get_quote", "robinhood"],
    ["market_indicators", "market"],
    ["market", "market"],
    ["sec_company", "sec"],
    ["web_search", "web"],
    ["open_page", "web"],
    ["find_in_page", "web"],
    ["skills_load", "skills"],
    ["skills", "skills"],
    ["notes_read", "notes"],
    ["record_decision", "journal"],
    ["submit_order", "risk"],
    ["get_risk_state", "risk"],
    ["delegate", "delegate"],
    ["sim_start", "lab"],
    ["codemode", "code"],
    ["something_new", "other"],
    [undefined, "other"],
  ] as const)("%s maps to %s", (name, family) => expect(toolFamily(name)).toBe(family));

  it("treats sec_ tools as SEC filings, not market data", () => {
    expect(toolFamily("sec_company")).toBe("sec");
    expect(toolFamily("sec_filings")).toBe("sec");
  });
});

describe("toolIcon", () => {
  it("uses one icon per tool family", () => {
    expect(toolIcon("get_quote")).toBe(Briefcase01Icon);
    expect(toolIcon("market_indicators")).toBe(ChartLineData01Icon);
    expect(toolIcon("sec_company")).toBe(BookOpen01Icon);
    expect(toolIcon("web_search")).toBe(Search01Icon);
    expect(toolIcon("skills_load")).toBe(CommandIcon);
    expect(toolIcon("notes_write")).toBe(Notebook01Icon);
    expect(toolIcon("record_decision")).toBe(Note01Icon);
    expect(toolIcon("submit_order")).toBe(Shield01Icon);
    expect(toolIcon("sim_start")).toBe(FlaskConicalIcon);
    expect(toolIcon("mystery_tool")).toBe(Wrench01Icon);
  });

  it("uses the subagent role glyph for delegate calls", () => {
    expect(toolIcon("delegate", '{"role":"bear","symbol":"SMH"}')).toBe(ROLE_META.bear.icon);
    expect(toolIcon("delegate", '{"role":"risk_reviewer","task":"x"}')).toBe(ROLE_META.risk_reviewer.icon);
    expect(toolIcon("delegate", "not json")).toBe(Wrench01Icon);
  });
});

describe("toolTitle", () => {
  it("names the subject from JSON arguments", () => {
    expect(toolTitle("market_indicators", '{"symbol":"NVDA"}')).toBe("Indicators for NVDA");
    expect(toolTitle("market_price_history", '{"symbol":"QQQ"}')).toBe("Price history for QQQ");
    expect(toolTitle("get_quote", '{"symbol":"MSFT"}')).toBe("Quote for MSFT");
    expect(toolTitle("skills_load", '{"name":"market-regime"}')).toBe("Loaded skill market-regime");
    expect(toolTitle("notes_read", '{"path":"plan.md"}')).toBe("Read plan.md");
    expect(toolTitle("web_search", '{"query":"MSFT guidance Azure growth"}')).toBe(
      "Searched the web for MSFT guidance Azure growth",
    );
    expect(toolTitle("open_page", '{"url":"https://example.com/a/b"}')).toBe("Opened example.com/a/b");
    expect(toolTitle("delegate", '{"role":"bear","symbol":"SMH"}')).toBe("Delegated to bear · SMH");
    expect(toolTitle("delegate", '{"role":"bull"}')).toBe("Delegated to bull");
    expect(toolTitle("record_decision", '{"action":"buy","symbol":"MSFT"}')).toBe("Recorded buy MSFT");
    expect(toolTitle("submit_order", '{"symbol":"MSFT","side":"buy","quantity":3}')).toBe("Submitted buy 3 MSFT");
  });

  it("falls back to a plain sentence when the summary is missing or not arguments", () => {
    expect(toolTitle("submit_order")).toBe("Submitted order");
    expect(toolTitle("web_search")).toBe("Searched the web");
    expect(toolTitle("web_search", "crude oil curve WTI backwardation narrows")).toBe("Searched the web");
    expect(toolTitle("delegate", "not json")).toBe("Delegated");
    expect(toolTitle("market_indicators")).toBe("Checked indicators");
  });
});

describe("groupConsecutive", () => {
  const calls = (names: string[]) => names.map((name, i) => ({ name, i }));

  it("groups long runs of the same tool and keeps order", () => {
    const groups = groupConsecutive(calls(["market_indicators", "market_indicators", "web_search", "market_indicators"]), (c) => c.name);
    expect(groups.map((g) => [g.name, g.items.length])).toEqual([
      ["market_indicators", 2],
      ["web_search", 1],
      ["market_indicators", 1],
    ]);
  });

  it("keeps delegate and submit_order calls solo so each keeps its own link", () => {
    const groups = groupConsecutive(calls(["delegate", "delegate", "submit_order", "submit_order"]), (c) => c.name);
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });
});

describe("extractUrls", () => {
  it("finds URLs, strips trailing punctuation and dedupes", () => {
    expect(extractUrls("see https://example.com/a and https://example.com/a.")).toEqual(["https://example.com/a"]);
    expect(extractUrls("no links here")).toEqual([]);
    expect(extractUrls(undefined)).toEqual([]);
  });
});

describe("matchSubmitOrder", () => {
  const orders = [
    { id: "ord-1", status: "pending_approval" },
    { id: "ord-2", status: "failed" },
  ] as never as Parameters<typeof matchSubmitOrder>[1];

  it("links a submit_order message to its order by id", () => {
    expect(matchSubmitOrder("order ord-1: pending_approval (MSFT buy 3 @ 413.2)", orders)?.id).toBe("ord-1");
    expect(matchSubmitOrder("nothing to see", orders)).toBeUndefined();
  });

  it("flags rejected and failed orders as errors", () => {
    expect(submitOrderFailed(orders[0])).toBe(false);
    expect(submitOrderFailed(orders[1])).toBe(true);
    expect(submitOrderFailed(undefined)).toBe(false);
  });
});
