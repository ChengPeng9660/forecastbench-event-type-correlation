import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FixedFocalWithoutFreezeData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "pair-aggregation", "fixed-focal-without-freeze.json"), "utf8"),
) as FixedFocalWithoutFreezeData;

describe("fixed-focal without-freeze aggregation contract", () => {
  it("publishes both orientations of every eligible canonical pair", () => {
    expect(payload.schema_version).toBe("1.0.0");
    expect(payload.audit).toMatchObject({
      model_count: 43,
      unordered_pair_count: 337,
      ordered_pair_count: 674,
      fold_directions_per_ordered_pair: 20,
      all_models_exclude_freeze_values: true,
      with_freeze_model_count: 0,
    });
    expect(payload.points).toHaveLength(674);
    const ordered = new Set(payload.points.map((point) => `${point.base_model}\u0000${point.partner_model}`));
    for (const point of payload.points) {
      expect(point.combined.base_name).toBe(point.base_model);
      expect(point.combined.partner_name).toBe(point.partner_model);
      expect(ordered.has(`${point.partner_model}\u0000${point.base_model}`)).toBe(true);
    }
  });

  it("keeps both OOS directions and reconstructs Combined support", () => {
    for (const point of payload.points) {
      for (const method of Object.keys(point.combined.aggregation) as Array<keyof typeof point.combined.aggregation>) {
        const combined = point.combined.aggregation[method];
        const aToB = point.directions.a_to_b.aggregation[method];
        const bToA = point.directions.b_to_a.aggregation[method];
        expect(aToB.test_target_cells + bToA.test_target_cells).toBe(combined.test_target_cells);
      }
    }
  });

  it("reproduces each overall method summary", () => {
    for (const summary of payload.evaluation.summary_combined) {
      const rows = payload.points.map((point) => point.combined.aggregation[summary.method]);
      const support = rows.reduce((sum, row) => sum + row.test_target_cells, 0);
      const weighted = (field: "brier_index" | "gain_vs_base" | "gain_vs_partner" | "gain_vs_best_single") => (
        rows.reduce((sum, row) => sum + row[field] * row.test_target_cells, 0) / support
      );
      expect(summary.ordered_pair_count).toBe(674);
      expect(summary.test_target_cells).toBe(support);
      expect(summary.support_weighted_brier_index).toBeCloseTo(weighted("brier_index"), 12);
      expect(summary.support_weighted_gain_vs_base).toBeCloseTo(weighted("gain_vs_base"), 12);
      expect(summary.support_weighted_gain_vs_partner).toBeCloseTo(weighted("gain_vs_partner"), 12);
      expect(summary.support_weighted_gain_vs_best_single).toBeCloseTo(weighted("gain_vs_best_single"), 12);
      expect(summary.positive_vs_base_pairs).toBe(rows.filter((row) => row.gain_vs_base > 0).length);
    }
  });
});
