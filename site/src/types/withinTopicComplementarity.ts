import type { ComplementarityConfiguration, PairScope, Score } from "./complementarity";

export type WithinTopicMetric = "normalized_pog" | "adjusted_pog";
export type WithinTopicOutcome = "topic" | "overall";
export type OverallGap = 3 | 5;
export type TopicGap = 1 | 2 | 3;
export type TopicSupport = 20 | 30 | 50;

export interface WithinTopicMethodResult {
  topic_bi: Score;
  overall_bi: Score;
}

export interface WithinTopicPair {
  id: string;
  topic: string;
  model_a: string;
  model_b: string;
  train_overall_events: number;
  test_overall_events: number;
  train_topic_events: number;
  test_topic_events: number;
  train_topic_rows: number;
  test_topic_rows: number;
  train_overall_gap: number;
  train_mean_bi: number;
  train_topic_gap: number;
  train_bi_a: Score;
  train_bi_b: Score;
  train_topic_bi_a: Score;
  train_topic_bi_b: Score;
  test_bi_a: Score;
  test_bi_b: Score;
  test_topic_bi_a: Score;
  test_topic_bi_b: Score;
  test_topic_support_ok: boolean;
  train_adjusted_pog: Score;
  train_normalized_pog: Score;
  train_a_rescue: Score;
  train_b_rescue: Score;
  train_a_win_share: Score;
  train_b_win_share: Score;
  train_tie_share: Score;
  train_mean_raw_loss: Score;
  alpha_up: Score;
  alpha_down: Score;
  train_origin_dataset_fraction: Score;
  same_provider: boolean;
  same_model_version: boolean;
  same_prompt: boolean;
  same_information: boolean;
  methods: Record<string, WithinTopicMethodResult>;
}

export interface WithinTopicFocalData {
  schema_version: 1;
  focal: string;
  pairs: WithinTopicPair[];
}

export interface WithinTopicSummary {
  pair_scope: PairScope;
  overall_gap: number;
  topic_gap: number;
  support: number;
  method: string;
  outcome: WithinTopicOutcome;
  metric: WithinTopicMetric;
  n: number;
  n_defined: number;
  mean_gain_bi: Score;
  beats_both_rate: Score;
  top_quartile_n: number;
  top_quartile_n_defined: number;
  top_quartile_mean_gain_bi: Score;
  top_quartile_beats_both_rate: Score;
  pearson: Score;
  spearman: Score;
}

export interface WithinTopicValidation {
  pair_scope: PairScope;
  method: string;
  outcome: WithinTopicOutcome;
  metric: WithinTopicMetric;
  n: number;
  n_defined: number;
  top_quartile_n: number;
  top_quartile_n_defined: number;
  mean_gain_bi: Score;
  top_quartile_mean_gain_bi: Score;
  top_quartile_beats_both_rate: Score;
  positive_top_minus_all_directions: number;
  defined_directions: number;
  mean_top_minus_all_gain_bi: Score;
  overall_mean_bi_correlation: Score;
  topic_mean_bi_correlation: Score;
  overall_gap_correlation: Score;
  topic_gap_correlation: Score;
  regression_n: number;
  standardized_pog_beta: Score;
  base_r2: Score;
  pog_incremental_r2: Score;
}

export interface WithinTopicStudy {
  schema_version: 1;
  study: string;
  date: string;
  primary_split: string;
  primary_fold: number;
  weighting: "uniform_rows_within_topic";
  event_split: string;
  event_type_taxonomy: "forecastbench-seven-domain-v1.0.0";
  topics: Array<{ id: string; label: string }>;
  overall_gap_thresholds: OverallGap[];
  topic_gap_thresholds: TopicGap[];
  support_thresholds: TopicSupport[];
  test_topic_support: number;
  pair_scopes: Array<{ id: PairScope; label: string }>;
  methods: Array<{ id: string; label: string }>;
  metrics: Array<{ id: WithinTopicMetric; label: string }>;
  outcomes: Array<{ id: WithinTopicOutcome; label: string }>;
  configurations: ComplementarityConfiguration[];
  focal_files: Record<string, string>;
  summaries: WithinTopicSummary[];
  primary_summaries: WithinTopicSummary[];
  validation: {
    schema_version: 1;
    status: "PASS";
    interpretation: string;
    main_controls: {
      overall_train_bi_gap: 3;
      topic_train_bi_gap: 1;
      minimum_train_topic_events: 30;
    };
    validations: WithinTopicValidation[];
    directions: Array<Record<string, unknown>>;
    topics: Array<Record<string, unknown>>;
  };
  sample: {
    configurations: number;
    canonical_model_versions: number;
    events: number;
    targets: number;
    pair_topic_directions: number;
    primary_pair_topics: number;
    split_directions: number;
  };
  audit: {
    status: "PASS";
    event_disjointness: "PASS";
    implementation_independent: true;
    independent_sampled_rows: number;
    independent_maximum_absolute_error: number;
    train_only_selection: true;
    no_test_gap_filter: true;
    max_existing_aggregation_bi_error: number;
    max_pog_identity_error: number;
  };
  provenance: Record<string, string>;
}
