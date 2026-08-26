import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FixedBaseAggregationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "without-freeze-base.json"), "utf8"),
) as FixedBaseAggregationData;

describe("without-freeze fixed-base aggregation contract", () => {
  it("publishes exact same-version exposure pairs with a fixed base", () => {
    expect(payload.schema_version).toBe("1.0.0");
    expect(payload.audit.configuration_count).toBe(36);
    expect(payload.audit.model_count).toBe(26);
    expect(payload.audit.prompt_counts).toEqual({ zero_shot: 26, scratchpad: 10 });
    expect(payload.audit.all_bases_fixed_without_freeze).toBe(true);
    expect(payload.audit.all_partners_explicit_with_freeze).toBe(true);
    expect(payload.points).toHaveLength(36);
    for (const point of payload.points) {
      expect(point.base_configuration).toMatch(/\(without freeze values\)$/i);
      expect(point.partner_configuration).toMatch(/\((zero shot|scratchpad) with freeze values\)$/i);
      expect(point.base_configuration.toLowerCase()).toContain(point.model.toLowerCase());
      expect(point.partner_configuration.toLowerCase()).toContain(point.model.toLowerCase());
      expect(point.combined.base_name).toBe(point.base_configuration);
      expect(point.combined.partner_name).toBe(point.partner_configuration);
    }
  });

  it("keeps both cross-fit directions separate and exactly reconstructs Combined support", () => {
    for (const point of payload.points) {
      const aToB = point.directions.a_to_b;
      const bToA = point.directions.b_to_a;
      expect(aToB.base_name).toBe(point.base_configuration);
      expect(bToA.base_name).toBe(point.base_configuration);
      expect(aToB.partner_name).toBe(point.partner_configuration);
      expect(bToA.partner_name).toBe(point.partner_configuration);
      expect(aToB.test_target_cells + bToA.test_target_cells).toBe(point.combined.test_target_cells);
      for (const method of Object.keys(point.combined.aggregation) as Array<keyof typeof point.combined.aggregation>) {
        expect(aToB.aggregation[method].test_target_cells + bToA.aggregation[method].test_target_cells)
          .toBe(point.combined.aggregation[method].test_target_cells);
      }
    }
  });

  it("reproduces the published combined method summaries", () => {
    expect(payload.evaluation.summary_combined).toHaveLength(6);
    for (const summary of payload.evaluation.summary_combined) {
      const scores = payload.points.map((point) => point.combined.aggregation[summary.method]);
      const support = scores.reduce((sum, score) => sum + score.test_target_cells, 0);
      const weighted = (field: "brier_index" | "gain_vs_base" | "gain_vs_partner") => (
        scores.reduce((sum, score) => sum + score[field] * score.test_target_cells, 0) / support
      );
      expect(summary.pair_count).toBe(36);
      expect(summary.test_target_cells).toBe(support);
      expect(summary.support_weighted_brier_index).toBeCloseTo(weighted("brier_index"), 12);
      expect(summary.support_weighted_gain_vs_base).toBeCloseTo(weighted("gain_vs_base"), 12);
      expect(summary.support_weighted_gain_vs_partner).toBeCloseTo(weighted("gain_vs_partner"), 12);
      expect(summary.positive_vs_base_pairs).toBe(scores.filter((score) => score.gain_vs_base > 0).length);
    }
  });

  it("records all three excluded prompt configurations", () => {
    expect(Object.keys(payload.audit.excluded_configurations)).toHaveLength(3);
    expect(payload.audit.excluded_configurations).toHaveProperty("DeepSeek-R1 (zero shot with freeze values)");
    expect(payload.audit.excluded_configurations).toHaveProperty("DeepSeek-R1 (scratchpad with freeze values)");
    expect(payload.audit.excluded_configurations).toHaveProperty("Qwen3-235B-A22B-Fp8-Tput (scratchpad with freeze values)");
  });
});
