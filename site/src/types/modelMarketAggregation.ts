import type { ConfigurationIdentity, ConfigurationPairManifest, ConfigurationPairSample, ConfigurationPairView } from "./configurationPairAggregation";
import type { FreezeFoldView, MarketInformationType, MarketPromptType } from "./data";

export interface ModelMarketAggregationFilters {
  provider: string;
  prompt: "all" | MarketPromptType;
  information: "all" | MarketInformationType;
}

export interface ModelMarketAggregationPoint {
  configuration: ConfigurationIdentity;
  n_common: number;
  unique_event_count: number;
  status: string;
  reason?: string;
  date_min?: string;
  date_max?: string;
  views: Record<ConfigurationPairSample, Record<FreezeFoldView, ConfigurationPairView | null>>;
}

export interface ModelMarketAggregationData {
  schema_version: 1;
  generated_at: string;
  scope: string | Record<string, unknown>;
  market_base: "Polymarket Freeze";
  methods: ConfigurationPairManifest["methods"];
  method_order: ConfigurationPairManifest["method_order"];
  metrics: ConfigurationPairManifest["metrics"];
  metric_order: ConfigurationPairManifest["metric_order"];
  split: ConfigurationPairManifest["split"];
  aggregation: Record<string, unknown>;
  points: ModelMarketAggregationPoint[];
  audit: Record<string, unknown>;
  provenance: Record<string, unknown>;
}
