import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  csvForPairs,
  defaultPair,
  directionSummaries,
  eligiblePairs,
  loadComplementarity,
  loadPairProfiles,
  pairGain,
  score,
  stablePairs,
  studySummary,
} from "../src/lib/complementarity";
import type { ComplementarityData, PairScope } from "../src/types/complementarity";

const directory = resolve(process.cwd(), "public/data/complementarity");
const data: ComplementarityData = JSON.parse(readFileSync(resolve(directory, "study.json"), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("audited all-configuration complementarity publication", () => {
  it("publishes the complete exact-configuration universe with frozen provenance", () => {
    expect(data.schema_version).toBe(8);
    expect(data.weighting).toBe("equal_events_within_event_equal_targets");
    expect(data.event_type_taxonomy).toBe("forecastbench-seven-domain-v1.0.0");
    expect(data.event_type_domains).toEqual([
      { id: "health", label: "Health" },
      { id: "politics", label: "Politics" },
      { id: "sports", label: "Sports" },
      { id: "finance", label: "Finance" },
      { id: "technology", label: "Technology" },
      { id: "climate_weather", label: "Climate / Weather" },
      { id: "entertainment_culture", label: "Entertainment / Culture" },
    ]);
    expect(data.event_type_fold_ins).toEqual({
      science: "health", conflict: "politics", economics: "finance", ai: "technology",
    });
    expect(data.ability_thresholds).toEqual([3, 5]);
    expect(data.pair_scopes.map(scope => scope.id)).toEqual([
      "all", "different_model_version", "matched_conditions",
    ]);
    expect(data.pairs).toHaveLength(16_376);
    expect(new Set(data.pairs.map(pair => `${pair.dimension}:${pair.id}`)).size).toBe(16_376);
    expect(data.summaries).toHaveLength(480);
    expect(data.directions).toHaveLength(4_800);
    expect(data.configurations).toHaveLength(313);
    expect(new Set(data.configurations.map(config => config.exact_configuration)).size).toBe(313);
    expect(data.sample).toMatchObject({
      scored_configurations: 313,
      canonical_model_versions: 96,
      prompt_counts: { scratchpad: 122, zero_shot: 190, unspecified: 1 },
      information_counts: {
        freeze_values: 141, news_freeze: 12, news: 14, none: 142,
        web_search_freeze: 2, web_search: 2,
      },
      genuine_scored_predictions: 1_273_203,
      targets: 26_531,
      events: 3_670,
    });
    expect(data.primary_method).toBe("cf_directional");
    expect(data.methods.map(method => method.id)).toEqual([
      "simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional",
    ]);
    expect(data.methods.every(method => method.kind === "deployable")).toBe(true);
    expect(data.pairs.every(pair => Object.keys(pair.methods).length === 5)).toBe(true);
    expect(data.calibration).toMatchObject({
      metric: "expected_calibration_error",
      implementation: "prophet-arena-engine-2.2.0-compatible",
      probability_bins: 10,
      binning: "uniform_equal_width_over_[0,1]",
      aggregation: "pooled_common_probability_outcome_pairs",
      row_weighting: "uniform",
      uses_question_fixed_effect: false,
      uses_brier_index_normalization: false,
      lower_is_better: true,
    });
    expect(data.pairs.every(pair => Object.keys(pair.calibration.methods).length === 5)).toBe(true);
    expect(data.stability).toMatchObject({
      metric: "event_clustered_category_bi_edge",
      confidence_level: .9,
      interval: "two_sided_delta_method",
      cluster_unit: "event",
      score_weighting: "equal_events_within_event_equal_targets",
      brier_index: "100 * (1 - sqrt(event_averaged_ordinary_brier_score))",
      primary_rule: "both_opposite_category_edge_lower_bounds_above_0_bi",
      strict_rule: "both_opposite_category_edge_lower_bounds_above_1_bi",
      strict_margin_bi: 1,
      selection_split: "training_only",
      uses_test_outcomes: false,
      changes_aggregation: false,
    });
    expect(data.audit).toMatchObject({
      status: "PASS",
      implementation_independent: true,
      sampled_rows: 80,
      restricted_run_invariance_rows: 0,
      event_disjointness: "PASS",
      output_rows: 216_874,
      category_profile_rows: 60_792,
      profile_shards: 32,
      calibration: {
        status: "PASS",
        pair_views: 16_376,
        unique_pairs: 10_570,
        profile_rows: 60_792,
      },
      stability: {
        status: "PASS",
        pair_views: 16_376,
        profile_rows: 60_792,
        primary_eligible_views_before_ui_controls: 3_465,
        strict_eligible_views_before_ui_controls: 1_490,
      },
    });
    expect(data.audit.max_absolute_error).toBeLessThan(2e-11);
    expect(data.audit.calibration.max_overall_bi_reconstruction_error).toBeLessThan(1e-9);
    expect(data.audit.calibration.max_profile_bi_reconstruction_error).toBeLessThan(1e-9);
    expect(data.audit.stability.max_profile_bi_gap_reconstruction_error).toBeLessThan(1e-9);

    const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
    expect(manifest.weighting).toBe("equal_events_within_event_equal_targets");
    for (const [name, info] of Object.entries(manifest.files) as [string, { sha256: string; bytes: number }][]) {
      const bytes = readFileSync(resolve(directory, name));
      expect(bytes.length, name).toBe(info.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(info.sha256);
    }
  });

  it("publishes nested, training-only stable category cohorts", () => {
    const expected = [
      [3, "topic", 997, 418], [3, "source", 1_931, 886],
      [5, "topic", 1_155, 493], [5, "source", 2_310, 997],
    ] as const;
    for (const [gap, dimension, mainCount, strictCount] of expected) {
      const main = stablePairs(data, dimension, gap, "all", "main");
      const strict = stablePairs(data, dimension, gap, "all", "strict");
      expect(main).toHaveLength(mainCount);
      expect(strict).toHaveLength(strictCount);
      const mainIds = new Set(main.map(pair => pair.id));
      expect(strict.every(pair => mainIds.has(pair.id))).toBe(true);
      expect(main.every(pair => pair.stability.score_bi! > 0)).toBe(true);
      expect(strict.every(pair => pair.stability.score_bi! > 1)).toBe(true);
    }

    const original = stablePairs(data, "topic", 3, "all", "main").map(pair => pair.id);
    const perturbed = {
      ...data,
      pairs: data.pairs.map(pair => ({
        ...pair,
        test_bi_a: -999,
        test_bi_b: 999,
        calibration: { ...pair.calibration, test_a: 1, test_b: 0 },
      })),
    };
    expect(stablePairs(perturbed, "topic", 3, "all", "main").map(pair => pair.id)).toEqual(original);
  });

  it.each([
    ["all", 3, .5, 2431, 3181], ["all", 5, .5, 2805, 3819],
    ["different_model_version", 3, .5, 2334, 3118],
    ["matched_conditions", 3, .5, 624, 1065], ["matched_conditions", 5, .5, 667, 1201],
  ] as const)("reproduces %s gap %s / coverage %s crossing counts", (scope, gap, coverage, topic, source) => {
    expect(eligiblePairs(data, "topic", coverage, "crossing", gap, scope)).toHaveLength(topic);
    expect(eligiblePairs(data, "source", coverage, "crossing", gap, scope)).toHaveLength(source);
  });

  it("reconstructs every published primary mean for every pair scope", () => {
    for (const row of data.summaries) {
      const pairs = eligiblePairs(
        data,
        row.dimension,
        row.coverage,
        row.cohort,
        row.ability_gap as 3 | 5,
        row.pair_scope,
      );
      expect(pairs.length).toBe(row.n);
      const gains = pairs.map(pair => pairGain(pair, row.method)).filter((value): value is number => value !== null);
      expect(gains).toHaveLength(row.n_defined);
      if (gains.length) {
        expect(gains.reduce((total, value) => total + value, 0) / gains.length)
          .toBeCloseTo(row.mean_gain_vs_test_best_bi!, 10);
      }
    }
  });

  it.each([
    ["all", "topic", 2431, 1.4269637524878005, .9658576717400247],
    ["all", "source", 3181, .850282189700947, .9371266897202137],
    ["matched_conditions", "topic", 624, .9406039637263786, .9663461538461539],
    ["matched_conditions", "source", 1065, .5999251690836802, .9117370892018779],
  ] as const)("uses unchanged Directional CF for %s / %s", (scope, dimension, n, gain, winRate) => {
    const summary = studySummary(
      data, dimension, .5, "crossing", 3, "cf_directional", scope as PairScope,
    )!;
    expect(summary.n).toBe(n);
    expect(summary.mean_gain_vs_test_best_bi).toBeCloseTo(gain, 12);
    expect(summary.beats_both_rate).toBeCloseTo(winRate, 12);
  });

  it("keeps model version, prompt and information identity inspectable", () => {
    const matched = eligiblePairs(data, "topic", .5, "crossing", 3, "matched_conditions");
    expect(matched.every(pair => pair.same_prompt && pair.same_information)).toBe(true);
    expect(matched.every(pair => !pair.same_model_version)).toBe(true);
    const crossCondition = eligiblePairs(data, "topic", .5, "crossing", 3, "all")
      .find(pair => !pair.same_prompt || !pair.same_information);
    expect(crossCondition).toBeDefined();
    expect(data.configurations.find(config => config.exact_configuration === crossCondition!.model_a))
      .toMatchObject({ exact_configuration: crossCondition!.model_a });
  });

  it("publishes a stable featured exact pair and loads its category profile lazily", async () => {
    const pair = defaultPair(
      eligiblePairs(data, "topic", .5, "crossing", 3),
      undefined,
      data.featured_pair_id,
    )!;
    expect(pair.id).toBe("p-baa8649cff5a");
    expect(pair).toMatchObject({ same_model_version: false, same_prompt: true, same_information: true });
    expect(pair.train_gap).toBeCloseTo(.6856989397119051, 12);
    expect(pairGain(pair, "cf_directional")).toBeCloseTo(2.9259845278732897, 12);
    expect(pairGain(pair, "simple_mean")).toBeCloseTo(.9438221699917761, 12);
    expect(pairGain(pair, "piecewise_odds")).toBeCloseTo(1.4237562756255215, 12);
    expect(pair.calibration).toMatchObject({
      train_a: 0.1325058466813847,
      train_b: 0.1089033189033189,
      test_a: 0.15075918932029403,
      test_b: 0.10384144895448945,
    });
    expect(pair.calibration.methods.cf_directional).toBeCloseTo(0.05815280712563299, 14);
    expect(pair.crossing_persists).toBe(true);

    const shard = readFileSync(resolve(directory, `profiles/${pair.profile_shard}.json`), "utf8");
    const fetcher = vi.fn().mockResolvedValue(new Response(shard));
    vi.stubGlobal("fetch", fetcher);
    const profiles = await loadPairProfiles(pair);
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    expect(profiles.map(profile => profile.group)).toContain(pair.group_a);
    expect(profiles.map(profile => profile.group)).toContain(pair.group_b);
    expect(profiles.every(profile => Object.keys(profile.calibration.methods).length === 5)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows positive ten-direction stability and exact gap nesting", () => {
    for (const scope of ["all", "matched_conditions"] as const) {
      for (const dimension of ["topic", "source"] as const) {
        const rows = directionSummaries(data, dimension, .5, "crossing", 3, "cf_directional", scope);
        expect(rows).toHaveLength(10);
        expect(rows.every(row => row.mean_gain_vs_test_best_bi! > 0)).toBe(true);
        const narrow = new Set(eligiblePairs(data, dimension, .5, "crossing", 3, scope).map(pair => pair.id));
        const wide = new Set(eligiblePairs(data, dimension, .5, "crossing", 5, scope).map(pair => pair.id));
        expect([...narrow].every(id => wide.has(id))).toBe(true);
      }
    }
  });

  it("never filters with test skill and never converts missing results to zero", () => {
    const original = eligiblePairs(data, "topic", .5, "crossing", 3, "matched_conditions");
    const perturbed = { ...data, pairs: data.pairs.map(pair => ({ ...pair, test_gap: 999, test_bi_a: -100, test_bi_b: 100 })) };
    expect(eligiblePairs(perturbed, "topic", .5, "crossing", 3, "matched_conditions").map(pair => pair.id))
      .toEqual(original.map(pair => pair.id));
    const missing = { ...data.pairs[0], methods: { ...data.pairs[0].methods, cf_directional: null } };
    expect(pairGain(missing, "cf_directional")).toBeNull();
    expect(score(null)).toBe("—");
    expect(score(0)).toBe("0.000");
    expect(csvForPairs([missing], "cf_directional")).not.toMatch(/NaN|undefined|null|global_convex/);
  });

  it("rejects failed or incompatible publications and supports retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...data, weighting: "balanced" })))
      .mockResolvedValueOnce(new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadComplementarity()).rejects.toThrow(/503/);
    await expect(loadComplementarity()).rejects.toThrow(/expected audited study/);
    await expect(loadComplementarity()).resolves.toHaveProperty("pairs.length", 16_376);
  });
});
