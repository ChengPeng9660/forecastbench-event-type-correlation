import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AggregationMethodId,
  PolymarketAggregationData,
  PolymarketAggregationPoint,
} from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "freeze-baseline.json"), "utf8"),
) as PolymarketAggregationData;

const methods: AggregationMethodId[] = [
  "ec_w0_56",
  "simple_mean",
  "log_odds_mean",
  "piecewise_odds",
  "best_single",
  "past_only_best_single",
];
const scoreMethods = ["model_a", "model_b", ...methods] as const;

function pairKey(point: PolymarketAggregationPoint): string {
  return `${point.model_a}::${point.model_b}`;
}

describe("Polymarket freeze aggregation contract", () => {
  it("publishes the audited freeze baseline and the eligible six-family universe", () => {
    expect(payload.baseline).toMatchObject({
      id: "polymarket_freeze",
      label: "Polymarket Freeze",
      probability_field: "market_prob",
      upstream_field: "freeze_datetime_value",
      timestamp_field: "freeze_datetime",
      outcome_blind: true,
    });
    expect(payload.provenance.freeze_field_mapping).toContain("market_prob");
    expect(payload.provenance.freeze_field_mapping).toContain("freeze_datetime_value");
    expect(payload.provenance.join_key).toBe(
      "forecast_due_date + lowercase source=polymarket + event_id",
    );
    expect(payload.provenance.match_audit).toMatchObject({
      scored_polymarket_round_events: 1_057,
      unique_market_ids: 670,
      forecast_dates: 18,
      matched_freeze_values: 1_057,
      missing_freeze_values: 0,
    });

    expect(payload.points).toHaveLength(26);
    expect(payload.pair_scope.eligible_pair_count).toBe(26);
    const familyCounts = payload.points.reduce<Record<string, number>>((counts, point) => {
      counts[point.family_b] = (counts[point.family_b] ?? 0) + 1;
      return counts;
    }, {});
    expect(familyCounts).toEqual({
      Claude: 9,
      DeepSeek: 2,
      Gemini: 3,
      GPT: 7,
      Kimi: 2,
      Qwen: 3,
    });
    expect(payload.model_scope.gpt_models).toHaveLength(7);
    expect(payload.model_scope.claude_models).toHaveLength(9);
    expect(payload.model_scope.gemini_models).toHaveLength(3);
    expect(payload.model_scope.qwen_models).toHaveLength(3);
    expect(payload.model_scope.deepseek_models).toHaveLength(2);
    expect(payload.model_scope.kimi_models).toHaveLength(2);
    expect(payload.provenance.imputation_audit).toMatchObject({
      candidate_scored_polymarket_rows: 10_960,
      excluded_imputed_rows: 1_126,
      retained_non_imputed_rows: 9_834,
    });
    for (const point of payload.points) {
      expect(point.model_a).toBe("Polymarket Freeze");
      expect(point.family_a).toBe("Polymarket");
      expect(point.n_overlap).toBeGreaterThanOrEqual(payload.pair_scope.minimum_overlap);
    }
  });

  it("keeps same-sample and train-fold Near-BI eligibility separate", () => {
    expect(payload.near_bi.threshold_bi_points).toBe(2);
    expect(payload.pair_scope.near_bi_pair_count).toBe(0);
    expect(payload.points.some((point) => point.near_bi)).toBe(false);
    expect(payload.points.every((point) => point.bi_gap > payload.near_bi.threshold_bi_points)).toBe(true);
    expect(payload.cross_fit.audit.near_bi_pairs_any_train_fold).toBe(1);
    expect(payload.cross_fit.audit.near_bi_fold_records).toBe(1);
    expect(payload.cross_fit.near_bi_points).toHaveLength(1);
    expect(payload.cross_fit.directional_points.a_to_b.near_bi_points).toHaveLength(1);
    expect(payload.cross_fit.directional_points.b_to_a.near_bi_points).toEqual([]);
  });

  it("uses the higher-is-better BI formula on the same common support", () => {
    expect(payload.brier_index).toEqual({
      formula: "(1 - sqrt(adjusted_brier)) * 100",
      higher_is_better: true,
      cross_fit_aggregation:
        "test-support-weighted mean of fold-level BI across 10 random A/B repetitions and both directions",
    });
    for (const point of payload.points) {
      for (const method of scoreMethods) {
        const expected = (1 - Math.sqrt(point.adjusted_brier[method])) * 100;
        expect(point.brier_index[method]).toBeCloseTo(expected, 12);
      }
    }
  });

  it("computes every gain against the Polymarket and model adjusted-Brier denominators", () => {
    for (const collection of [payload.points, payload.cross_fit.eligible_points]) {
      for (const point of collection) {
        const polymarket = point.adjusted_brier.model_a;
        const model = point.adjusted_brier.model_b;
        for (const method of methods) {
          expect(point.gain_fraction_vs_polymarket[method]).toBeCloseTo(
            (polymarket - point.adjusted_brier[method]) / polymarket,
            12,
          );
          expect(point.gain_fraction_vs_model[method]).toBeCloseTo(
            (model - point.adjusted_brier[method]) / model,
            12,
          );
        }
      }
    }
  });

  it("publishes ten deterministic splits, both directions, and twenty combined records per pair", () => {
    expect(payload.cross_fit.split.repetitions).toBe(10);
    expect(payload.cross_fit.split.seeds).toEqual([
      20260825, 20260826, 20260827, 20260828, 20260829,
      20260830, 20260831, 20260832, 20260833, 20260834,
    ]);
    expect(payload.cross_fit.audit.eligible_pairs).toBe(26);
    expect(payload.cross_fit.audit.pair_fold_records).toBe(26 * 10 * 2);
    expect(payload.cross_fit.eligible_points).toHaveLength(26);
    expect(payload.cross_fit.directional_points.a_to_b.eligible_points).toHaveLength(26);
    expect(payload.cross_fit.directional_points.b_to_a.eligible_points).toHaveLength(26);
    expect(payload.cross_fit.audit.minimum_observed_train_rows).toBeGreaterThanOrEqual(50);
    expect(payload.cross_fit.audit.minimum_observed_test_rows).toBeGreaterThanOrEqual(50);
    expect(payload.cross_fit.leakage_controls.event_disjoint).toBe(true);
    expect(payload.cross_fit.leakage_controls.outcomes_used_to_form_current_pool).toBe(false);

    for (const point of payload.cross_fit.eligible_points) {
      expect(point.cross_fit?.included_fold_count).toBe(20);
      expect(point.cross_fit?.fold_ids).toHaveLength(20);
      expect(new Set(point.cross_fit?.fold_ids).size).toBe(20);
      expect(point.cross_fit?.fold_ids.filter((id) => id.includes("__A_train__B_test"))).toHaveLength(10);
      expect(point.cross_fit?.fold_ids.filter((id) => id.includes("__B_train__A_test"))).toHaveLength(10);
    }
    for (const direction of ["a_to_b", "b_to_a"] as const) {
      for (const point of payload.cross_fit.directional_points[direction].eligible_points) {
        expect(point.cross_fit?.included_fold_count).toBe(10);
        expect(point.cross_fit?.fold_ids).toHaveLength(10);
      }
    }
  });

  it("combines A-to-B and B-to-A by their test support", () => {
    const aToB = new Map(
      payload.cross_fit.directional_points.a_to_b.eligible_points.map((point) => [pairKey(point), point]),
    );
    const bToA = new Map(
      payload.cross_fit.directional_points.b_to_a.eligible_points.map((point) => [pairKey(point), point]),
    );
    const sameSample = new Map(payload.points.map((point) => [pairKey(point), point]));

    for (const combined of payload.cross_fit.eligible_points) {
      const first = aToB.get(pairKey(combined))!;
      const second = bToA.get(pairKey(combined))!;
      const base = sameSample.get(pairKey(combined))!;
      const total = first.n_overlap + second.n_overlap;
      expect(combined.n_overlap).toBe(total);
      expect(combined.n_overlap).toBe(base.n_overlap * 10);
      for (const method of scoreMethods) {
        const expectedBrier = (
          first.adjusted_brier[method] * first.n_overlap
          + second.adjusted_brier[method] * second.n_overlap
        ) / total;
        const expectedBi = (
          first.brier_index[method] * first.n_overlap
          + second.brier_index[method] * second.n_overlap
        ) / total;
        expect(combined.adjusted_brier[method]).toBeCloseTo(expectedBrier, 12);
        expect(combined.brier_index[method]).toBeCloseTo(expectedBi, 12);
      }
    }
  });
});
