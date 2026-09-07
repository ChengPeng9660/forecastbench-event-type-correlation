import type {DecisionFilters,PoolMode} from "./aggregationDecision";
import type {TrainingRoute,TestScope} from "./typeSelection";
import {MECHANISM_METHODS} from "./typeSelectionMechanisms";
import {RAW_METHODS} from "./typeSelectionNoCalibration";
import {STABILITY_PATH,matchesStability,type StabilityStatus} from "./aggregationStability";

export const DECISION_PAIR_PATH=`${import.meta.env.BASE_URL}data/aggregation-decision-pairs/`;
export interface DecisionPairMeta {
  id:string;model_a:string;model_b:string;train_gap:number;train_coverage:number;
  same_model_version:boolean;same_prompt:boolean;same_information:boolean;
  stability?:StabilityStatus;overall_choice?:number;
}
export interface PairScores {events:number;targets:number;brier:number[];ece:number[]}
export interface DecisionPairDirection {
  split:number;fold:number;train_gap:number;train_coverage:number;
  stability?:StabilityStatus;overall_choice?:number;
  scopes:Record<TestScope,{events:number;targets:number;brier:(number|null)[]}>;
}
export interface DecisionPair extends DecisionPairMeta {
  scopes:Record<TestScope,PairScores & {pools:Record<PoolMode,PairScores>;single_brier:number[]}>;
  directions:DecisionPairDirection[];routes:(TrainingRoute & {test_events?:number;test_brier_a?:number|null;test_brier_b?:number|null;test_status?:string;policy_selected?:number})[];
  train_overall_brier?:number[];
}
export interface DecisionPairIndex {
  schema_version:1;primary_split:number;primary_fold:number;mechanism_methods:string[];
  pool_methods:string[];pool_labels:string[];pairs:DecisionPairMeta[];
  post_hoc?:boolean;
}
export const pairHasBase=(pair:DecisionPairMeta,base:string)=>pair.model_a===base||pair.model_b===base;
export const pairPartner=(pair:DecisionPairMeta,base:string)=>pair.model_a===base?pair.model_b:pair.model_a;
export const pairBaseSide=(pair:DecisionPairMeta,base:string)=>pair.model_a===base?0:1;
export function pairsForBase(pairs:DecisionPairMeta[],base:string,filters:DecisionFilters){
  return pairs.filter(p=>pairHasBase(p,base)&&pairEligible(p,filters)).sort((a,b)=>pairPartner(a,base).localeCompare(pairPartner(b,base)));
}
export function writeDecisionQuery(values:Record<string,string>){
  const q=new URLSearchParams(location.search);for(const [key,value] of Object.entries(values))q.set(key,value);
  history.replaceState(null,"",`${location.pathname}?${q}${location.hash}`);
}
export function pairEligible(p:Pick<DecisionPairMeta,"train_gap"|"train_coverage"|"same_model_version"|"same_prompt"|"same_information"|"stability">,f:DecisionFilters){
  return matchesStability(p.stability,f.stability)&&p.train_gap<=f.gap+1e-12&&p.train_coverage>=f.coverage&&(f.pairScope==="all"||f.pairScope==="different_model_version"&&!p.same_model_version||f.pairScope==="matched_conditions"&&p.same_prompt&&p.same_information);
}
export function searchDecisionPairs(pairs:DecisionPairMeta[],query:string){
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return pairs.filter(p=>terms.every(t=>`${p.model_a} ${p.model_b} ${p.id}`.toLowerCase().includes(t)));
}
export function pairDecisionSummary(pair:DecisionPair,filters:DecisionFilters){
  const row=pair.scopes[filters.scope],gain=row.brier[6]-row.brier[7];
  const directions=pair.directions.filter(d=>pairEligible({...pair,...d},filters)&&d.scopes[filters.scope].events>0&&d.scopes[filters.scope].brier.every(v=>v!=null));
  return {row,gain,relative:row.brier[6]>0?gain/row.brier[6]:null,directions,
    positive:directions.filter(d=>d.scopes[filters.scope].brier[2]!-d.scopes[filters.scope].brier[3]!>1e-10).length};
}
export async function loadDecisionPairIndex(signal?:AbortSignal,postHoc=false):Promise<DecisionPairIndex>{
  const r=await fetch(`${postHoc?STABILITY_PATH:DECISION_PAIR_PATH}index.json`,{signal});
  if(!r.ok)throw new Error(`Pair list could not be loaded (${r.status}).`);
  const d=await r.json() as DecisionPairIndex;
  if(postHoc&&(!d.post_hoc||d.pairs?.some(p=>!p.stability||![0,1].includes(p.overall_choice!))))throw new Error("Stability pair metadata is incomplete.");
  if(d.schema_version!==1||d.mechanism_methods?.join("|")!==MECHANISM_METHODS.join("|")||d.pool_methods?.join("|")!==RAW_METHODS.join("|")||!Array.isArray(d.pairs)||d.pairs.some(p=>!/^p-[a-f0-9]{12}$/.test(p.id)||!p.model_a||!p.model_b))throw new Error("Pair list failed the published data contract.");
  return d;
}
const cache=new Map<string,Record<string,DecisionPair>>();
export async function loadDecisionPair(meta:DecisionPairMeta,index:DecisionPairIndex,signal?:AbortSignal):Promise<DecisionPair>{
  const shard=meta.id.slice(2,4);
  const path=index.post_hoc?STABILITY_PATH:DECISION_PAIR_PATH,key=`${path}${shard}`;
  let rows=cache.get(key);
  if(!rows){const r=await fetch(`${path}pairs/${shard}.json`,{signal});if(!r.ok)throw new Error(`Pair results could not be loaded (${r.status}).`);rows=await r.json() as Record<string,DecisionPair>;}
  const pair=rows[meta.id];
  if(!pair||Object.entries(meta).some(([k,v])=>pair[k as keyof DecisionPair]!==v)||!Array.isArray(pair.directions)||!Array.isArray(pair.routes))throw new Error("The selected pair does not match its published record.");
  const primary=pair.directions.find(d=>d.split===index.primary_split&&d.fold===index.primary_fold);
  for(const scope of ["all","complementary"] as const){
    const s=pair.scopes?.[scope];
    const primaryScope=primary?.scopes?.[scope];
    if(!s||s.brier?.length!==10||s.ece?.length!==10||!s.brier.every(Number.isFinite)||!primaryScope||primaryScope.events!==s.events||primaryScope.targets!==s.targets||primaryScope.brier?.length!==4||!primaryScope.brier.every(v=>v!=null&&Number.isFinite(v))||[0,5,6,7].some((m,i)=>Math.abs(s.brier[m]-primaryScope.brier[i]!)>1e-12))throw new Error("The selected pair has inconsistent matched scores.");
    for(const mode of ["raw","input","output"] as const){const p=s.pools?.[mode];if(!p||p.events!==s.events||p.targets!==s.targets||p.brier?.length!==10||!p.brier.every(Number.isFinite))throw new Error("The pair pooling methods do not share the same test support.");}
  }
  if(index.post_hoc){
    const complementary=pair.routes.filter(r=>r.complementary);
    if(!complementary.length||!complementary.some(r=>r.selected===0)||!complementary.some(r=>r.selected===1))throw new Error("Pair lacks crossed complementary types.");
    if(pair.stability==="no_reversal"&&complementary.some(r=>!r.test_events||!["retained","tied"].includes(r.test_status??"")))throw new Error("A no-reversal pair contains an unverified or reversed type.");
    for(const scope of ["all","complementary"] as const)if(pair.stability!=="no_reversal"&&Math.abs(pair.scopes[scope].brier[0]-pair.scopes[scope].single_brier[pair.overall_choice!])>1e-12)throw new Error("Fallback scores do not use the training-overall model.");
  }
  if(!signal?.aborted)cache.set(key,rows);
  return pair;
}
