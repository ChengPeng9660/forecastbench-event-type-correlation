import type {
  AbilityGap,
  AggregationSummary,
  CohortKind,
  ComplementarityData,
  Dimension,
  DirectionSummary,
  Score,
  StudyPair,
} from "../types/complementarity";

export const COMPLEMENTARITY_PATH = `${import.meta.env.BASE_URL}data/complementarity/`;
export const COVERAGES = [.5, .6, .7, .8] as const;
export const ABILITY_GAPS = [3, 5] as const;

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
): StudyPair[] {
  return data.pairs.filter(pair => pair.dimension === dimension
    && pair.train_gap <= abilityGap + 1e-12
    && (pair.train_groups ?? 0) >= 2
    && (pair.train_coverage ?? 0) >= coverage
    && (cohort !== "crossing" || pair.crossing === true));
}

export function pairGain(pair: StudyPair, method: string, baseline: "global" | "single" = "single"): Score {
  const prediction = pair.methods[method];
  const base = baseline === "global"
    ? pair.methods.global_convex
    : isScore(pair.test_bi_a) && isScore(pair.test_bi_b)
      ? Math.max(pair.test_bi_a, pair.test_bi_b)
      : null;
  return isScore(prediction) && isScore(base) ? prediction - base : null;
}

export function defaultPair(pairs: StudyPair[], requested?: string): StudyPair | undefined {
  return pairs.find(pair => pair.id === requested)
    ?? pairs.find(pair => pair.id === "44_58")
    ?? pairs[0];
}

export function studySummary(
  data: ComplementarityData,
  dimension: Dimension,
  coverage: number,
  cohort: CohortKind,
  abilityGap: AbilityGap,
  method: string,
): AggregationSummary | undefined {
  return data.summaries.find(row => row.dimension === dimension
    && row.coverage === coverage
    && row.cohort === cohort
    && row.ability_gap === abilityGap
    && row.method === method);
}

export function directionSummaries(
  data: ComplementarityData,
  dimension: Dimension,
  coverage: number,
  cohort: CohortKind,
  abilityGap: AbilityGap,
  method: string,
): DirectionSummary[] {
  return data.directions.filter(row => row.dimension === dimension
    && row.coverage === coverage
    && row.cohort === cohort
    && row.ability_gap === abilityGap
    && row.method === method);
}

export function csvForPairs(pairs: StudyPair[], method: string): string {
  const rows: unknown[][] = [[
    "dimension", "pair_id", "model_a", "model_b", "train_bi_gap",
    "uniform_row_category_coverage", "train_category_complementarity", "train_crossing",
    "train_dataset_row_fraction", "test_model_a_bi", "test_model_b_bi", "method",
    "test_method_bi", "test_global_bi", "gain_vs_better_test_single_bi",
    "increment_vs_global_bi", "train_events", "test_events",
  ], ...pairs.map(pair => [
    pair.dimension, pair.id, pair.model_a, pair.model_b, pair.train_gap,
    pair.train_coverage, pair.train_between_norm, pair.crossing,
    pair.train_origin_dataset_fraction, pair.test_bi_a, pair.test_bi_b, method,
    pair.methods[method], pair.methods.global_convex, pairGain(pair, method, "single"),
    pairGain(pair, method, "global"), pair.train_events, pair.test_events,
  ])];
  return rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

export async function loadComplementarity(signal?: AbortSignal): Promise<ComplementarityData> {
  const response = await fetch(`${COMPLEMENTARITY_PATH}study.json`, { signal });
  if (!response.ok) throw new Error(`Results could not be loaded (${response.status}).`);
  const data = await response.json() as ComplementarityData;
  if (data.schema_version !== 2
    || data.weighting !== "uniform_rows"
    || !Array.isArray(data.pairs)
    || !Array.isArray(data.summaries)
    || !Array.isArray(data.directions)
    || !Array.isArray(data.methods)
    || data.audit?.status !== "PASS") {
    throw new Error("The published results do not match the expected audited study.");
  }
  return data;
}
