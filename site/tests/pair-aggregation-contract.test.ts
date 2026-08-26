import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeAggregationPoints } from "../src/components/PairAggregationExplorer";
import type { AggregationMethodId, PairAggregationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "pair-aggregation", "all-six-family-pairs.json"), "utf8"),
) as PairAggregationData;
const pools: AggregationMethodId[] = ["ec_w0_56", "simple_mean", "log_odds_mean", "piecewise_odds"];
const scoreMethods = [
  "model_a",
  "model_b",
  ...pools,
  "best_single",
  "past_only_best_single",
] as const;

describe("all-pair aggregation contract", () => {
  it("publishes the frozen six-family pair universe", () => {
    expect(payload.points).toHaveLength(337);
    expect(payload.points.filter((point) => point.near_bi)).toHaveLength(144);
    expect(payload.pair_scope.group_counts).toEqual({
      gpt_gpt: 18,
      claude_claude: 34,
      gemini_gemini: 6,
      qwen_qwen: 2,
      deepseek_deepseek: 1,
      kimi_kimi: 2,
      gpt_claude: 64,
      gpt_gemini: 28,
      gpt_qwen: 19,
      gpt_deepseek: 13,
      gpt_kimi: 13,
      claude_gemini: 40,
      claude_qwen: 27,
      claude_deepseek: 12,
      claude_kimi: 20,
      gemini_qwen: 8,
      gemini_deepseek: 11,
      gemini_kimi: 8,
      qwen_deepseek: 2,
      qwen_kimi: 6,
      deepseek_kimi: 3,
    });
    expect(payload.model_scope.gpt_models).toHaveLength(11);
    expect(payload.model_scope.claude_models).toHaveLength(13);
    expect(payload.model_scope.gemini_models).toHaveLength(9);
    expect(payload.model_scope.qwen_models).toHaveLength(4);
    expect(payload.model_scope.deepseek_models).toHaveLength(3);
    expect(payload.model_scope.kimi_models).toHaveLength(3);
    expect(payload.model_scope.gpt_models).not.toContain("GPT-4o");
    expect(payload.model_scope.gpt_models).toContain("GPT-4o-2024-05-13");
    expect(payload.provenance.model_alias_audit).toEqual({
      aliases: { "GPT-4o": "GPT-4o-2024-05-13" },
      remapped_rows: { "GPT-4o": 1_507 },
      target_collisions: 0,
    });
  });

  it("uses the same common support and exact Best Single denominator for every method", () => {
    expect(payload.brier_index).toEqual({
      formula: "(1 - sqrt(adjusted_brier)) * 100",
      higher_is_better: true,
      cross_fit_aggregation:
        "test-support-weighted mean of fold-level BI across 10 random A/B repetitions and both directions",
    });
    for (const point of payload.points) {
      expect(point.n_overlap).toBeGreaterThanOrEqual(payload.pair_scope.minimum_overlap);
      const best = Math.min(point.adjusted_brier.model_a, point.adjusted_brier.model_b);
      expect(point.adjusted_brier.best_single).toBeCloseTo(best, 14);
      expect(point.gain_fraction_vs_best_single.best_single).toBe(0);
      for (const method of scoreMethods) {
        const expected = (1 - Math.sqrt(point.adjusted_brier[method])) * 100;
        expect(point.brier_index[method]).toBeCloseTo(expected, 12);
      }
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
    expect(payload.cross_fit.split.repetitions).toBe(10);
    expect(payload.cross_fit.split.seeds).toEqual([
      20260825, 20260826, 20260827, 20260828, 20260829,
      20260830, 20260831, 20260832, 20260833, 20260834,
    ]);
    expect(payload.cross_fit.audit.pair_fold_records).toBe(6_740);
    expect(payload.cross_fit.eligible_points).toHaveLength(337);
    expect(payload.cross_fit.near_bi_points).toHaveLength(227);
    expect(payload.cross_fit.directional_points.a_to_b.eligible_points).toHaveLength(337);
    expect(payload.cross_fit.directional_points.a_to_b.near_bi_points).toHaveLength(216);
    expect(payload.cross_fit.directional_points.b_to_a.eligible_points).toHaveLength(337);
    expect(payload.cross_fit.directional_points.b_to_a.near_bi_points).toHaveLength(210);
    expect(payload.cross_fit.audit.minimum_observed_train_rows).toBeGreaterThanOrEqual(50);
    expect(payload.cross_fit.audit.minimum_observed_test_rows).toBeGreaterThanOrEqual(50);
    expect(payload.cross_fit.leakage_controls.event_disjoint).toBe(true);
    expect(payload.cross_fit.leakage_controls.near_bi).toContain("train-fold");

    const sameSampleByPair = new Map(payload.points.map((point) => [
      `${point.model_a}::${point.model_b}`,
      point,
    ]));
    const aToBByPair = new Map(payload.cross_fit.directional_points.a_to_b.eligible_points.map((point) => [
      `${point.model_a}::${point.model_b}`,
      point,
    ]));
    const bToAByPair = new Map(payload.cross_fit.directional_points.b_to_a.eligible_points.map((point) => [
      `${point.model_a}::${point.model_b}`,
      point,
    ]));
    for (const point of payload.cross_fit.eligible_points) {
      const base = sameSampleByPair.get(`${point.model_a}::${point.model_b}`)!;
      const aToB = aToBByPair.get(`${point.model_a}::${point.model_b}`)!;
      const bToA = bToAByPair.get(`${point.model_a}::${point.model_b}`)!;
      expect(point.cross_fit?.included_fold_count).toBe(20);
      expect(point.cross_fit?.fold_ids).toHaveLength(20);
      expect(new Set(point.cross_fit?.fold_ids).size).toBe(20);
      expect(point.n_overlap).toBe(base.n_overlap * 10);
      for (const method of scoreMethods) {
        expect(Number.isFinite(point.adjusted_brier[method])).toBe(true);
        expect(Number.isFinite(point.brier_index[method])).toBe(true);
        const expected = (
          aToB.brier_index[method] * aToB.n_overlap
          + bToA.brier_index[method] * bToA.n_overlap
        ) / (aToB.n_overlap + bToA.n_overlap);
        expect(point.brier_index[method]).toBeCloseTo(expected, 12);
      }
    }
    for (const direction of ["a_to_b", "b_to_a"] as const) {
      for (const point of payload.cross_fit.directional_points[direction].eligible_points) {
        expect(point.cross_fit?.included_fold_count).toBe(10);
        expect(point.cross_fit?.fold_ids).toHaveLength(10);
      }
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
