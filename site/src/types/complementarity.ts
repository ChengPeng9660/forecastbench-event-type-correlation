export type Dimension = "topic" | "source";
export type CohortKind = "crossing" | "eligible";
export type AbilityGap = 3 | 5;
export type Score = number | null;

export interface StudyMethod {
  id: string;
  label: string;
  kind: "original" | "research" | "hindsight";
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
  cross_provider: boolean;
  methods: Record<string, Score>;
  profiles: CategoryProfile[];
}

export interface AggregationSummary {
  view: "primary";
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

export interface StudyInterval {
  ability_gap: number;
  coverage: number;
  dimension: Dimension;
  cohort: CohortKind;
  target: string;
  n: number;
  mean: Score;
  ci_low: Score;
  ci_high: Score;
  interval: string;
}

export interface ComplementarityData {
  schema_version: 2;
  study: string;
  date: string;
  primary_split: string;
  primary_fold: number;
  weighting: "uniform_rows";
  ability_thresholds: AbilityGap[];
  coverage_thresholds: number[];
  models: string[];
  methods: StudyMethod[];
  pairs: StudyPair[];
  summaries: AggregationSummary[];
  directions: DirectionSummary[];
  intervals: StudyInterval[];
  sample: {
    scored_models: number;
    genuine_scored_predictions: number;
    targets: number;
    events: number;
    dates: string[];
  };
  audit: {
    status: string;
    implementation_independent: boolean;
    sampled_rows: number;
    max_absolute_error: number;
    event_disjointness: string;
    output_rows: number;
    category_profile_rows: number;
    source_manifest_sha256: string;
  };
  provenance: Record<string, string>;
}
