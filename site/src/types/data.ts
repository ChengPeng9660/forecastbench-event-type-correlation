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
