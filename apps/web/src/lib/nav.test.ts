import { describe, expect, it } from "vitest";
import { DESKTOP_NAV, PRIMARY_NAV, SECONDARY_NAV, sectionFromParam } from "./nav.ts";

describe("sectionFromParam", () => {
  it("opens every primary nav value on its own section", () => {
    for (const item of PRIMARY_NAV) expect(sectionFromParam(item.value)).toBe(item.value);
  });

  it("opens every secondary nav value on its own section", () => {
    for (const item of SECONDARY_NAV) expect(sectionFromParam(item.value)).toBe(item.value);
  });

  it("maps the old live shortcut to the feed", () => {
    expect(sectionFromParam("live")).toBe("feed");
  });

  it("rejects unknown, empty and missing values so the app stays on the current section", () => {
    expect(sectionFromParam("portfolio-old")).toBeNull();
    expect(sectionFromParam("Feed")).toBeNull();
    expect(sectionFromParam("")).toBeNull();
    expect(sectionFromParam(null)).toBeNull();
  });

  it("opens the reports section from ?view=reports", () => {
    expect(sectionFromParam("reports")).toBe("reports");
  });

  it("keeps five bottom tabs on the phone and seats reports after performance on desktop", () => {
    expect(PRIMARY_NAV).toHaveLength(5);
    expect(PRIMARY_NAV.some((i) => i.value === "reports")).toBe(false);
    expect(SECONDARY_NAV.some((i) => i.value === "reports")).toBe(true);
    const order = DESKTOP_NAV.map((i) => i.value);
    expect(order.indexOf("reports")).toBe(order.indexOf("performance") + 1);
    expect(order.indexOf("lab")).toBe(order.length - 1);
  });
});
