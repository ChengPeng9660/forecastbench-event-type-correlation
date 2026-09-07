import type { AbilityGap, PairScope } from "../types/complementarity";
import type { TestScope } from "./typeSelection";

export const MECHANISM_PATH = `${import.meta.env.BASE_URL}data/type-selection-mechanisms/`;
export const MECHANISM_METHODS = ["type_selection", "simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "calibrated_selection", "flexible_selection", "joint_model", "convex_pool", "extremized_convex"];
export interface ConfidenceGroup {
  mass: number[] | null; outcome: number[] | null;
  loss: number[][] | null; probability: number[][] | null;
}
export interface MechanismAggregate {
  pairs: number; events: number | null; targets: number | null;
  brier: number[] | null; ece: number[] | null; wins: number[] | null;
  alpha: number | null; gamma: number | null; extremized_pairs: number | null;
  groups: ConfidenceGroup[]; fallback_mass: number | null; fallback_loss: number[] | null;
  retained_mass: number | null; routed_mass: number | null;
  matching: { pairs: number; cells: number; mean_events: number | null; mean_overlap: number | null; differences: number[] | null };
}
export interface MechanismDirection { split: number; fold: number; scopes: Record<TestScope, MechanismAggregate> }
export interface MechanismView {
  key: string; gap: AbilityGap; coverage: number; pair_scope: PairScope;
  primary: MechanismDirection; directions: MechanismDirection[];
}
export interface MechanismIndex {
  schema_version: 1; date: string; methods: string[]; method_labels: string[];
  cutoffs: number[]; groups: string[]; contrasts: number[][]; contrast_names: string[];
  exploratory: boolean; primary_split: number; primary_fold: number; views: string[];
  audit: { status: string; pair_directions: number; primary_pairs: number;
    fitted_logistic_models: number; independent_pairs: number; max_independent_error: number;
    max_additivity_error: number; max_gradient: number; max_parent_score_error: number };
}
export const mechanismKey = (gap: AbilityGap, coverage: number, scope: PairScope) => `gap${gap}-coverage${Math.round(coverage * 100)}-${scope}`;
export function brierGain(values: number[] | null, before: number, after: number) {
  return values ? values[before] - values[after] : null;
}
export function positiveDirections(view: MechanismView, scope: TestScope, before: number, after: number) {
  const defined = view.directions.filter(d => d.scopes[scope].pairs > 0 && d.scopes[scope].brier);
  return { positive: defined.filter(d => brierGain(d.scopes[scope].brier, before, after)! > 1e-10).length, total: defined.length };
}
export function groupRows(group: ConfidenceGroup, before: number, after: number) {
  return ["Both high", "Both low", "Opposite sides", "Other forecasts"].map((name, i) => {
    const mass = group.mass?.[i] ?? 0;
    const gain = group.loss ? group.loss[i][before] - group.loss[i][after] : null;
    return { name, mass, gain, conditionalGain: mass && gain != null ? gain / mass : null,
      before: mass && group.probability ? group.probability[i][before] / mass : null,
      after: mass && group.probability ? group.probability[i][after] / mass : null,
      outcome: mass && group.outcome ? group.outcome[i] / mass : null };
  });
}
export async function loadMechanisms(key: string, signal?: AbortSignal): Promise<{ index: MechanismIndex; view: MechanismView }> {
  const responses = await Promise.all([fetch(`${MECHANISM_PATH}index.json`, { signal }), fetch(`${MECHANISM_PATH}views/${key}.json`, { signal })]);
  for (const response of responses) if (!response.ok) throw new Error(`Mechanism results could not be loaded (${response.status}).`);
  const [index, view] = await Promise.all(responses.map(r => r.json())) as [MechanismIndex, MechanismView];
  if (index.schema_version !== 1 || index.methods?.join("|") !== MECHANISM_METHODS.join("|") || index.audit?.status !== "PASS"
    || !index.exploratory || !index.views?.includes(key) || view.key !== key || view.directions?.length !== 10
    || !view.primary?.scopes?.all || !view.primary?.scopes?.complementary) throw new Error("Mechanism results failed the published data contract.");
  return { index, view };
}
