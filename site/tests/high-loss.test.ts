import { describe, expect, it } from "vitest";
import { highLossAssociationReason, highLossAxis, highLossSparseCount, rawPearson, rawSpearman } from "../src/lib/highLoss";

describe("high-loss display preserves the metric", () => {
  it("compresses the negative tail without clipping or exceeding the metric upper bound", () => {
    const axis = highLossAxis([-34.26282051282051, 1, 1], [0, 100]);
    expect(axis.position(-34.26282051282051)).toBe(0);
    expect(axis.position(1)).toBe(100);
    expect(axis.position(-1)).toBeGreaterThan(60);
    expect(axis.domain[1]).toBe(1);
    expect(axis.ticks.every((tick) => tick >= axis.domain[0] && tick <= 1)).toBe(true);
    expect(axis.ticks).toContain(0);
  });
  it("keeps constant and empty chart domains valid without fabricating values", () => {
    for (const values of [[], [1], [0, 0], [-34, -34]]) {
      const axis = highLossAxis(values, [20, 100]);
      expect(axis.domain[1]).toBeGreaterThan(axis.domain[0]);
      expect(axis.ticks.every(Number.isFinite)).toBe(true);
    }
  });
  it("does not report a seven-point correlation determined by a single x outlier", () => {
    expect(highLossAssociationReason([-34, 1, 1, 1, 1, 1, 1], [79, 78, 77, 76, 75, 74, 73])).toContain("only 2 distinct");
    expect(highLossAssociationReason([-3, -1, 1], [1, 3, 2], [1, 2, 3], 20)).toContain("fewer than half");
    expect(highLossAssociationReason([-3, -1, 1], [1, 3, 2], [10, 20, 20], 20)).toBeNull();
  });
  it("uses raw values for correlation, with exact constants and invalid values rejected", () => {
    expect(rawPearson([0.1, 0.1, 0.1], [1, 2, 3])).toBeNull();
    expect(rawPearson([1, NaN, 3], [1, 2, 3])).toBeNull();
    expect(rawPearson([1, 2], [1, 2])).toBeCloseTo(1); // Existing non-high-loss behavior.
    expect(highLossAssociationReason([1, 2], [1, 2])).toContain("fewer than three");
    expect(rawPearson([-3, -1, 1], [1, 2, 3])).toBeCloseTo(1);
    expect(rawSpearman([-3, -1, -1, 1], [1, 2, 2, 3])).toBeCloseTo(1);
  });
  it("warns on sparse marginal counts without demanding a positive joint count", () => {
    expect(highLossSparseCount([{ high_count_a: 1, high_count_b: 2, joint_high_count: 1 }, { high_count_a: 10, high_count_b: 10, joint_high_count: 0 }])).toBe(1);
  });
});
