import { describe, expect, it } from "vitest";
import { RESEARCH_GROUPS, researchGroupFor, researchPageFromHash, usesAtlasFilters } from "../src/lib/navigation";

describe("public research navigation", () => {
  it("retains every original experiment as a unique deep link", () => {
    const sections = RESEARCH_GROUPS.flatMap((group) => group.sections.map((section) => section.id));
    expect(sections).toHaveLength(14);
    expect(new Set(sections).size).toBe(sections.length);
    for (const section of sections) {
      expect(researchPageFromHash(`#${section}`)).toBe(section);
      expect(researchGroupFor(section)?.sections.some((item) => item.id === section)).toBe(true);
    }
  });

  it("opens the public overview for root, legacy top, and unknown anchors", () => {
    for (const hash of ["", "#", "#top", "#overview", "#unknown-experiment"]) {
      expect(researchPageFromHash(hash)).toBe("overview");
    }
    expect(researchGroupFor("overview")).toBeUndefined();
  });

  it("shows shared atlas filters only where they actually apply", () => {
    expect(usesAtlasFilters("matrix")).toBe(true);
    expect(usesAtlasFilters("ranking")).toBe(true);
    expect(usesAtlasFilters("model-view")).toBe(true);
    for (const page of ["overview", "global", "gain", "polymarket-aggregation", "methods"] as const) {
      expect(usesAtlasFilters(page)).toBe(false);
    }
  });
});
