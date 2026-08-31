import type { CohortKind, ComplementarityData, Dimension, Score, StudyPair } from "../types/complementarity";

export const COMPLEMENTARITY_PATH = `${import.meta.env.BASE_URL}data/complementarity/`;
export const COVERAGES = [.5, .6, .7, .8] as const;
export const isScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function score(value: Score | undefined, digits = 3, signed = false): string {
  if (!isScore(value)) return "—";
  const normalized = Math.abs(value) < .5 * 10 ** -digits ? 0 : value;
  return `${signed && normalized > 0 ? "+" : ""}${normalized.toFixed(digits)}`;
}
export function shortModel(name: string): string { return name.replace(/ \(zero shot\)$/, ""); }
export function eligiblePairs(data: ComplementarityData, dimension: Dimension, coverage: number, cohort: CohortKind): StudyPair[] {
  return data.pairs.filter(p => p.dimension === dimension && (p.train_groups ?? 0) >= 2 &&
    (p.train_coverage ?? 0) >= coverage && (cohort !== "crossing" || p.crossing === true));
}
export function pairGain(pair: StudyPair, method: string, baseline: "global" | "single" = "global"): Score {
  const prediction = pair.methods[method];
  const base = baseline === "global" ? pair.methods.global_convex
    : isScore(pair.test_bi_a) && isScore(pair.test_bi_b) ? Math.max(pair.test_bi_a, pair.test_bi_b) : null;
  return isScore(prediction) && isScore(base) ? prediction - base : null;
}
export function defaultPair(pairs: StudyPair[], requested?: string): StudyPair | undefined {
  return pairs.find(p => p.id === requested) ?? pairs.find(p => p.id === "44_58") ?? pairs[0];
}
export function studyCohort(data: ComplementarityData, dimension: Dimension, coverage: number, cohort: CohortKind, split = "20260910", fold = 0) {
  return data.cohorts.find(c => c.dimension === dimension && c.threshold === coverage && c.cohort === cohort && c.split === split && c.fold === fold);
}
export function csvForPairs(pairs: StudyPair[], method: string): string {
  const rows: unknown[][] = [["dimension", "pair_id", "model_a", "model_b", "train_bi_gap", "train_category_weight_coverage", "train_cross_category_complementarity", "train_crossing", "test_model_a_bi", "test_model_b_bi", "method", "test_method_bi", "test_global_bi", "gain_vs_global_bi", "gain_vs_better_test_single_bi", "train_events", "test_events"],
    ...pairs.map(p => [p.dimension, p.id, p.model_a, p.model_b, p.train_gap, p.train_coverage, p.train_between_norm, p.crossing, p.test_bi_a, p.test_bi_b, method, p.methods[method], p.methods.global_convex, pairGain(p, method), pairGain(p, method, "single"), p.train_events, p.test_events])];
  return rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}
export async function loadComplementarity(signal?: AbortSignal): Promise<ComplementarityData> {
  const response = await fetch(`${COMPLEMENTARITY_PATH}study.json`, { signal });
  if (!response.ok) throw new Error(`Results could not be loaded (${response.status}).`);
  const data = await response.json() as ComplementarityData;
  if (data.schema_version !== 1 || !Array.isArray(data.pairs) || !Array.isArray(data.cohorts) || !Array.isArray(data.methods) || data.audit?.status !== "PASS") {
    throw new Error("The published results do not match the expected audited study.");
  }
  return data;
}
