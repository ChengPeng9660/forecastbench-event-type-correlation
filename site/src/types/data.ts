export type MetricId = "adjusted_pog" | "high_loss_lift" | "adjusted_loss_corr";
export type ModelFamily = "GPT" | "Claude" | "Qwen" | "DeepSeek";

export interface FocalGainMetricValue {
  raw: number;
  complementarity: number;
}

export interface FocalGainPoint {
  partner: string;
  partner_family: "GPT" | "Claude";
  n_overlap: number;
  n_dates: number;
  date_min: string;
  date_max: string;
  near_bi: boolean;
  bi_gap: number;
  focal_adjusted_brier: number;
  partner_adjusted_brier: number;
  aggregate_adjusted_brier: number;
  gain_fraction: number;
  raw_gain_fraction: number;
  metrics: Record<MetricId, FocalGainMetricValue>;
}

export interface FocalGainData {
  schema_version: string;
  generated_at: string;
  scope: string;
  focal_model: string;
  partner_scope: string;
  aggregation: {
    id: string;
    label: string;
    weight: number;
    formula: string;
  };
  outcome: {
    id: string;
    label: string;
    formula: string;
    positive_means: string;
    weighting: string;
  };
  near_bi: {
    threshold_bi_points: number;
    definition: string;
  };
  metric_orientation: Record<MetricId, string>;
  provenance: {
    panel: string;
    panel_sha256: string;
    pair_metrics: string;
    pair_metrics_sha256: string;
    merged_model_rule: string;
  };
  points: FocalGainPoint[];
}

export type AggregationMethodId =
  | "ec_w0_56"
  | "simple_mean"
  | "log_odds_mean"
  | "piecewise_odds"
  | "best_single"
  | "past_only_best_single";

export type PairGroupId =
  | "gpt_gpt"
  | "claude_claude"
  | "qwen_qwen"
  | "deepseek_deepseek"
  | "gpt_claude"
  | "gpt_qwen"
  | "gpt_deepseek"
  | "claude_qwen"
  | "claude_deepseek"
  | "qwen_deepseek";
export type PairGroupFilter = "all" | PairGroupId;

export interface PairAggregationMethod {
  label: string;
  formula: string;
  outcome_blind: boolean;
  role?: string;
  threshold?: number;
  resolution_aware?: boolean;
}

export interface PairAggregationPoint {
  model_a: string;
  model_b: string;
  family_a: ModelFamily;
  family_b: ModelFamily;
  pair_group: PairGroupId;
  n_overlap: number;
  n_dates: number;
  date_min: string;
  date_max: string;
  near_bi: boolean;
  bi_gap: number;
  metrics: Record<MetricId, { raw: number | null; complementarity: number | null }>;
  adjusted_brier: Record<"model_a" | "model_b" | AggregationMethodId, number>;
  best_single_side: "model_a" | "model_b" | "mixed";
  gain_fraction_vs_best_single: Record<AggregationMethodId, number | null>;
  past_only_diagnostic: {
    cold_start_rows: number;
    model_a_choice_dates: number;
    model_b_choice_dates: number;
    uses_only_prior_forecast_dates: boolean;
    resolution_aware: boolean;
  };
  cross_fit?: {
    sample: "eligible" | "near_bi";
    included_fold_count: number;
    train_near_bi_fold_count: number;
    train_target_rows: number;
    test_target_rows: number;
    fold_ids: string[];
  };
}

