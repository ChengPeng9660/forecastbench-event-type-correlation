import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FreezeMarketCorrelationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "freeze-exposed-correlation.json"), "utf8"),
) as FreezeMarketCorrelationData;

describe("with-freeze model/market correlation contract", () => {
  it("publishes only explicit with-freeze canonical configurations", () => {
    expect(payload.audit.model_count).toBe(27);
    expect(payload.audit.configuration_count).toBe(39);
    expect(payload.audit.prompt_counts).toEqual({ zero_shot: 27, scratchpad: 12 });
    expect(payload.audit.model_event_cells).toBe(13_614);
    expect(payload.audit.all_configs_explicitly_with_freeze).toBe(true);
    expect(payload.audit.all_configs_exclude_news).toBe(true);
    expect(payload.audit.excluded_news_augmented_candidate_configurations).toBe(9);
    expect(payload.points).toHaveLength(39);
    expect(new Set(payload.points.map((point) => point.model)).size).toBe(27);
    expect(new Set(payload.points.map((point) => point.prompt_type))).toEqual(new Set(["zero_shot", "scratchpad"]));
    expect(payload.points.every((point) => point.exact_configuration.toLowerCase().includes("with freeze values"))).toBe(true);
    expect(payload.points.every((point) => !point.exact_configuration.toLowerCase().includes("news"))).toBe(true);
    expect(payload.provenance.site_filter).toContain("exclude");
    expect(payload.provenance.market_probability).toContain("freeze_datetime_value");
    expect(payload.provenance.imputation_policy).toContain("exclude");
  });

  it("keeps Polymarket fixed and treats every exact freeze prompt as one pair", () => {
    expect(payload.aggregation.market_baseline).toBe("ForecastBench freeze_datetime_value");
    expect(payload.scope).toContain("separate observation");
    expect(new Set(payload.points.map((point) => point.exact_configuration)).size).toBe(payload.points.length);
    for (const point of payload.points) {
      expect(point.exact_configuration).toMatch(/\((zero shot|scratchpad) with freeze values\)$/i);
      expect(point.n_common).toBeGreaterThanOrEqual(50);
      for (const score of Object.values(point.aggregation)) {
        expect(score.test_target_cells).toBe(point.n_common * 10);
      }
      for (const direction of ["a_to_b", "b_to_a"] as const) {
        const view = point.directions[direction];
        expect(view.base_name).toBe("Polymarket Freeze");
        expect(view.partner_name).toBe(point.exact_configuration);
        expect(view.train_target_cells).toBeGreaterThan(0);
        expect(view.test_target_cells).toBeGreaterThan(0);
        for (const score of Object.values(view.aggregation)) {
          expect(score.test_target_cells).toBe(view.test_target_cells);
        }
      }
      expect(point.directions.a_to_b.test_target_cells + point.directions.b_to_a.test_target_cells)
        .toBe(point.aggregation.cf_directional.test_target_cells);
    }
  });

  it("defines diversity and Near-BI from the aggregated train-fold fields", () => {
    expect(payload.aggregation.evaluation).toContain("event-disjoint two-fold cross-fit");
    expect(payload.aggregation.evaluation).toContain("training outcomes only");
    expect(payload.aggregation.near_bi).toEqual({
      threshold_bi_points: 2,
      definition: "mean train-fold BI gap at most 2.0 points",
      pair_count: 29,
    });
    expect(payload.aggregation.near_bi.pair_count).toBe(
      payload.points.filter((point) => point.near_bi).length,
    );
    for (const point of payload.points) {
      expect(point.near_bi).toBe(point.train_bi_gap <= 2);
      expect(point.train_near_bi_share).toBeGreaterThanOrEqual(0);
      expect(point.train_near_bi_share).toBeLessThanOrEqual(1);
      for (const value of Object.values(point.train_diversity)) {
        expect(value === null || Number.isFinite(value)).toBe(true);
      }
    }
    expect(payload.aggregation.methods.cf_directional).toMatchObject({
      role: "Train-fold fitted closed-form pool",
      outcome_blind_at_test: true,
    });
    expect(payload.aggregation.methods.best_single.outcome_blind_at_test).toBe(false);
  });

  it("reproduces every published support-weighted summary", () => {
    const support = payload.points.reduce((sum, point) => sum + point.n_common, 0);
    const weighted = (field: "prediction_pearson" | "exact_copy_share" | "mean_absolute_difference") => (
      payload.points.reduce((sum, point) => sum + point[field] * point.n_common, 0) / support
    );
    expect(support).toBe(payload.audit.model_event_cells);
    expect(weighted("prediction_pearson")).toBeCloseTo(payload.audit.support_weighted_prediction_pearson, 12);
    expect(weighted("exact_copy_share")).toBeCloseTo(payload.audit.support_weighted_exact_copy_share, 12);
    expect(weighted("mean_absolute_difference")).toBeCloseTo(payload.audit.support_weighted_mean_absolute_difference, 12);

    expect(payload.aggregation.summary_all).toHaveLength(6);
    for (const summary of payload.aggregation.summary_all) {
      const pairSupport = payload.points.reduce(
        (sum, point) => sum + point.aggregation[summary.method].test_target_cells,
        0,
      );
      const aggregationWeighted = (field: "brier_index" | "gain_vs_market" | "gain_vs_model") => (
        payload.points.reduce(
          (sum, point) => sum + point.aggregation[summary.method][field] * point.aggregation[summary.method].test_target_cells,
          0,
        ) / pairSupport
      );
      expect(summary.pair_count).toBe(39);
      expect(summary.test_target_cells).toBe(pairSupport);
      expect(summary.support_weighted_brier_index).toBeCloseTo(aggregationWeighted("brier_index"), 12);
      expect(summary.support_weighted_gain_vs_market).toBeCloseTo(aggregationWeighted("gain_vs_market"), 12);
      expect(summary.support_weighted_gain_vs_model).toBeCloseTo(aggregationWeighted("gain_vs_model"), 12);
      expect(summary.positive_vs_market_pairs).toBe(payload.points.filter((point) => point.aggregation[summary.method].gain_vs_market > 0).length);
    }
  });

  it("keeps correlation, probability-distance, support, and BI fields in valid ranges", () => {
    for (const point of payload.points) {
      expect(point.n_common).toBeGreaterThan(1);
      expect(point.prediction_pearson).toBeGreaterThanOrEqual(-1);
      expect(point.prediction_pearson).toBeLessThanOrEqual(1);
      expect(point.exact_copy_share).toBeGreaterThanOrEqual(0);
      expect(point.exact_copy_share).toBeLessThanOrEqual(1);
      expect(point.mean_absolute_difference).toBeGreaterThanOrEqual(0);
      expect(point.root_mean_squared_difference).toBeGreaterThanOrEqual(point.mean_absolute_difference);
      expect(Number.isFinite(point.market_brier_index)).toBe(true);
      expect(Number.isFinite(point.model_brier_index)).toBe(true);
      expect(Number.isFinite(point.model_gain_vs_market)).toBe(true);
      for (const score of Object.values(point.aggregation)) {
        expect(Number.isFinite(score.brier_index)).toBe(true);
        expect(Number.isFinite(score.gain_vs_market)).toBe(true);
        expect(Number.isFinite(score.gain_vs_model)).toBe(true);
        expect(score.test_target_cells).toBe(point.n_common * 10);
      }
    }
    expect(payload.audit.correlation_minimum).toBe(Math.min(...payload.points.map((point) => point.prediction_pearson)));
    expect(payload.audit.correlation_maximum).toBe(Math.max(...payload.points.map((point) => point.prediction_pearson)));
  });
});
