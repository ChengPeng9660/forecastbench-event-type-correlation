import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeAggregationPoints } from "../src/components/PairAggregationExplorer";
import type { AggregationMethodId, PairAggregationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "pair-aggregation", "all-four-family-pairs.json"), "utf8"),
) as PairAggregationData;
const pools: AggregationMethodId[] = ["ec_w0_56", "simple_mean", "log_odds_mean", "piecewise_odds"];

describe("all-pair aggregation contract", () => {
  it("publishes the frozen four-family pair universe", () => {
    expect(payload.points).toHaveLength(196);
    expect(payload.points.filter((point) => point.near_bi)).toHaveLength(85);
    expect(payload.pair_scope.group_counts).toEqual({
      gpt_gpt: 19,
      claude_claude: 34,
      qwen_qwen: 2,
      deepseek_deepseek: 1,
      gpt_claude: 67,
      gpt_qwen: 19,
      gpt_deepseek: 13,
      claude_qwen: 27,
      claude_deepseek: 12,
      qwen_deepseek: 2,
    });
    expect(payload.model_scope.gpt_models).toHaveLength(12);
    expect(payload.model_scope.claude_models).toHaveLength(13);
    expect(payload.model_scope.qwen_models).toHaveLength(4);
    expect(payload.model_scope.deepseek_models).toHaveLength(3);
  });

  it("uses the same common support and exact Best Single denominator for every method", () => {
    for (const point of payload.points) {
      expect(point.n_overlap).toBeGreaterThanOrEqual(payload.pair_scope.minimum_overlap);
      const best = Math.min(point.adjusted_brier.model_a, point.adjusted_brier.model_b);
      expect(point.adjusted_brier.best_single).toBeCloseTo(best, 14);
      expect(point.gain_fraction_vs_best_single.best_single).toBe(0);
      for (const method of pools) {
        const expected = (best - point.adjusted_brier[method]) / best;
        expect(point.gain_fraction_vs_best_single[method]).toBeCloseTo(expected, 14);
      }
    }
  });

  it("keeps outcome-blind pools separate from the hindsight benchmark", () => {
    for (const method of pools) expect(payload.methods[method].outcome_blind).toBe(true);
    expect(payload.methods.best_single.outcome_blind).toBe(false);
    expect(payload.methods.best_single.role).toContain("hindsight");
    expect(payload.provenance.merged_model_rule).toContain("one outcome-blind representative");
  });

  it("cross-fits dependence and gain across disjoint event folds", () => {
    expect(payload.cross_fit.audit.unique_events).toBe(2_857);
    expect(payload.cross_fit.audit.pair_fold_records).toBe(392);
    expect(payload.cross_fit.eligible_points).toHaveLength(196);
    expect(payload.cross_fit.near_bi_points).toHaveLength(107);
    expect(payload.cross_fit.audit.minimum_observed_train_rows).toBeGreaterThanOrEqual(50);
    expect(payload.cross_fit.audit.minimum_observed_test_rows).toBeGreaterThanOrEqual(50);
    expect(payload.cross_fit.leakage_controls.event_disjoint).toBe(true);
    expect(payload.cross_fit.leakage_controls.near_bi).toContain("train-fold");

    const foldsByPair = new Map<string, typeof payload.cross_fit.fold_points>();
    for (const fold of payload.cross_fit.fold_points) {
      const key = `${fold.model_a}::${fold.model_b}`;
      foldsByPair.set(key, [...(foldsByPair.get(key) ?? []), fold]);
      expect(fold.n_train).toBeGreaterThanOrEqual(50);
      expect(fold.n_test).toBeGreaterThanOrEqual(50);
      expect(fold.train_fold).not.toBe(fold.test_fold);
      const best = Math.min(fold.adjusted_brier.model_a, fold.adjusted_brier.model_b);
      for (const method of pools) {
        const expected = (best - fold.adjusted_brier[method]) / best;
        expect(fold.gain_fraction_vs_best_single[method]).toBeCloseTo(expected, 14);
      }
    }
    expect(foldsByPair.size).toBe(196);
    for (const folds of foldsByPair.values()) {
      expect(folds).toHaveLength(2);
      expect(new Set(folds.map((fold) => fold.train_fold))).toEqual(new Set(["A", "B"]));
      expect(new Set(folds.map((fold) => fold.test_fold))).toEqual(new Set(["A", "B"]));
    }
  });

  it("recomputes the published summaries after focal-model filtering", () => {
    for (const published of payload.summary.filter((row) => pools.includes(row.method))) {
      const points = payload.points.filter((point) =>
        (published.pair_group === "all" || point.pair_group === published.pair_group)
        && (published.sample === "eligible" || point.near_bi)
      );
      const dynamic = summarizeAggregationPoints(points, published.method, published.pair_group, published.sample);
      expect(dynamic.pair_count).toBe(published.pair_count);
      expect(dynamic.pair_event_cells).toBe(published.pair_event_cells);
      expect(dynamic.positive_pairs).toBe(published.positive_pairs);
      expect(dynamic.macro_mean_gain_fraction).toBeCloseTo(published.macro_mean_gain_fraction!, 14);
      expect(dynamic.support_weighted_gain_fraction).toBeCloseTo(published.support_weighted_gain_fraction!, 14);
    }
  });
});
