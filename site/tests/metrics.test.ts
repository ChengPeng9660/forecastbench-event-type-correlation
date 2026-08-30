import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colorForScore, dependenceScore, diversityScore, findPair, formatMetric, MODEL_DEPENDENCE_DIRECTION, orientMetricToDependence, sortPairs } from "../src/lib/metrics";
import { Heatmap } from "../src/components/Heatmap";
import type { MetricDefinition, Model, PairMetrics } from "../src/types/data";

afterEach(cleanup);

const pair = (id: string, value: number): PairMetrics => ({
  a: `${id}-a`, b: `${id}-b`, n_overlap: 100, n_dates: 3,
  metrics: {
    adjusted_pog: { value, se: null, ci95: null },
    high_loss_lift: { value, se: null, ci95: null },
    adjusted_loss_corr: { value, se: null, ci95: null },
    total_variation: { value, se: null, ci95: null },
  },
  diagnostics: { mean_bi_gap: 1, near_bi: true }, row_id: id,
});

const higher: MetricDefinition = {
  id: "adjusted_pog", label: "POG", short_label: "POG", direction: "higher", format: ".3f", description: "test",
};
const lower: MetricDefinition = { ...higher, id: "adjusted_loss_corr", direction: "lower" };

describe("model-dependence metric helpers", () => {
  it("renders zero TV as a valid heatmap cell rather than missing support", () => {
    const zeroPair = pair("zero", 0);
    const models: Model[] = [zeroPair.a, zeroPair.b].map((id, release_order) => ({ id, name: id, provider: "Test", family: "Test", release_order, n_targets: 100, n_dates: 3 }));
    render(createElement(Heatmap, {
      models, pairs: [zeroPair], metric: orientMetricToDependence({ ...higher, id: "total_variation" }),
      selectedModel: "", selectedPair: null, onSelectPair: vi.fn(),
    }));
    expect(screen.getAllByRole("button", { name: /: 0\.000$/ })).toHaveLength(2);
    expect(screen.queryByLabelText("Missing pair")).not.toBeInTheDocument();
  });

  it("normalizes every metric toward higher model dependence", () => {
    expect(dependenceScore(3, higher, [1, 2, 3])).toBe(1);
    expect(dependenceScore(1, lower, [1, 2, 3])).toBe(1);
  });

  it("normalizes every heatmap metric from lower to higher diversity", () => {
    expect(diversityScore(1, higher, [1, 2, 3])).toBe(1);
    expect(diversityScore(3, higher, [1, 2, 3])).toBe(0);
    expect(diversityScore(3, lower, [1, 2, 3])).toBe(1);
    expect(diversityScore(1, lower, [1, 2, 3])).toBe(0);
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

  it("uses a light-to-dark purple scale for model diversity", () => {
    expect(colorForScore(1)).toBe("rgb(79, 32, 127)");
    expect(colorForScore(0.5)).toBe("rgb(167, 129, 194)");
    expect(colorForScore(0)).toBe("rgb(244, 239, 248)");
  });

  it("keeps all pair-metric consumers aligned to dependence direction", () => {
    expect(MODEL_DEPENDENCE_DIRECTION).toEqual({
      adjusted_pog: "lower",
      high_loss_lift: "higher",
      adjusted_loss_corr: "higher",
      total_variation: "lower",
    });
    const pog = orientMetricToDependence(higher);
    const lift = orientMetricToDependence({ ...higher, id: "high_loss_lift" });
    const corr = orientMetricToDependence({ ...higher, id: "adjusted_loss_corr" });
    expect(dependenceScore(1, pog, [1, 3])).toBe(1);
    expect(dependenceScore(3, lift, [1, 3])).toBe(1);
    expect(dependenceScore(3, corr, [1, 3])).toBe(1);
    const tv = orientMetricToDependence({ ...higher, id: "total_variation" });
    expect(diversityScore(0.4, tv, [0, 0.4])).toBe(1);
    expect(diversityScore(0, tv, [0, 0.4])).toBe(0);
    expect(formatMetric(0.1234, "total_variation")).toBe("0.123");
  });
});
