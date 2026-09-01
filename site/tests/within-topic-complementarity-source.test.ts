import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(resolve(process.cwd(), "src/components/FocalWithinTopicComplementarity.tsx"), "utf8");
const parent = readFileSync(resolve(process.cwd(), "src/components/MarketDiversityPerformanceExplorer.tsx"), "utf8");

describe("within-topic complementarity source contract", () => {
  it("is linked to the first-chart exact selection and remains the final Markets block", () => {
    expect(parent).toContain("<FocalWithinTopicComplementarity selectedConfiguration={selectedConfiguration || null} />");
    expect(parent.indexOf("<FocalWithinTopicComplementarity")).toBeGreaterThan(parent.indexOf("<FocalComplementarityExplorer"));
  });

  it("uses triangle/circle only for held-out improvement and explains the two ability gates", () => {
    expect(component).toContain('data-outcome={point.y > EPS ? "beats-both" : "below-or-tied"}');
    expect(component).toContain('className="within-topic-glyph win"');
    expect(component).toContain('className="within-topic-glyph miss"');
    expect(component).toContain("Shape does not encode prompt or information");
    expect(component).toContain("Ability is controlled twice");
  });

  it("contains English copy only", () => {
    expect(component).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
