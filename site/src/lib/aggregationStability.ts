import type {DecisionAggregate,DecisionDirection,DecisionView,PoolMode} from "./aggregationDecision";
import {MECHANISM_METHODS} from "./typeSelectionMechanisms";
import {RAW_METHODS} from "./typeSelectionNoCalibration";
import type {TestScope} from "./typeSelection";

export const STABILITY_PATH=`${import.meta.env.BASE_URL}data/aggregation-stability/`;
export type StabilityGroup="stable"|"fallback"|"all"|"original";
export type StabilityStatus="no_reversal"|"reversed"|"unverified";
export const matchesStability=(status:StabilityStatus|undefined,group:StabilityGroup|undefined)=>
  !status||!group||group==="original"||group==="all"||(group==="stable"?status==="no_reversal":status!=="no_reversal");
type PoolScores=Pick<DecisionAggregate,"pairs"|"events"|"targets"|"brier"|"ece">;
interface StabilityDirection extends DecisionDirection {
  scopes:Record<TestScope,DecisionAggregate & {pools:Record<PoolMode,PoolScores>}>;
}
interface StabilityView extends Pick<DecisionView,"key"|"gap"|"coverage"|"pair_scope"> {
  cohorts:Record<Exclude<StabilityGroup,"original">,{primary:StabilityDirection;directions:StabilityDirection[]}>;
  counts:Record<StabilityStatus,number>;
}
interface StabilityIndex {
  schema_version:1;post_hoc:true;primary_split:number;primary_fold:number;
  mechanism_methods:string[];pool_methods:string[];pool_labels:string[];views:string[];
  audit:{status:string};
}
const cache=new Map<string,{index:StabilityIndex;view:StabilityView}>();
export async function loadStabilityView(key:string,signal?:AbortSignal){
  const cached=cache.get(key);if(cached)return cached;
  const responses=await Promise.all([fetch(`${STABILITY_PATH}index.json`,{signal}),fetch(`${STABILITY_PATH}views/${key}.json`,{signal})]);
  for(const r of responses)if(!r.ok)throw new Error(`Stability results could not be loaded (${r.status}).`);
  const [index,view]=await Promise.all(responses.map(r=>r.json())) as [StabilityIndex,StabilityView];
  if(index.schema_version!==1||!index.post_hoc||index.audit?.status!=="PASS"||index.mechanism_methods?.join("|")!==MECHANISM_METHODS.join("|")||index.pool_methods?.join("|")!==RAW_METHODS.join("|")||!index.views.includes(key)||view.key!==key)throw new Error("Stability results failed the published data contract.");
  for(const group of ["stable","fallback","all"] as const){
    const c=view.cohorts?.[group];
    if(!c||c.directions?.length!==10)throw new Error("Stability directions are incomplete.");
    for(const d of [c.primary,...c.directions])for(const scope of ["all","complementary"] as const){
      const r=d.scopes?.[scope];
      if(!r||r.pairs<0||r.pairs>0&&(!r.brier||r.brier.length!==10||!r.brier.every(Number.isFinite)||r.ece?.length!==10))throw new Error("Stability scores are incomplete.");
      for(const mode of ["raw","input","output"] as const){
        const pool=r.pools?.[mode];
        if(!pool||pool.pairs!==r.pairs||pool.events!==r.events||pool.targets!==r.targets||r.pairs>0&&(pool.brier?.length!==10||!pool.brier.every(Number.isFinite)))throw new Error("Stability pooling methods do not share test support.");
      }
    }
  }
  for(const scope of ["all","complementary"] as const)if(view.cohorts.stable.primary.scopes[scope].pairs+view.cohorts.fallback.primary.scopes[scope].pairs!==view.cohorts.all.primary.scopes[scope].pairs)throw new Error("Stability cohorts do not partition the eligible pairs.");
  const result={index,view};if(!signal?.aborted)cache.set(key,result);return result;
}
