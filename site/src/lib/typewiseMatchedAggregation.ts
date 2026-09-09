import type {AbilityGap,PairScope} from "../types/complementarity";
import type {TestScope} from "./typeSelection";
import type {DecisionPair,DecisionPairIndex,DecisionPairMeta,PairScores} from "./aggregationDecisionPairs";

export const TYPEWISE_PATH=`${import.meta.env.BASE_URL}data/typewise-matched-aggregation/`;
export const TYPEWISE_METHODS=["type_selection","global_joint","event_type_joint"] as const;
export const EVENT_TYPE_METHODS=["model_a","model_b","global_joint","event_type_joint"] as const;
const TYPEWISE_COHORTS=["all","no_reversal","reversed_or_unverified"] as const;
export type TypewiseCohort="all"|"no_reversal"|"reversed_or_unverified";
export interface TypewiseAggregate {
  pairs:number;events:number|null;targets:number|null;
  brier:number[]|null;ece:number[]|null;duplicate_brier:number[]|null;
  wins_vs_selection:number[]|null;wins_vs_global:number[]|null;duplicate_wins:number[]|null;
}
export interface TypewiseDirection {split:number;fold:number;scopes:Record<TestScope,TypewiseAggregate>}
export interface TypewiseCohortView {
  primary:TypewiseDirection;directions:TypewiseDirection[];
  direction_summary:Record<TestScope,{
    defined_directions:number;brier_better_than_selection:number[];ece_better_than_selection:number[];
    typewise_brier_better_than_global:number;typewise_ece_better_than_global:number;
  }>;
}
export interface TypewiseView {
  key:string;gap:AbilityGap;coverage:number;pair_scope:PairScope;
  cohorts:Record<TypewiseCohort,TypewiseCohortView>;
}
export interface TypewiseIndex {
  schema_version:1;date:string;exploratory:true;methods:string[];method_labels:string[];
  primary_split:number;primary_fold:number;cohorts:TypewiseCohort[];
  scopes:TestScope[];views:string[];
  audit:{status:string;pair_directions:number;primary_pairs:number;independent_directions:number;
    max_independent_error:number;max_gradient:number;max_parent_score_error:number;
    train_only_coefficients:boolean;test_outcomes_used_only_for_post_hoc_cohorts:boolean};
}

export interface TypewisePair extends DecisionPairMeta {
  scopes:Record<TestScope,PairScores>;
  event_types:Record<string,PairScores>;
}
interface TypewisePairShard {
  schema_version:2;methods:string[];event_type_methods:string[];primary_split:number;primary_fold:number;
  source_audit_status:string;pairs:Record<string,TypewisePair>;
}
const pairCache=new Map<string,TypewisePairShard>();

