import type {AbilityGap,PairScope} from "../types/complementarity";
import type {TestScope} from "./typeSelection";
import {brierGain,positiveDirections,type MechanismView} from "./typeSelectionMechanisms";
import {loadRawPooling,type RawAggregate} from "./typeSelectionNoCalibration";
import {loadCalibratedPooling} from "./typeSelectionCalibratedPooling";

export type DecisionFilters={gap:AbilityGap;coverage:number;pairScope:PairScope;scope:TestScope};
export type PoolMode="raw"|"input"|"output";
export function initialDecisionFilters(search:string):DecisionFilters {
  const q=new URLSearchParams(search),coverage=Number(q.get("cc_coverage")??.5);
  return {gap:q.get("cc_gap")==="5"?5:3,coverage:[.5,.6,.7,.8].includes(coverage)?coverage:.5,
    pairScope:["different_model_version","matched_conditions"].includes(q.get("cc_scope")??"")?q.get("cc_scope") as PairScope:"all",
    scope:q.get("cc_test_scope")==="complementary"?"complementary":"all"};
}
export function decisionSummary(view:MechanismView,scope:TestScope){
  const row=view.primary.scopes[scope],gain=brierGain(row.brier,6,7);
  return {row,gain,relative:gain!=null&&row.brier?.[6]?gain/row.brier[6]:null,
    pairWins:row.wins?.[1]??null,directions:positiveDirections(view,scope,6,7),
    rows:[0,5,6,7].map(m=>({method:m,brier:row.brier?.[m]??null,ece:row.ece?.[m]??null})),
    singleImprovement:brierGain(row.brier,0,6)};
}
export function gainAgainstStrongSelection(row:RawAggregate,method:number,strongBaseline:number|null):number|null {
  return row.brier&&strongBaseline!=null?strongBaseline-row.brier[method]:null;
}
export async function loadDecisionPools(key:string,signal?:AbortSignal){
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