export interface PairAggregationFoldPoint {
  fold_id: string;
  train_fold: "A" | "B";
  test_fold: "A" | "B";
  model_a: string;
  model_b: string;
  family_a: ModelFamily;
  family_b: ModelFamily;
  pair_group: PairGroupId;
  n_train: number;
  n_test: number;
  n_train_events: number;
  n_test_events: number;
  n_dates: number;
  date_min: string;
  date_max: string;
  train_near_bi: boolean;
  train_bi_gap: number;
  train_model_a_bi: number;
  train_model_b_bi: number;
  metrics: Record<MetricId, { raw: number | null; complementarity: number | null; reason: string }>;
  adjusted_brier: Record<"model_a" | "model_b" | AggregationMethodId, number>;
  best_single_side: "model_a" | "model_b";
  gain_fraction_vs_best_single: Record<AggregationMethodId, number | null>;
  past_only_diagnostic: PairAggregationPoint["past_only_diagnostic"];
}

export interface PairAggregationSummary {
  pair_group: PairGroupFilter;
  sample: "eligible" | "near_bi";
  method: AggregationMethodId;
  pair_count: number;
  pair_event_cells: number;
  positive_pairs: number;
  positive_pair_share: number | null;
  macro_mean_gain_fraction: number | null;
  support_weighted_gain_fraction: number | null;
  median_gain_fraction: number | null;
  p10_gain_fraction: number | null;
  p90_gain_fraction: number | null;
}

export interface PairAggregationData {
  schema_version: string;
  generated_at: string;
  scope: string;
  model_scope: {
    definition: string;
    gpt_models: string[];
    claude_models: string[];
    qwen_models: string[];
    deepseek_models: string[];
  };
  pair_scope: {
    eligible_pair_count: number;
    near_bi_pair_count: number;
    group_counts: Record<PairGroupId, number>;
    minimum_overlap: number;
    fold_ineligible_pair_count: number;
    common_support: string;
  };
  methods: Record<AggregationMethodId, PairAggregationMethod>;
  outcome: {
    id: string;
    formula: string;
    positive_means: string;
    pair_summary_weighting: string;
    score_weighting: string;
  };
  near_bi: {
    threshold_bi_points: number;
    definition: string;
  };
  provenance: {
    panel: string;
    panel_sha256: string;
    pair_metrics: string;
    pair_metrics_sha256: string;
    pair_metrics_role: string;
    merged_model_rule: string;
    model_alias_audit: {
      aliases: Record<string, string>;
      remapped_rows: Record<string, number>;
      target_collisions: number;
    };
    resolution_time_available: boolean;
  };
  summary: PairAggregationSummary[];
  points: PairAggregationPoint[];
  cross_fit: {
    schema_version: string;
    evaluation: string;
    split: {
      seed: number;
      unit: string;
      assignment: string;
      assignment_sha256: string;
      folds: string[];
      minimum_train_target_rows: number;
      minimum_test_target_rows: number;
    };
    leakage_controls: Record<string, string | boolean>;
    audit: {
      unique_events: number;
      fold_a_events: number;
      fold_b_events: number;
      pair_fold_records: number;
      eligible_pairs: number;
      near_bi_pairs_any_train_fold: number;
      near_bi_fold_records: number;
      pairs_near_bi_in_both_folds: number;
      minimum_observed_train_rows: number;
      minimum_observed_test_rows: number;
    };
    summary: PairAggregationSummary[];
    eligible_points: PairAggregationPoint[];
    near_bi_points: PairAggregationPoint[];
    fold_points: PairAggregationFoldPoint[];
  };
}

export interface MetricDefinition {
  id: MetricId;
  label: string;
  short_label: string;
  direction: "higher" | "lower";
  format: string;
  reference?: number;
  domain?: [number, number];
  description: string;
}

export interface EventTypeReference {
  id: string;
  label_zh: string;
  label_en: string;
  file: string;
  dimension?: "topic" | "origin_type" | "official_source";
}

export interface Manifest {
  schema_version: string;
  dataset_version: string;
  taxonomy_version: string;
  metric_version: string;
  built_at: string;
  commit_sha: string;
  fixture: boolean;
  source_snapshot: {
    official_targets: number;
    unique_events: number;
    sha256: string;
  };
  event_types: EventTypeReference[];
  metrics: MetricDefinition[];
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  family: string;
  release_order: number;
  n_targets: number;
  n_dates: number;
}