export async function loadTypewisePair(pair:DecisionPair,index:DecisionPairIndex,signal?:AbortSignal):Promise<TypewisePair>{
  const shard=pair.id.slice(2,4);
  let data=pairCache.get(shard);
  if(!data){
    const response=await fetch(`${TYPEWISE_PATH}pairs/${shard}.json`,{signal});
    if(!response.ok)throw new Error(`Event-type pair results could not be loaded (${response.status}).`);
    data=await response.json() as TypewisePairShard;
  }
  if(data.schema_version!==2||data.source_audit_status!=="PASS"||data.methods?.join("|")!==TYPEWISE_METHODS.join("|")||
    data.event_type_methods?.join("|")!==EVENT_TYPE_METHODS.join("|")||
    data.primary_split!==index.primary_split||data.primary_fold!==index.primary_fold)
    throw new Error("Event-type pair results failed the published data contract.");
  const result=data.pairs?.[pair.id];
  const fields=["id","model_a","model_b","train_gap","train_coverage","same_model_version","same_prompt","same_information"] as const;
  if(!result||fields.some(field=>result[field]!==pair[field])||index.post_hoc&&result.stability!==pair.stability)
    throw new Error("Event-type scores do not match the selected pair.");
  for(const scope of ["all","complementary"] as const){
    const scores=result.scopes?.[scope],baseline=pair.scopes[scope].pools.raw;
    if(!scores||scores.events!==baseline.events||scores.targets!==baseline.targets||
      [scores.brier,scores.ece].some(values=>values?.length!==3||!values.every(Number.isFinite)))
      throw new Error("Event-type pair scores do not share the same test support.");
    for(const metric of ["brier","ece"] as const)if([0,7].some((method,i)=>Math.abs(scores[metric][i]-baseline[metric][method])>1e-12))
      throw new Error("Event-type pair scores do not reproduce selection and the global weight.");
  }
  const complementary=pair.routes.filter(route=>route.complementary);
  const eventTypes=result.event_types;
  if(!eventTypes||Object.keys(eventTypes).sort().join("|")!==complementary.map(route=>route.type).sort().join("|"))
    throw new Error("Event-type pair scores do not match the complementary routes.");
  let events=0,targets=0;
  const reconstructed=[0,0,0];
  for(const route of complementary){
    const row=eventTypes[route.type];
    if(!row||!Number.isInteger(row.events)||row.events<=0||!Number.isInteger(row.targets)||row.targets<row.events||
      [row.brier,row.ece].some(values=>values?.length!==EVENT_TYPE_METHODS.length||
        !values.every(value=>Number.isFinite(value)&&value>=0&&value<=1)))
      throw new Error("Event-type performance scores are incomplete.");
    events+=row.events;targets+=row.targets;
    reconstructed[0]+=row.events*row.brier[route.selected];
    reconstructed[1]+=row.events*row.brier[2];
    reconstructed[2]+=row.events*row.brier[3];
    for(const [side,expected] of [[0,route.test_brier_a],[1,route.test_brier_b]] as const)
      if(expected!=null&&Math.abs(row.brier[side]-expected)>1e-12)
        throw new Error("Event-type model scores do not match the selected pair.");
  }
  const complementaryScope=result.scopes.complementary;
  if(events!==complementaryScope.events||targets!==complementaryScope.targets||
    reconstructed.some((value,method)=>Math.abs(value/events-complementaryScope.brier[method])>1e-12))
    throw new Error("Event-type performance scores do not reproduce the pair totals.");
  if(!signal?.aborted)pairCache.set(shard,data);
  return result;
}

const cache=new Map<string,{index:TypewiseIndex;view:TypewiseView}>();
const complete=(row:TypewiseAggregate)=>row.pairs>=0&&(
  row.pairs===0||[row.brier,row.ece,row.duplicate_brier,row.wins_vs_selection,row.wins_vs_global,row.duplicate_wins]
    .every(values=>values?.length===TYPEWISE_METHODS.length&&values.every(Number.isFinite))
);

export async function loadTypewiseAggregation(key:string,signal?:AbortSignal){
  const cached=cache.get(key);if(cached)return cached;
  const responses=await Promise.all([
    fetch(`${TYPEWISE_PATH}index.json`,{signal}),
    fetch(`${TYPEWISE_PATH}views/${key}.json`,{signal}),
  ]);
  for(const response of responses)if(!response.ok)throw new Error(`Event-type aggregation results could not be loaded (${response.status}).`);
  const [index,view]=await Promise.all(responses.map(response=>response.json())) as [TypewiseIndex,TypewiseView];
  if(index.schema_version!==1||!index.exploratory||index.audit?.status!=="PASS"||
    !index.audit.train_only_coefficients||index.methods?.join("|")!==TYPEWISE_METHODS.join("|")||
    index.cohorts?.join("|")!==TYPEWISE_COHORTS.join("|")||index.scopes?.join("|")!=="all|complementary"||
    !index.views?.includes(key)||view.key!==key)throw new Error("Event-type aggregation results failed the published data contract.");
  for(const cohort of TYPEWISE_COHORTS){
    const group=view.cohorts?.[cohort];
    if(!group||group.directions?.length!==10)throw new Error("Event-type aggregation directions are incomplete.");
    for(const direction of [group.primary,...group.directions])for(const scope of ["all","complementary"] as const)
      if(!direction.scopes?.[scope]||!complete(direction.scopes[scope]))throw new Error("Event-type aggregation scores are incomplete.");
  }
  for(const scope of ["all","complementary"] as const){
    const cohorts=view.cohorts;
    if(cohorts.no_reversal.primary.scopes[scope].pairs+cohorts.reversed_or_unverified.primary.scopes[scope].pairs!==cohorts.all.primary.scopes[scope].pairs)
      throw new Error("Event-type aggregation cohorts do not partition the eligible pairs.");
  }
  const result={index,view};if(!signal?.aborted)cache.set(key,result);return result;
}
