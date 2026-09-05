export type Dimension = "topic" | "source";
export type CohortKind = "crossing" | "eligible";
export type AbilityGap = 3 | 5;
export type PairScope = "all" | "different_model_version" | "matched_conditions";
export type StabilityRule = "main" | "strict";
export type Score = number | null;

export interface CategoryGapStability {
  gap_bi: Score;
  se_bi: Score;
  events: number;
  ci_low_bi: Score;
  ci_high_bi: Score;
  lcb_for_a_bi: Score;
  lcb_for_b_bi: Score;
}

export interface PairStability {
  score_bi: Score;
  group_a: string | null;
  group_b: string | null;
  edge_a_lcb_bi: Score;
  edge_b_lcb_bi: Score;
  primary_eligible: boolean;
  strict_eligible: boolean;
  overall_gap_signed_bi: Score;
  overall_gap_se_bi: Score;
  overall_ci_low_bi: Score;
  overall_ci_high_bi: Score;
  overall_equivalent_gap_3: boolean;
  overall_equivalent_gap_5: boolean;
}

export interface CalibrationScores {
  train_a: Score;
  train_b: Score;
  test_a: Score;
  test_b: Score;
  methods: Record<string, Score>;
}

export interface StudyMethod {
  id: string;
  label: string;
  kind: "deployable";
}

export interface CategoryProfile {
  group: string;
  train_mass: number;
  test_mass: Score;
  train_events: number;
  test_events: number;
  train_bi_a: Score;
  train_bi_b: Score;
  test_bi_a: Score;
  test_bi_b: Score;
  test_support_ok: boolean;
  methods: Record<string, Score>;
  calibration: CalibrationScores;
  stability: CategoryGapStability;
}

export interface StudyPair {
  id: string;
  dimension: Dimension;
  model_a: string;
  model_b: string;
  train_events: number;
  test_events: number;
  train_rows: number;
  test_rows: number;
  train_gap: number;
  mean_train_bi: number;
  test_gap: Score;
  train_bi_a: Score;
  train_bi_b: Score;
  test_bi_a: Score;
  test_bi_b: Score;
  train_groups: Score;
  train_coverage: Score;
  train_between_norm: Score;
  train_between: Score;
  train_within: Score;
  train_total: Score;
  train_between_share: Score;
  train_origin_dataset_fraction: Score;
  crossing: boolean | null;
  crossing_persists: boolean | null;
  complete_test_profile: boolean | null;
  train_profile_bi_defined: boolean | null;
  group_a: string | null;
  group_b: string | null;
  same_provider: boolean;
  same_model_version: boolean;
  same_prompt: boolean;
  same_information: boolean;
  methods: Record<string, Score>;
  calibration: CalibrationScores;
  stability: PairStability;
  profile_key: string;
  profile_shard: string;
}

export interface ComplementarityConfiguration {
  exact_configuration: string;
  canonical_model_version: string;
  model_configuration: string;
  provider: string;
  prompt_type: "zero_shot" | "scratchpad" | "unspecified";
  prompt_label: string;
  information_type: string;
  information_label: string;
}

export interface AggregationSummary {
  view: "primary";
  pair_scope: PairScope;
  ability_gap: number;
  coverage: number;
  dimension: Dimension;
  cohort: CohortKind;
  method: string;
  n: number;
  n_defined: number;
  mean_gain_vs_test_best_bi: Score;
  median_gain_vs_test_best_bi: Score;
  beats_both_rate: Score;
  mean_gain_vs_train_selected_bi: Score;
  beats_train_selected_rate: Score;
  mean_increment_vs_global_bi: Score;
  mean_gain_vs_test_best_raw_loss: Score;
  mean_train_gap: Score;
  mean_test_gap: Score;
  mean_train_coverage: Score;
  mean_test_events: Score;
}

export interface DirectionSummary extends Omit<AggregationSummary, "view"> {
  view: "direction";
  split: string;
  fold: number;
}

export interface ComplementarityData {
  schema_version: 8;
  study: string;
  date: string;
  primary_split: string;
  primary_fold: number;
  weighting: "equal_events_within_event_equal_targets";
  event_type_taxonomy: "forecastbench-seven-domain-v1.0.0";
  event_type_domains: Array<{ id: string; label: string }>;
  event_type_fold_ins: Record<"science" | "conflict" | "economics" | "ai", string>;
  ability_thresholds: AbilityGap[];
  coverage_thresholds: number[];
  primary_method: string;
  featured_pair_id: string;
  pair_scopes: Array<{ id: PairScope; label: string }>;
  models: string[];
  configurations: ComplementarityConfiguration[];
  methods: StudyMethod[];
  calibration: {
    metric: "expected_calibration_error";
    label: "ECE";
    implementation: "prophet-arena-engine-2.2.0-compatible";
    probability_bins: 10;
    binning: "uniform_equal_width_over_[0,1]";
    boundaries: "left_closed_right_open_except_last_closed";
    aggregation: "pooled_common_probability_outcome_pairs";
    row_weighting: "uniform";
    uses_question_fixed_effect: false;
    uses_brier_index_normalization: false;
    lower_is_better: true;
  };
  stability: {
    metric: "event_clustered_category_bi_edge";
    label: "Stable category edge";
    confidence_level: 0.9;
    z_value: number;
    interval: "two_sided_delta_method";
    cluster_unit: "event";
    score_weighting: "equal_events_within_event_equal_targets";
    brier_index: "100 * (1 - sqrt(event_averaged_ordinary_brier_score))";
    primary_rule: "both_opposite_category_edge_lower_bounds_above_0_bi";
    strict_rule: "both_opposite_category_edge_lower_bounds_above_1_bi";
    strict_margin_bi: 1;
    selection_split: "training_only";
    uses_test_outcomes: false;
    changes_aggregation: false;
  };
  pairs: StudyPair[];
  summaries: AggregationSummary[];
  directions: DirectionSummary[];
  diagnostics: Record<string, unknown>;
  sample: {
    scored_configurations: number;
    canonical_model_versions: number;
    prompt_counts: Record<string, number>;
    information_counts: Record<string, number>;
    genuine_scored_predictions: number;
    targets: number;
    events: number;
    dates: string[];
  };
  audit: {
    status: string;
    implementation_independent: boolean;
    sampled_rows: number;
    restricted_run_invariance_rows: number;
    max_absolute_error: number;
    event_disjointness: string;
    output_rows: number;
    category_profile_rows: number;
    profile_shards: number;
    calibration: {
      status: "PASS";
      pair_views: number;
      unique_pairs: number;
      profile_rows: number;
      max_overall_bi_reconstruction_error: number;
      max_profile_bi_reconstruction_error: number;
      reconstruction_tolerance: number;
    };
    stability: {
      status: "PASS";
      pair_views: number;
      profile_rows: number;
      primary_eligible_views_before_ui_controls: number;
      strict_eligible_views_before_ui_controls: number;
      max_profile_bi_gap_reconstruction_error: number;
      reconstruction_tolerance: number;
    };
  };
  provenance: Record<string, string>;
}
