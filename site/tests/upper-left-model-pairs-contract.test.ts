// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("upper-left model-pair payload", () => {
  it("publishes both requested blocks with four methods", () => {
    const payload = JSON.parse(readFileSync("public/data/pair-aggregation/upper-left-model-pairs.json", "utf8"));
    expect(payload.fixed.models).toHaveLength(18);
    expect(payload.crossfit.split_repetitions).toBe(10);
    expect(payload.crossfit.directions_per_repetition).toBe(2);
    expect(payload.methods.map((item: { id: string }) => item.id)).toEqual([
      "simple_mean",
      "log_odds_mean",
      "ec_w0_56",
      "piecewise_odds",
    ]);
    expect(payload.market_reference.pair_matched_support).toBe(true);
    expect(payload.audit.selection_uses_test_outcomes).toBe(false);
    expect(payload.audit.pair_aggregation_uses_test_outcomes).toBe(false);
    expect(payload.audit.match_audit.missing_freeze_values).toBe(0);
    expect(payload.fixed.market.n).toBe(payload.audit.match_audit.matched_freeze_values);
  });

  it("uses triangle eligibility from pair-matched market BI", () => {
    const payload = JSON.parse(readFileSync("public/data/pair-aggregation/upper-left-model-pairs.json", "utf8"));
    expect(new Set(payload.fixed.rows.map((row: { market_bi: number }) => row.market_bi.toFixed(10))).size).toBeGreaterThan(1);
    expect(new Set(payload.crossfit.rows.map((row: { market_bi: number }) => row.market_bi.toFixed(10))).size).toBeGreaterThan(1);
    for (const row of [...payload.fixed.rows, ...payload.crossfit.rows]) {
      expect(row.beats_market).toBe(row.aggregation_bi > row.market_bi);
      expect(row.aggregation_minus_market_bi).toBeCloseTo(row.aggregation_bi - row.market_bi, 10);
    }
  });

  it("reports both event-disjoint directions for every cross-fit average", () => {
    const payload = JSON.parse(readFileSync("public/data/pair-aggregation/upper-left-model-pairs.json", "utf8"));
    expect(payload.crossfit.selection_runs).toHaveLength(20);
    expect(new Set(payload.crossfit.selection_runs.map((row: { repetition: number }) => row.repetition)).size).toBe(10);
    expect(new Set(payload.crossfit.selection_runs.map((row: { train_fold: string; test_fold: string }) => `${row.train_fold}->${row.test_fold}`))).toEqual(new Set(["A->B", "B->A"]));
    for (const row of payload.crossfit.rows) {
      expect(row.a_to_b.count + row.b_to_a.count).toBe(row.evaluation_count);
      expect(row.evaluation_count).toBeLessThanOrEqual(20);
      expect(row.maximum_evaluations).toBe(20);
    }
  });
});
