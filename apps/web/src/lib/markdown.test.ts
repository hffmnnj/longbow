import { describe, expect, it } from "vitest";
import { markdownToUnsafeHtml } from "./markdown";

describe("markdownToUnsafeHtml", () => {
  it("keeps single tildes as approximate-value text", () => {
    const html = markdownToUnsafeHtml("R ~1.3 EV ~0.2% fails");
    expect(html).not.toContain("<del>");
    expect(html).toContain("~1.3");
    expect(html).toContain("~0.2%");
  });

  it("still strikes through double-tilde text", () => {
    expect(markdownToUnsafeHtml("was ~~buy~~ hold")).toContain("<del>buy</del>");
  });
});
