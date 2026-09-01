export type Dimension = "topic" | "source";
export type CohortKind = "crossing" | "eligible";
export type AbilityGap = 3 | 5;
export type PairScope = "all" | "different_model_version" | "matched_conditions";
export type Score = number | null;

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
  schema_version: 4;
  study: string;
  date: string;
  primary_split: string;
  primary_fold: number;
  weighting: "uniform_rows";
  ability_thresholds: AbilityGap[];
  coverage_thresholds: number[];
  primary_method: string;
  featured_pair_id: string;
  pair_scopes: Array<{ id: PairScope; label: string }>;
  models: string[];
  configurations: ComplementarityConfiguration[];
  methods: StudyMethod[];
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
  };
  provenance: Record<string, string>;
}
