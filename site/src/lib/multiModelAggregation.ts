import type {TestScope} from './typeSelection';
export const TEAM_PATH=`${import.meta.env.BASE_URL}data/multi-model-aggregation/`;
export interface TeamMeta {id:string;models:number[];paths:number[][];train_events:number;test_events:number;complementary_types:string[]}
export interface TeamIndex {schema_version:1;post_hoc:true;primary_split:number;primary_fold:number;models:string[];methods:string[];method_labels:string[];groups:TeamMeta[];counts:Record<string,number>}
export interface TeamScores {events:number;targets:number;brier:number[];ece:number[]}
export interface TeamSubset {models:number[];status:string;scopes:Record<TestScope,TeamScores>}
export interface TeamRecord extends TeamMeta {train_targets:number;test_targets:number;coverage:number;ability_range:number;subsets:Record<string,TeamSubset>;routes:{type:string;selected:number;complementary:boolean;train_events:number;test_events:number;train_brier:number[];test_brier:(number|null)[];test_status:string}[]}
export const subsetKey=(models:readonly number[])=>[...models].sort((a,b)=>a-b).join(',');
const indexCache:{value?:TeamIndex}={};
const shards=new Map<string,Record<string,TeamRecord>>();
async function fetchData(path:string,signal?:AbortSignal){const r=await fetch(`${TEAM_PATH}${path}`,{signal});if(!r.ok)throw new Error(`Model-count results could not be loaded (${r.status}).`);return r.json();}
export async function loadTeamIndex(signal?:AbortSignal):Promise<TeamIndex>{
  if(indexCache.value)return indexCache.value;
  const v=await fetchData('index.json',signal) as TeamIndex;
  if(v.schema_version!==1||!v.post_hoc||!Array.isArray(v.groups)||v.methods.join('|')!=='type_selection|strong_single|matched_calibrated|matched_uncalibrated|simple_mean')throw new Error('Model-count results failed the data contract.');
  for(const g of v.groups)if(!/^g-[a-f0-9]{12}$/.test(g.id)||g.models.length<2||g.models.length>4||!g.paths.length||g.paths.some(p=>p.length!==g.models.length||subsetKey(p)!==subsetKey(g.models)))throw new Error('Model-count inclusion paths are invalid.');
  if(!signal?.aborted)indexCache.value=v;return v;
}
export async function loadTeam(meta:TeamMeta,signal?:AbortSignal):Promise<TeamRecord>{
  const key=meta.id.slice(2,4);let shard=shards.get(key);
  if(!shard){shard=await fetchData(`teams/${key}.json`,signal);if(!signal?.aborted)shards.set(key,shard!);}
  const team=shard?.[meta.id];if(!team||subsetKey(team.models)!==subsetKey(meta.models))throw new Error('The selected team is missing.');
  const full=team.subsets[subsetKey(team.models)];
  for(const path of team.paths)for(let n=2;n<=path.length;n++){
    const s=team.subsets[subsetKey(path.slice(0,n))];if(!s||s.status!=='eligible')throw new Error('This model-count path is not eligible.');
    for(const scope of ['all','complementary'] as const){const score=s.scopes[scope],ref=full.scopes[scope];if(score.events!==ref.events||score.targets!==ref.targets||score.brier.length!==5||!score.brier.every(Number.isFinite))throw new Error('Model counts do not share the same test support.');}
  }
  return team;
}
export function teamPaths(index:TeamIndex,size:number,base?:number){return index.groups.filter(g=>g.models.length===size).flatMap(team=>team.paths.filter(p=>base==null||p[0]===base).map(path=>({team,path})));}
export function choosePath(options:ReturnType<typeof teamPaths>,preferred:number[]){
  return options.reduce<typeof options[number]|undefined>((best,v)=>{
    const prefix=(p:number[])=>{let n=0;while(n<preferred.length&&p[n]===preferred[n])n++;return n;};
    return !best||prefix(v.path)>prefix(best.path)?v:best;
  },undefined);
}
