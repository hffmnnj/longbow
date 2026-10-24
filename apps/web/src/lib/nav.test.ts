import { describe, expect, it } from "vitest";
import { PRIMARY_NAV, SECONDARY_NAV, sectionFromParam } from "./nav.ts";

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
});
