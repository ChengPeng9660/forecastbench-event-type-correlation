import type { AbilityGap, PairScope, Score } from "../types/complementarity";

export const ROUTING_PATH = `${import.meta.env.BASE_URL}data/type-selection/`;
export const ROUTING_METHODS = ["type_selection", "simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "model_a", "model_b", "train_selected_single"] as const;
export type RoutingMetric = "brier" | "bi" | "ece";
export type TestScope = "complementary" | "all";
export type Scores = Record<RoutingMetric, Score[]>;
export interface RoutingScope {
  events: number; targets: number; event_fraction: number;
  fallback_fraction: Score; a_fraction: Score; best_single: number | null; scores: Scores;
}
export interface TrainingRoute {
  type: string; train_events: number; train_brier_a: number; train_brier_b: number;
  train_gap_bi: number; selected: number; fallback: boolean; complementary: boolean;
}
export interface RoutingPair {
  id: string; train_gap: number; train_coverage: number; fallback: number;
  routes: TrainingRoute[]; scopes: Record<TestScope, RoutingScope>;
}
export interface RoutingAggregate {
  pairs: number; defined_pairs: number; mean_events: Score; mean_targets: Score;
  mean_event_fraction: Score; mean_fallback_fraction: Score;
  scores: Scores; routing_win_rates: Scores;
  routing_gain_vs_best_single: Record<RoutingMetric, Score>;
}
export interface RoutingSummary {
  split: number; fold: number; pair_scope: PairScope; ability_gap: AbilityGap; coverage: number;
  scopes: Record<TestScope, RoutingAggregate>;
}
export interface RoutingData {
  schema_version: 1; date: string; primary_split: number; primary_fold: number;
  methods: string[]; method_labels: string[]; pair_shards: Record<string, string>; summaries: RoutingSummary[];
  weighting: string; min_training_events: number; complementary_margin_bi: number;
  audit: { status: string; evaluated_pair_directions: number; max_frozen_score_error: number;
    independent: { status: string; sampled_primary_pairs: number; max_absolute_error: number } };
}
export interface RoutingArchive extends RoutingData { pairs: RoutingPair[] }
export const metricName = (metric: RoutingMetric) => metric === "brier" ? "Brier score ↓" : metric === "bi" ? "BI ↑" : "ECE ↓";
export const metricDigits = (metric: RoutingMetric) => metric === "bi" ? 3 : 5;
export function routingGain(values: Score[], comparator: number, metric: RoutingMetric): Score {
  const route = values[0], other = values[comparator];
  return route == null || other == null ? null : (route - other) * (metric === "bi" ? 1 : -1);
}
export function routingSummary(data: RoutingData, gap: AbilityGap, coverage: number, scope: PairScope) {
  return data.summaries.find(r => r.split === data.primary_split && r.fold === data.primary_fold
    && r.ability_gap === gap && r.coverage === coverage && r.pair_scope === scope);
}
export async function loadRouting(signal?: AbortSignal): Promise<RoutingData> {
  const response = await fetch(`${ROUTING_PATH}overview.json`, { signal });
  if (!response.ok) throw new Error(`Type-selection results could not be loaded (${response.status}).`);
  const data = await response.json() as RoutingData;
  if (data.schema_version !== 1 || data.weighting !== "equal_events_within_event_equal_targets"
    || data.methods?.join("|") !== ROUTING_METHODS.join("|") || !data.pair_shards
    || !Array.isArray(data.summaries) || data.audit?.status !== "PASS" || data.audit.independent?.status !== "PASS") {
    throw new Error("Type-selection results failed the published data contract.");
  }
  return data;
}

const pairCache = new Map<string, Record<string, RoutingPair>>();
export async function loadRoutingPair(data: RoutingData, id: string, signal?: AbortSignal): Promise<RoutingPair | null> {
  const shard = data.pair_shards[id];
  if (!shard) return null;
  let pairs = pairCache.get(shard);
  if (!pairs) {
    const response = await fetch(`${ROUTING_PATH}pairs/${shard}.json`, { signal });
    if (!response.ok) throw new Error(`The selected routing map could not be loaded (${response.status}).`);
    pairs = await response.json() as Record<string, RoutingPair>;
    pairCache.set(shard, pairs);
  }
  const pair = pairs[id];
  if (!pair || pair.id !== id || !pair.scopes?.all || !pair.scopes?.complementary || !Array.isArray(pair.routes)) {
    throw new Error("The selected routing map is missing from its published shard.");
  }
  return pair;
}
