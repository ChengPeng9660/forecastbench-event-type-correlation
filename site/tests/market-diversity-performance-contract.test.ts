import { describe, expect, it } from "vitest";
import payload from "../public/data/polymarket-aggregation/market-diversity-performance.json";

describe("market diversity performance payload", () => {
  it("keeps model information and prompt configurations separate", () => {
    expect(payload.audit.eligible_exact_configurations).toBe(payload.points.length);
    expect(payload.audit.eligible_canonical_model_versions).toBeLessThan(payload.points.length);
    expect(new Set(payload.points.map((point) => point.exact_configuration)).size).toBe(payload.points.length);
    expect(new Set(payload.points.map((point) => point.information_type)).size).toBe(6);
    expect(payload.points.every((point) => point.n_common >= payload.eligibility.minimum_overlap)).toBe(true);
  });

  it("scores every model and market baseline on matched support", () => {
    expect(payload.audit.all_scores_use_identical_pair_support).toBe(true);
    for (const point of payload.points) {
      expect(Number.isFinite(point.model.raw_brier)).toBe(true);
      expect(Number.isFinite(point.model.brier_index)).toBe(true);
      expect(Number.isFinite(point.matched_market.raw_brier)).toBe(true);
      expect(Number.isFinite(point.matched_market.brier_index)).toBe(true);
    }
  });
});
