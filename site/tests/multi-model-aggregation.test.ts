import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadTeamIndex,loadTeam,teamPaths,choosePath,subsetKey,type TeamIndex,type TeamRecord} from '../src/lib/multiModelAggregation';
const read=(p:string)=>JSON.parse(readFileSync(resolve('public/data/multi-model-aggregation',p),'utf8'));
const index=read('index.json') as TeamIndex;
afterEach(()=>vi.unstubAllGlobals());
describe('published complementary teams',()=>{
 it('all displayed members have a retained specialty and all inclusion paths use identical test support',()=>{
  const shards=new Map<string,Record<string,TeamRecord>>();
  for(const meta of index.groups){
   const prefix=meta.id.slice(2,4);if(!shards.has(prefix))shards.set(prefix,read(`teams/${prefix}.json`));const team=shards.get(prefix)![meta.id];
   const wins=new Set(team.routes.filter(r=>r.complementary).map(r=>team.models[r.selected]));expect([...wins].sort((a,b)=>a-b)).toEqual(team.models);
   for(const r of team.routes.filter(r=>r.complementary))expect(r.test_brier[r.selected]!).toBeLessThanOrEqual(Math.min(...r.test_brier as number[])+1e-12);
   const full=team.subsets[subsetKey(team.models)];
   for(const path of team.paths)for(let size=2;size<=path.length;size++){
    const row=team.subsets[subsetKey(path.slice(0,size))];expect(row.status).toBe('eligible');
    for(const scope of ['all','complementary'] as const){expect(row.scopes[scope].events).toBe(full.scopes[scope].events);expect(row.scopes[scope].targets).toBe(full.scopes[scope].targets);}
   }
  }
 });
 it('preserves the requested base and the longest available inclusion prefix',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>read(url.split('multi-model-aggregation/')[1])})));
  const data=await loadTeamIndex();const four=data.groups.find(g=>g.models.length===4)!;const paths=teamPaths(data,4,four.paths[0][0]);
  expect(paths.every(p=>p.path[0]===four.paths[0][0])).toBe(true);expect(choosePath(paths,four.paths[0])!.path).toEqual(four.paths[0]);
  await expect(loadTeam(four)).resolves.toHaveProperty('id',four.id);
 });
});
