import type {AbilityGap,PairScope} from "../types/complementarity";
import type {TestScope} from "./typeSelection";
import {brierGain,loadMechanisms,type MechanismAggregate,type MechanismView} from "./typeSelectionMechanisms";
import {loadRawPooling,type RawAggregate} from "./typeSelectionNoCalibration";
import {loadCalibratedPooling} from "./typeSelectionCalibratedPooling";
import {loadStabilityView,type StabilityGroup} from "./aggregationStability";

export type DecisionFilters={gap:AbilityGap;coverage:number;pairScope:PairScope;scope:TestScope;stability?:StabilityGroup};
export type PoolMode="raw"|"input"|"output";
export type DecisionAggregate=Pick<MechanismAggregate,"pairs"|"events"|"targets"|"brier"|"ece"|"wins">;
export type DecisionDirection={split:number;fold:number;scopes:Record<TestScope,DecisionAggregate>};
export type DecisionView=Pick<MechanismView,"key"|"gap"|"coverage"|"pair_scope"> & {primary:DecisionDirection;directions:DecisionDirection[]};
export async function loadDecisionMechanisms(key:string,signal?:AbortSignal,cohort:StabilityGroup="original"){
  if(cohort==="original"){
    const [data,raw]=await Promise.all([loadMechanisms(key,signal),loadRawPooling(key,signal)]);
    for(const scope of ["all","complementary"] as const){
      const main=data.view.primary.scopes[scope],pool=raw.view.primary.scopes[scope];
      if(pool.pairs!==main.pairs||pool.events!==main.events||pool.targets!==main.targets||pool.pairs>0&&(!pool.brier||!Number.isFinite(pool.brier[7])||Math.abs(pool.brier[0]-main.brier![0])>1e-9))
        throw new Error("Uncalibrated matched aggregation does not share the published test support.");
    }
    return {...data,cohort,rawPrimary:raw.view.primary};
  }
  const {index,view}=await loadStabilityView(key,signal);
  const primary=view.cohorts[cohort].primary;
  return {index,view:{...view,...view.cohorts[cohort]} as DecisionView,cohort,counts:view.counts,
    rawPrimary:{...primary,scopes:{all:primary.scopes.all.pools.raw,complementary:primary.scopes.complementary.pools.raw}}};
}
export function initialDecisionFilters(search:string):DecisionFilters {
  const q=new URLSearchParams(search),coverage=Number(q.get("cc_coverage")??.5);
  return {gap:q.get("cc_gap")==="5"?5:3,coverage:[.5,.6,.7,.8].includes(coverage)?coverage:.5,
    pairScope:["different_model_version","matched_conditions"].includes(q.get("cc_scope")??"")?q.get("cc_scope") as PairScope:"all",
    scope:q.get("cc_test_scope")==="complementary"?"complementary":"all",
    stability:["fallback","all","original"].includes(q.get("cc_stability")??"")?q.get("cc_stability") as StabilityGroup:"stable"};
}
export function decisionSummary(view:DecisionView,scope:TestScope){
  const row=view.primary.scopes[scope],gain=brierGain(row.brier,6,7);
  const defined=view.directions.filter(d=>d.scopes[scope].pairs>0&&d.scopes[scope].brier);
  return {row,gain,relative:gain!=null&&row.brier?.[6]?gain/row.brier[6]:null,
    pairWins:row.wins?.[1]??null,directions:{positive:defined.filter(d=>brierGain(d.scopes[scope].brier,6,7)!>1e-10).length,total:defined.length},
    rows:[0,5,6,7].map(m=>({method:m,brier:row.brier?.[m]??null,ece:row.ece?.[m]??null})),
    singleImprovement:brierGain(row.brier,0,6)};
}
export function gainAgainstStrongSelection(row:RawAggregate,method:number,strongBaseline:number|null):number|null {
  return row.brier&&strongBaseline!=null?strongBaseline-row.brier[method]:null;
}
export async function loadDecisionPools(key:string,signal?:AbortSignal,cohort:StabilityGroup="original"){
  if(cohort!=="original"){
    const {index,view}=await loadStabilityView(key,signal),c=view.cohorts[cohort];
    const scopes=(mode:PoolMode)=>({all:c.primary.scopes.all.pools[mode],complementary:c.primary.scopes.complementary.pools[mode]});
    return {
      raw:{index:{method_labels:index.pool_labels},view:{key,primary:{scopes:scopes("raw")}}},
      calibrated:{index:{method_labels:index.pool_labels},view:{key,primary:{stages:{input:scopes("input"),output:scopes("output")}}}},
    };
  }
  const [raw,calibrated]=await Promise.all([loadRawPooling(key,signal),loadCalibratedPooling(key,signal)]);
  for(const scope of ["all","complementary"] as const){
    const r=raw.view.primary.scopes[scope];
    for(const stage of ["input","output"] as const){
      const c=calibrated.view.primary.stages[stage][scope];
      if(c.pairs!==r.pairs||c.events!==r.events||c.targets!==r.targets||c.raw_brier?.some((v,i)=>Math.abs(v-r.brier![i])>1e-9))
        throw new Error("Pooling comparisons do not share the same published test support.");
    }
  }
  return {raw,calibrated};
}
