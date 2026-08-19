export type MetricId = "adjusted_pog" | "high_loss_lift" | "adjusted_loss_corr";

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
