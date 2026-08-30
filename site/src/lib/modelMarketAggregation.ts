import { CONFIGURATION_PAIR_METHODS, CONFIGURATION_PAIR_METRICS } from "./configurationPairAggregation";
import type { ConfigurationPairMethodScores, ConfigurationPairScores } from "../types/configurationPairAggregation";
import type { ModelMarketAggregationData } from "../types/modelMarketAggregation";

const IDENTITY_FIELDS = ["exact_configuration", "canonical_model_version", "model_configuration", "provider", "prompt_type", "prompt_label", "information_type", "information_label"] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const scores = (value: unknown) => record(value) && ["raw_brier", "adjusted_brier", "brier_index"].every((field) => numeric(value[field]));

/** Shapes always compare pooled BI on identical model-market test support. */
export function beatsMatchedMarket(score: ConfigurationPairMethodScores, market: ConfigurationPairScores): boolean {
  return score.brier_index !== null && market.brier_index !== null
    && Number.isFinite(score.brier_index) && Number.isFinite(market.brier_index)
    && score.brier_index > market.brier_index + 1e-12;
}

function validView(value: unknown, maximumDirections: number): boolean {
  if (value === null) return true;
  if (!record(value) || !count(value.fold_count) || value.fold_count === 0 || (value.fold_count as number) > maximumDirections
    || !Array.isArray(value.fold_ids) || value.fold_ids.length !== value.fold_count || !value.fold_ids.every((id) => typeof id === "string")
    || new Set(value.fold_ids).size !== value.fold_ids.length
    || !["train_target_cells", "test_target_cells", "min_train_rows", "min_test_rows"].every((key) => count(value[key]))
    || typeof value.small_support !== "boolean" || !numeric(value.train_bi_gap) || !record(value.train_diversity)
    || !scores(value.base) || !scores(value.partner) || !scores(value.market) || !record(value.methods)) return false;
  const diversity = value.train_diversity;
  if (!CONFIGURATION_PAIR_METRICS.every((id) => numeric(diversity[id]))) return false;
  if (typeof diversity.total_variation === "number" && (diversity.total_variation < 0 || diversity.total_variation > 1)) return false;
  const base = value.base as Record<string, unknown>;
  const market = value.market as Record<string, unknown>;
  if (["raw_brier", "adjusted_brier", "brier_index"].some((key) => base[key] !== market[key])) return false;
  const methods = value.methods;
  return CONFIGURATION_PAIR_METHODS.every((id) => {
    const score = methods[id];
    return record(score) && scores(score) && typeof score.beats_market === "boolean"
      && ["gain_vs_base", "gain_vs_partner", "gain_vs_market"].every((field) => numeric(score[field]))
      && score.beats_market === beatsMatchedMarket(score as unknown as ConfigurationPairMethodScores, market as unknown as ConfigurationPairScores);
  });
}

export async function loadModelMarketAggregation(signal?: AbortSignal): Promise<ModelMarketAggregationData> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/model-market-aggregation/summary.json`, { signal });
  if (!response.ok) throw new Error(`Unable to load model + market aggregation (${response.status}).`);
  const payload: unknown = await response.json();
  if (!record(payload) || payload.schema_version !== 1 || payload.market_base !== "Polymarket Freeze"
    || typeof payload.generated_at !== "string" || (!record(payload.scope) && typeof payload.scope !== "string")
    || !record(payload.methods) || !record(payload.metrics) || !record(payload.split) || !record(payload.aggregation)
    || !record(payload.audit) || !record(payload.provenance) || !Array.isArray(payload.points)
    || !Array.isArray(payload.method_order) || !Array.isArray(payload.metric_order)) throw new Error("Invalid model + market aggregation data or unsupported schema.");
  const methods = payload.methods;
  const metrics = payload.metrics;
  if (!CONFIGURATION_PAIR_METHODS.every((id) => record(methods[id]) && typeof methods[id].label === "string")
    || !CONFIGURATION_PAIR_METRICS.every((id) => record(metrics[id]) && typeof metrics[id].label === "string" && typeof metrics[id].axis === "string")
    || payload.method_order.length !== 6 || !CONFIGURATION_PAIR_METHODS.every((id) => (payload.method_order as unknown[]).includes(id))
    || payload.metric_order.length !== 5 || !CONFIGURATION_PAIR_METRICS.every((id) => (payload.metric_order as unknown[]).includes(id))
    || !count(payload.split.repetitions) || (payload.split.repetitions as number) < 1
    || typeof payload.split.near_bi_gap !== "number" || !Number.isFinite(payload.split.near_bi_gap)) throw new Error("Incomplete model + market metric, method, or split contract.");
  const repetitions = payload.split.repetitions as number;
  const seen = new Set<string>();
  for (const row of payload.points) {
    if (!record(row) || !record(row.configuration) || !IDENTITY_FIELDS.every((key) => typeof (row.configuration as Record<string, unknown>)[key] === "string")
      || !count(row.n_common) || !count(row.unique_event_count) || typeof row.status !== "string" || !record(row.views)) throw new Error("Invalid exact configuration in model + market data.");
    const exact = row.configuration.exact_configuration as string;
    if (seen.has(exact)) throw new Error("Duplicate exact configuration in model + market data.");
    seen.add(exact);
    const views = row.views;
    if (!["all", "near_bi"].every((sample) => record(views[sample]) && ["combined", "a_to_b", "b_to_a"].every((fold) => validView((views[sample] as Record<string, unknown>)[fold], repetitions * (fold === "combined" ? 2 : 1))))) throw new Error("Invalid model + market fold data or matched-market comparison.");
  }
  return payload as unknown as ModelMarketAggregationData;
}
