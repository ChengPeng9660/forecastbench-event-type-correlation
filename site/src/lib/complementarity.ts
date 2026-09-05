import type {
  AbilityGap,
  AggregationSummary,
  CategoryProfile,
  CohortKind,
  ComplementarityData,
  Dimension,
  DirectionSummary,
  PairScope,
  Score,
  StabilityRule,
  StudyPair,
} from "../types/complementarity";

export const COMPLEMENTARITY_PATH = `${import.meta.env.BASE_URL}data/complementarity/`;
export const COVERAGES = [.5, .6, .7, .8] as const;
export const ABILITY_GAPS = [3, 5] as const;
export const COMPLEMENTARITY_METHODS = [
  "simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional",
] as const;
export const EVENT_TYPE_DOMAINS = [
  "health", "politics", "sports", "finance", "technology",
  "climate_weather", "entertainment_culture",
] as const;

export const isScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function score(value: Score | undefined, digits = 3, signed = false): string {
  if (!isScore(value)) return "—";
  const normalized = Math.abs(value) < .5 * 10 ** -digits ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${normalized.toFixed(digits)}`;
}

export function shortModel(name: string): string {
  return name.replace(/ \(zero shot\)$/, "");
}

export function eligiblePairs(
  data: ComplementarityData,
  dimension: Dimension,
  coverage: number,
  cohort: CohortKind,
  abilityGap: AbilityGap,
  pairScope: PairScope = "all",
): StudyPair[] {
  return data.pairs.filter(pair => pair.dimension === dimension
    && pair.train_gap <= abilityGap + 1e-12
    && (pair.train_groups ?? 0) >= 2
    && (pair.train_coverage ?? 0) >= coverage
    && (cohort !== "crossing" || pair.crossing === true)
    && (pairScope === "all"
      || (pairScope === "different_model_version" && !pair.same_model_version)
      || (pairScope === "matched_conditions" && pair.same_prompt && pair.same_information)));
}

export function pairGain(pair: StudyPair, method: string): Score {
  const prediction = pair.methods[method];
  const base = isScore(pair.test_bi_a) && isScore(pair.test_bi_b)
    ? Math.max(pair.test_bi_a, pair.test_bi_b)
    : null;
  return isScore(prediction) && isScore(base) ? prediction - base : null;
}

export function stablePairs(
  data: ComplementarityData,
  dimension: Dimension,
  abilityGap: AbilityGap,
  pairScope: PairScope,
  rule: StabilityRule,
): StudyPair[] {
  return eligiblePairs(data, dimension, .5, "eligible", abilityGap, pairScope)
    .filter(pair => rule === "strict" ? pair.stability.strict_eligible : pair.stability.primary_eligible);
}

export function defaultPair(pairs: StudyPair[], requested?: string, featured?: string): StudyPair | undefined {
  return pairs.find(pair => pair.id === requested)
    ?? pairs.find(pair => pair.id === featured)
    ?? pairs[0];
}

export function studySummary(
  data: ComplementarityData,
  dimension: Dimension,
  coverage: number,
  cohort: CohortKind,
  abilityGap: AbilityGap,
  method: string,
  pairScope: PairScope = "all",
): AggregationSummary | undefined {
  return data.summaries.find(row => row.dimension === dimension
    && row.coverage === coverage
    && row.cohort === cohort
    && row.ability_gap === abilityGap
    && row.pair_scope === pairScope
    && row.method === method);
}

export function directionSummaries(
  data: ComplementarityData,
  dimension: Dimension,
  coverage: number,
  cohort: CohortKind,
  abilityGap: AbilityGap,
  method: string,
  pairScope: PairScope = "all",
): DirectionSummary[] {
  return data.directions.filter(row => row.dimension === dimension
    && row.coverage === coverage
    && row.cohort === cohort
    && row.ability_gap === abilityGap
    && row.pair_scope === pairScope
    && row.method === method);
}

export function csvForPairs(pairs: StudyPair[], method: string): string {
  const rows: unknown[][] = [[
    "dimension", "pair_id", "model_a", "model_b", "train_bi_gap",
    "event_weighted_category_coverage", "train_category_complementarity", "train_crossing",
    "train_dataset_event_weight_fraction", "test_model_a_bi", "test_model_b_bi", "method",
    "test_method_bi", "gain_vs_better_test_single_bi", "train_events", "test_events",
    "same_model_version", "same_prompt", "same_information",
  ], ...pairs.map(pair => [
    pair.dimension, pair.id, pair.model_a, pair.model_b, pair.train_gap,
    pair.train_coverage, pair.train_between_norm, pair.crossing,
    pair.train_origin_dataset_fraction, pair.test_bi_a, pair.test_bi_b, method,
    pair.methods[method], pairGain(pair, method), pair.train_events, pair.test_events,
    pair.same_model_version, pair.same_prompt, pair.same_information,
  ])];
  return rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

export async function loadComplementarity(signal?: AbortSignal): Promise<ComplementarityData> {
  const response = await fetch(`${COMPLEMENTARITY_PATH}study.json`, { signal });
  if (!response.ok) throw new Error(`Results could not be loaded (${response.status}).`);
  const data = await response.json() as ComplementarityData;
  if (data.schema_version !== 8
    || data.weighting !== "equal_events_within_event_equal_targets"
    || data.event_type_taxonomy !== "forecastbench-seven-domain-v1.0.0"
    || !Array.isArray(data.event_type_domains)
    || data.event_type_domains.map(domain => domain.id).join("|") !== EVENT_TYPE_DOMAINS.join("|")
    || !Array.isArray(data.pairs)
    || !Array.isArray(data.summaries)
    || !Array.isArray(data.directions)
    || !Array.isArray(data.methods)
    || !Array.isArray(data.configurations)
    || !Array.isArray(data.pair_scopes)
    || data.primary_method !== "cf_directional"
    || data.methods.length !== COMPLEMENTARITY_METHODS.length
    || data.methods.some((method, index) => method.id !== COMPLEMENTARITY_METHODS[index])
    || data.calibration?.metric !== "expected_calibration_error"
    || data.calibration?.implementation !== "prophet-arena-engine-2.2.0-compatible"
    || data.calibration?.probability_bins !== 10
    || data.calibration?.binning !== "uniform_equal_width_over_[0,1]"
    || data.calibration?.aggregation !== "pooled_common_probability_outcome_pairs"
    || data.calibration?.row_weighting !== "uniform"
    || data.calibration?.uses_question_fixed_effect !== false
    || data.calibration?.uses_brier_index_normalization !== false
    || data.calibration?.lower_is_better !== true
    || data.stability?.metric !== "event_clustered_category_bi_edge"
    || data.stability?.confidence_level !== .9
    || data.stability?.interval !== "two_sided_delta_method"
    || data.stability?.cluster_unit !== "event"
    || data.stability?.score_weighting !== "equal_events_within_event_equal_targets"
    || data.stability?.brier_index !== "100 * (1 - sqrt(event_averaged_ordinary_brier_score))"
    || data.stability?.selection_split !== "training_only"
    || data.stability?.uses_test_outcomes !== false
    || data.stability?.changes_aggregation !== false
    || data.audit?.stability?.status !== "PASS"
    || data.audit?.calibration?.status !== "PASS"
    || data.audit?.status !== "PASS") {
    throw new Error("The published results do not match the expected audited study.");
  }
  return data;
}

const profileShardCache = new Map<string, Record<string, CategoryProfile[]>>();

export async function loadPairProfiles(pair: StudyPair, signal?: AbortSignal): Promise<CategoryProfile[]> {
  let profiles = profileShardCache.get(pair.profile_shard);
  if (!profiles) {
    const response = await fetch(`${COMPLEMENTARITY_PATH}profiles/${pair.profile_shard}.json`, { signal });
    if (!response.ok) throw new Error(`Category profiles could not be loaded (${response.status}).`);
    const payload = await response.json() as { schema_version?: number; profiles?: Record<string, CategoryProfile[]> };
    if (payload.schema_version !== 1 || !payload.profiles || typeof payload.profiles !== "object") {
      throw new Error("The category-profile shard is incompatible with this study.");
    }
    profiles = payload.profiles;
    profileShardCache.set(pair.profile_shard, profiles);
  }
  const selected = profiles[pair.profile_key];
  if (!Array.isArray(selected)) throw new Error("The selected pair is missing from its category-profile shard.");
  return selected;
}
