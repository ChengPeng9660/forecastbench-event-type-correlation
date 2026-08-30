import type { FreezeAggregationMethodId, FreezeFoldView, MarketDiversityPerformancePoint, MarketPerformanceDiversityMetricId } from "./data";
import type { HighLossDiagnostics } from "../lib/highLoss";

export type ConfigurationIdentity = Pick<MarketDiversityPerformancePoint, "exact_configuration" | "canonical_model_version" | "model_configuration" | "provider" | "prompt_type" | "prompt_label" | "information_type" | "information_label">;
export type ConfigurationPairSample = "all" | "near_bi";
export type ConfigurationPairOutcome = "brier_index" | "raw_brier" | "gain_vs_base" | "gain_vs_market";
export interface ConfigurationPairIndexEntry extends ConfigurationIdentity { file: string; eligible_partner_count: number }
export interface ConfigurationPairManifest {
  schema_version: number;
  generated_at: string;
  methods: Record<FreezeAggregationMethodId, { label: string; [key: string]: unknown }>;
  method_order: FreezeAggregationMethodId[];
  metrics: Record<MarketPerformanceDiversityMetricId, { label: string; axis: string; [key: string]: unknown }>;
  metric_order: MarketPerformanceDiversityMetricId[];
  split: { repetitions: number; seeds: number[]; minimum_fold_overlap: number; near_bi_gap: number; [key: string]: unknown };
  configurations: ConfigurationPairIndexEntry[];
  audit: Record<string, unknown>;
}
export interface ConfigurationPairScores { raw_brier: number | null; adjusted_brier: number | null; brier_index: number | null }
export interface ConfigurationPairMethodScores extends ConfigurationPairScores { gain_vs_base: number | null; gain_vs_partner: number | null; gain_vs_market: number | null; beats_market: boolean }
export interface ConfigurationPairView {
  high_loss_diagnostics?: HighLossDiagnostics;
  fold_count: number;
  fold_ids: string[];
  train_target_cells: number;
  test_target_cells: number;
  min_train_rows: number;
  min_test_rows: number;
  small_support: boolean;
  train_diversity: Record<MarketPerformanceDiversityMetricId, number | null>;
  train_bi_gap: number | null;
  base: ConfigurationPairScores;
  partner: ConfigurationPairScores;
  market: ConfigurationPairScores;
  methods: Record<FreezeAggregationMethodId, ConfigurationPairMethodScores>;
}
export interface ConfigurationPairPartner {
  partner: ConfigurationIdentity;
  n_common: number;
  status: string;
  reason?: string;
  views: Record<ConfigurationPairSample, Record<FreezeFoldView, ConfigurationPairView | null>>;
}
export interface ConfigurationPairShard { schema_version: number; base_configuration: string; base: ConfigurationIdentity; partners: ConfigurationPairPartner[] }