export interface MetricValue {
  value: number | null;
  se: number | null;
  ci95: [number, number] | null;
  reason?: string | null;
}

export interface PairMetrics {
  a: string;
  b: string;
  n_overlap: number;
  n_dates: number;
  metrics: Record<MetricId, MetricValue>;
  diagnostics: {
    mean_bi_gap: number | null;
    near_bi: boolean | null;
    high_loss_rate_a?: number | null;
    high_loss_rate_b?: number | null;
    joint_high_loss_rate?: number | null;
    joint_high_loss_count?: number | null;
  };
  row_id: string;
}

export interface EventTypeData {
  schema_version: string;
  event_type: EventTypeReference;
  scope: {
    origin_type: string;
    source: string;
    near_bi: boolean;
  };
  sample: {
    n_unique_events: number;
    n_event_dates: number;
    date_min: string;
    date_max: string;
  };
  models: string[];
  pairs: PairMetrics[];
  missing_cells: Array<{ a: string; b: string; reason: string }>;
  missing_summary: Array<{ reason: string; count: number }>;
}

export interface TaxonomyCategory {
  id: string;
  label_zh: string;
  label_en: string;
  level: string;
  derived: boolean;
  parent_id: string | null;
  definition: string;
  rules: string[];
  n_event_dates: number;
  n_unique_events: number;
  confidence_counts: Record<string, number>;
}

export interface Taxonomy {
  categories: TaxonomyCategory[];
  official_dimensions: {
    origin_type: string[];
    sources: string[];
  };
}

export interface Audit {
  status: "pass" | "warn" | "fail";
  generated_at: string;
  fixture: boolean;
  checks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  classification: {
    total_event_dates: number;
    deterministic: number;
    keyword: number;
    manual: number;
    unresolved: number;
  };
  thresholds: {
    min_overlap_default: number;
    near_bi_max_gap: number;
    high_loss_threshold: number;
  };
  files: Array<{ path: string; sha256: string }>;
}

export interface AppData {
  manifest: Manifest;
  models: Model[];
  taxonomy: Taxonomy;
  audit: Audit;
}

export type CrossTypeInterpretationStatus = "headline" | "limited" | "insufficient";
export type CrossTypeMetricId = MetricId;

export interface CrossTypeTopic {
  id: string;
  label_en: string;
}

export interface CrossTypeMetric {
  id: CrossTypeMetricId;
  label: string;
  dependence_direction: "higher" | "lower";
}

export interface CrossTypeSample {
  id: string;
  label: string;
  primary: boolean;
}

export interface CrossTypeManifest {
  schema_version: string;
  generated_at: string;
  topics: CrossTypeTopic[];
  metrics: CrossTypeMetric[];
  samples: CrossTypeSample[];
  thresholds: {
    reporting_min_defined_pairs: number;
    headline_min_defined_pairs: number;
    quartile: number;
  };
  summary_json: string;
  summary_csv: string;
  pair_details_gzip: string;
  audit_json: string;
}

export interface CrossTypeCell {
  topic_a: string;
  topic_b: string;
  metric_id: CrossTypeMetricId;
  sample_id: string;
  n_pair_universe: number;
  n_sample_pairs: number;
  n_defined_pairs: number;
  spearman: number | null;
  pearson: number | null;
  dependent_top_jaccard: number | null;
  complementary_top_jaccard: number | null;
  dependency_persistence_a_to_b: number | null;
  dependency_persistence_b_to_a: number | null;
  complementarity_persistence_a_to_b: number | null;
  complementarity_persistence_b_to_a: number | null;
  dependency_to_complementarity_a_to_b: number | null;
  dependency_to_complementarity_b_to_a: number | null;
  interpretation_status: CrossTypeInterpretationStatus;
  reason: string | null;
}

