import { describe, expect, it } from "vitest";
import { aggregationScore, colorForScore, findPair, formatMetric, sortPairs } from "../src/lib/metrics";
import type { MetricDefinition, PairMetrics } from "../src/types/data";

const pair = (id: string, value: number): PairMetrics => ({
  a: `${id}-a`, b: `${id}-b`, n_overlap: 100, n_dates: 3,
  metrics: {
    adjusted_pog: { value, se: null, ci95: null },
    high_loss_lift: { value, se: null, ci95: null },
    adjusted_loss_corr: { value, se: null, ci95: null },
  },
  diagnostics: { mean_bi_gap: 1, near_bi: true }, row_id: id,
});

const higher: MetricDefinition = {
  id: "adjusted_pog", label: "POG", short_label: "POG", direction: "higher", format: ".3f", description: "test",
};
const lower: MetricDefinition = { ...higher, id: "adjusted_loss_corr", direction: "lower" };

describe("aggregation metric helpers", () => {
  it("normalizes every metric toward aggregation-friendly values", () => {
    expect(aggregationScore(3, higher, [1, 2, 3])).toBe(1);
    expect(aggregationScore(1, lower, [1, 2, 3])).toBe(1);
  });

  it("sorts in the metric-defined direction", () => {
    expect(sortPairs([pair("low", 1), pair("high", 3)], higher)[0].row_id).toBe("high");
    expect(sortPairs([pair("low", 1), pair("high", 3)], lower)[0].row_id).toBe("low");
  });

  it("finds an unordered pair and formats missing values", () => {
    const candidate = pair("one", 0.125);
    expect(findPair([candidate], candidate.b, candidate.a)).toBe(candidate);
    expect(formatMetric(null, "adjusted_pog")).toBe("—");
    expect(formatMetric(1.234, "high_loss_lift")).toBe("1.23");
  });

  it("uses purple at the aggregation-friendly end of the scale", () => {
    expect(colorForScore(1)).toBe("rgb(79, 32, 127)");
    expect(colorForScore(0)).toBe("rgb(239, 171, 2)");
  });
});
