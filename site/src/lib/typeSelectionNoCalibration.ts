import type { AbilityGap, PairScope } from "../types/complementarity";
import type { TestScope } from "./typeSelection";

export const RAW_POOL_PATH = `${import.meta.env.BASE_URL}data/type-selection-no-calibration/`;
export const RAW_METHODS = ["type_selection","other_only","simple_mean","log_odds_mean","ec_w0_56","piecewise_odds","normalized_product","uncalibrated_joint","bounded_log_pool","brier_convex_pool"];
export type RawReference = "selection" | "duplicate";
export interface RawAggregate {
  pairs: number; events: number | null; targets: number | null;
  brier: number[] | null; ece: number[] | null; duplicate_brier: number[] | null;
  wins: number[] | null; duplicate_wins: number[] | null; beat_both: number[] | null;
  weights: number[] | null; weight_bins: number[] | null; log_weight_min: number | null; log_weight_max: number | null;
  group: { mass: number[] | null; loss: number[][] | null; duplicate_loss: number[][] | null };
  fallback_mass: number | null; fallback_loss: number[] | null; fallback_duplicate_loss: number[] | null;
}
export interface RawDirection { split: number; fold: number; scopes: Record<TestScope,RawAggregate> }
export interface RawView {
  key: string; gap: AbilityGap; coverage: number; pair_scope: PairScope;
  primary: RawDirection; directions: RawDirection[];
}
export interface RawIndex {
  schema_version: 1; date: string; exploratory: boolean; methods: string[]; method_labels: string[];
  fixed_methods: number[]; learned_methods: number[]; views: string[];
  audit: { status: string; pair_directions: number; primary_pairs: number; independent_pairs: number;
    max_parent_score_error: number; max_independent_error: number; max_additivity_error: number;
    max_gradient: number; max_kkt: number; max_clipping_brier_error: number };
}
export const rawViewKey = (gap: AbilityGap,coverage: number,scope: PairScope) => `gap${gap}-coverage${Math.round(coverage*100)}-${scope}`;
export function rawGain(row: RawAggregate, method: number, reference: RawReference): number | null {
  if (!row.brier || !row.duplicate_brier) return null;
  return (reference==="selection" ? row.brier[0] : row.duplicate_brier[method])-row.brier[method];
}
export function rawDirections(view: RawView,scope: TestScope,method: number,reference: RawReference) {
  const defined=view.directions.filter(d=>d.scopes[scope].pairs>0);
  return { positive:defined.filter(d=>(rawGain(d.scopes[scope],method,reference)??0)>1e-10).length,total:defined.length };
}
export async function loadRawPooling(key: string,signal?: AbortSignal): Promise<{index:RawIndex;view:RawView}> {
  const responses=await Promise.all([fetch(`${RAW_POOL_PATH}index.json`,{signal}),fetch(`${RAW_POOL_PATH}views/${key}.json`,{signal})]);
  for (const r of responses) if (!r.ok) throw new Error(`Raw pooling results could not be loaded (${r.status}).`);
  const [index,view]=await Promise.all(responses.map(r=>r.json())) as [RawIndex,RawView];
  if (index.schema_version!==1 || !index.exploratory || index.audit?.status!=="PASS" || index.methods?.join("|")!==RAW_METHODS.join("|")
    || !index.views?.includes(key) || view.key!==key || view.directions?.length!==10 || !view.primary?.scopes?.all || !view.primary?.scopes?.complementary)
    throw new Error("Raw pooling results failed the published data contract.");
  return {index,view};
}