export interface CrossTypeSummary {
  schema_version: string;
  topic_ids: string[];
  metric_ids: CrossTypeMetricId[];
  sample_ids: string[];
  thresholds: {
    reporting_min_defined_pairs: number;
    headline_min_defined_pairs: number;
  };
  cells: CrossTypeCell[];
}

export interface CrossTypeData {
  manifest: CrossTypeManifest;
  summary: CrossTypeSummary;
}

export type GlobalBaselineScopeId = "official_full" | "seven_topic_union";
export type GlobalBaselineSampleId = "near_bi_both" | "eligible_both";
export type GlobalBaselineComparisonModeId = "leave_topic_out" | "inclusive_global";
export type GlobalBaselineInterpretationStatus = "headline" | "limited" | "insufficient";

export interface GlobalBaselineScope {
  id: GlobalBaselineScopeId;
  label: string;
  description: string;
}

export interface GlobalBaselineMetric {
  id: MetricId;
  label: string;
  dependence_direction: "higher" | "lower";
}

export interface GlobalBaselineSample {
  id: GlobalBaselineSampleId;
  label: string;
  primary: boolean;
}

export interface GlobalBaselineComparisonMode {
  id: GlobalBaselineComparisonModeId;
  label: string;
  description: string;
  primary: boolean;
}

export interface GlobalBaselineTopic {
  id: string;
  label_en: string;
}

export interface GlobalBaselineManifest {
  schema_version: string;
  generated_at: string;
  global_scopes: GlobalBaselineScope[];
  topics: GlobalBaselineTopic[];
  metrics: GlobalBaselineMetric[];
  samples: GlobalBaselineSample[];
  comparison_modes: GlobalBaselineComparisonMode[];
  thresholds: {
    min_overlap: number;
    near_bi_gap: number;
    high_loss_threshold: number;
    min_partners: number;
    reporting_min_defined: number;
    headline_min_defined: number;
    quartile: number;
  };
  summary_json: string;
  partner_profile_files: Record<string, string>;
  pair_matrix_files?: Record<GlobalBaselineScopeId, string>;
  pair_matrix_file_records?: Record<GlobalBaselineScopeId, {
    path: string;
    sha256: string;
    size_bytes: number;
    n_pairs: number;
    semantic_sha256: string;
  }>;
  pair_metrics_gzip: string;
  pair_stability_csv: string;
  partner_stability_gzip: string;
  partner_summary_csv: string;
  model_ability_csv: string;
  ability_stability_csv: string;
  audit_json: string;
}

export interface GlobalPairSummaryRow {
  global_scope: GlobalBaselineScopeId;
  metric_id: MetricId;
  sample_id: GlobalBaselineSampleId;
  n_pair_universe: number;
  n_sample_pairs: number;
  n_defined_pairs: number;
  mean: number | null;
  median: number | null;
  q25: number | null;
  q75: number | null;
  min: number | null;
  max: number | null;
  reason: string | null;
  interpretation_status: GlobalBaselineInterpretationStatus;
}

export interface GlobalPairStabilityRow {
  global_scope: GlobalBaselineScopeId;
  topic_id: string;
  metric_id: MetricId;
  sample_id: GlobalBaselineSampleId;
  comparison_mode: GlobalBaselineComparisonModeId;
  n_pair_universe: number;
  n_sample_pairs: number;
  n_defined_pairs: number;
  spearman: number | null;
  pearson: number | null;
  dependent_top_jaccard: number | null;
  complementary_top_jaccard: number | null;
  dependency_persistence_global_to_topic: number | null;
  dependency_persistence_topic_to_global: number | null;
  complementarity_persistence_global_to_topic: number | null;
  complementarity_persistence_topic_to_global: number | null;
  dependency_to_complementarity_global_to_topic: number | null;
  dependency_to_complementarity_topic_to_global: number | null;
  quartile_transition_counts: Record<string, number>;
  reason: string | null;
  interpretation_status: GlobalBaselineInterpretationStatus;
}

export interface GlobalPartnerSummaryRow {
  global_scope: GlobalBaselineScopeId;
  topic_id: string;
  metric_id: MetricId;
  sample_id: GlobalBaselineSampleId;
  comparison_mode: GlobalBaselineComparisonModeId;
  n_focal_model_universe: number;
  n_reportable_focal_models: number;
  n_limited_focal_models: number;
  n_headline_focal_models: number;
  median_spearman: number | null;
  q25_spearman: number | null;
  q75_spearman: number | null;
  min_spearman: number | null;
  max_spearman: number | null;
  fraction_negative_spearman: number | null;
  median_defined_partners: number | null;
  mean_dependent_top_jaccard: number | null;
  mean_complementary_top_jaccard: number | null;
  reason: string | null;
  interpretation_status: GlobalBaselineInterpretationStatus;
}

export interface GlobalAbilityStabilityRow {
  global_scope: GlobalBaselineScopeId;
  topic_id: string;
  comparison_mode: GlobalBaselineComparisonModeId;
  n_model_universe: number;
  n_sample_models: number;
  n_defined_models: number;
  spearman: number | null;
  pearson: number | null;
  top_quartile_jaccard: number | null;
  global_top_quartile_retained: number | null;
  topic_top_quartile_retained: number | null;
  reason: string | null;
  interpretation_status: GlobalBaselineInterpretationStatus;
}

export interface GlobalPartnerProfileRow {
  global_scope: GlobalBaselineScopeId;
  topic_id: string;
  metric_id: MetricId;
  sample_id: GlobalBaselineSampleId;
  comparison_mode: GlobalBaselineComparisonModeId;
  focal_model_id: string;
  focal_model_name: string;
  n_defined_partners: number;
  spearman: number | null;
  pearson: number | null;
  global_top_complementary_partner_name: string | null;
  global_top_complementary_partner_retained: boolean | 0 | 1 | null;
  global_top_complementary_partner_topic_percentile: number | null;
  reason: string | null;
  interpretation_status: GlobalBaselineInterpretationStatus;
}

export interface GlobalPartnerProfiles {
  schema_version: string;
  focal_model_id: string;
  profiles: GlobalPartnerProfileRow[];
}

export interface GlobalBaselineSummary {
  schema_version: string;
  global_scopes: GlobalBaselineScope[];
  topic_ids: string[];
  metric_ids: MetricId[];
  sample_ids: GlobalBaselineSampleId[];
  comparison_modes: GlobalBaselineComparisonMode[];
  thresholds: GlobalBaselineManifest["thresholds"];
  global_pair_summary: GlobalPairSummaryRow[];
  pair_stability: GlobalPairStabilityRow[];
  partner_summary: GlobalPartnerSummaryRow[];
  ability_stability: GlobalAbilityStabilityRow[];
}

export interface GlobalBaselineData {
  manifest: GlobalBaselineManifest;
  summary: GlobalBaselineSummary;
}

export interface GlobalPairMatrixModel {
  id: string;
  name: string;
  organization: string;
}

export interface GlobalPairMatrixRow {
  model_a_id: string;
  model_b_id: string;
  n_overlap: number;
  n_dates: number;
  eligible: boolean;
  near_bi: boolean | null;
  bi_reason: string | null;
  insufficient_overlap_reason: string | null;
  adjusted_pog: number | null;
  pog_reason: string | null;
  high_loss_lift: number | null;
  lift_reason: string | null;
  adjusted_loss_corr: number | null;
  corr_reason: string | null;
}

export interface GlobalPairMatrixCompact {
  schema_version: string;
  global_scope: GlobalBaselineScopeId;
  models: GlobalPairMatrixModel[];
  fields: Array<keyof GlobalPairMatrixRow>;
  pairs: Array<Array<string | number | boolean | null>>;
}
