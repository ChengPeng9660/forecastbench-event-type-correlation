import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {initialDecisionFilters,loadDecisionMechanisms,loadDecisionPools} from "../src/lib/aggregationDecision";
import {loadDecisionPair,loadDecisionPairIndex,pairEligible,pairDecisionSummary,type DecisionPair,type DecisionPairIndex} from "../src/lib/aggregationDecisionPairs";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data",p),"utf8"));
const index=read("aggregation-stability/index.json") as DecisionPairIndex;
const shards=new Map<string,Record<string,DecisionPair>>();
const pair=(id:string)=>{const shard=id.slice(2,4);if(!shards.has(shard))shards.set(shard,read(`aggregation-stability/pairs/${shard}.json`));return shards.get(shard)![id];};
afterEach(()=>vi.unstubAllGlobals());

describe("post-hoc no-reversal pairs and training-overall fallback",()=>{
  it("defaults to no reversals and keeps cohort grouping separate from test scopes",()=>{
    expect(initialDecisionFilters("").stability).toBe("stable");
    expect(initialDecisionFilters("?cc_stability=unknown").stability).toBe("stable");
    expect(initialDecisionFilters("?cc_stability=fallback&cc_test_scope=complementary")).toMatchObject({stability:"fallback",scope:"complementary"});
  });
  it("retains only originally complementary pairs and validates every primary policy",()=>{
    const original=read("aggregation-decision-pairs/index.json");
    expect(index.pairs.map(p=>p.id).sort()).toEqual(original.pairs.map((p:any)=>p.id).sort());
    for(const meta of index.pairs){
      const p=pair(meta.id),types=p.routes.filter(r=>r.complementary);
      expect(types.some(r=>r.selected===0)).toBe(true);expect(types.some(r=>r.selected===1)).toBe(true);
      expect(types.every(r=>r.train_events>=30&&Math.abs(r.train_gap_bi)>=1)).toBe(true);
      if(p.stability==="no_reversal"){
        expect(types.every(r=>r.test_events!>0&&["retained","tied"].includes(r.test_status!))).toBe(true);
        expect(p.routes.every(r=>r.policy_selected===r.selected)).toBe(true);
      }else{
        expect(p.routes.every(r=>r.policy_selected===p.overall_choice)).toBe(true);
        for(const scope of ["all","complementary"] as const)expect(p.scopes[scope].brier[0]).toBeCloseTo(p.scopes[scope].single_brier[p.overall_choice!],12);
      }
      expect(p.train_overall_brier![p.overall_choice!]).toBeLessThanOrEqual(p.train_overall_brier![1-p.overall_choice!]+1e-12);
    }
  });
  it("reconstructs every displayed cohort from the exported pair membership",()=>{
    for(const key of read("aggregation-stability/index.json").views){
      const view=read(`aggregation-stability/views/${key}.json`);
      const historical=read(`type-selection-mechanisms/views/${key}.json`);
      expect(view.cohorts.all.primary.scopes.all.pairs).toBe(historical.primary.scopes.all.pairs);
      for(const stability of ["stable","fallback","all"] as const){
        const f={gap:view.gap,coverage:view.coverage,pairScope:view.pair_scope,scope:"all" as const,stability};
        const selected=index.pairs.filter(p=>pairEligible(p,f)).map(p=>pair(p.id));
        for(const scope of ["all","complementary"] as const){
          const expected=view.cohorts[stability].primary.scopes[scope];
          expect(selected).toHaveLength(expected.pairs);
          if(selected.length)for(const mode of ["raw","input","output"] as const){
            const mean=selected.reduce((sum,p)=>sum+p.scopes[scope].pools[mode].brier[0],0)/selected.length;
            expect(mean).toBeCloseTo(expected.pools[mode].brier[0],12);
          }
        }
      }
    }
  });
  it("uses Grok's training-overall win after its Health advantage reverses",()=>{
    const p=pair("p-8ff6126fb390"),old=read("aggregation-decision-pairs/pairs/8f.json")[p.id];
    expect(p.stability).toBe("reversed");expect(p.overall_choice).toBe(0);
    expect(p.routes.find(r=>r.type==="health")).toMatchObject({train_events:30,test_events:29,test_status:"reversed",policy_selected:0});
    expect(pairEligible(p,initialDecisionFilters(""))).toBe(false);
    expect(pairEligible(p,initialDecisionFilters("?cc_stability=fallback"))).toBe(true);
    expect(p.scopes.complementary.brier[0]).toBeCloseTo(.19803627545510083,12);
    expect(p.scopes.complementary.single_brier[1]).toBeLessThan(p.scopes.complementary.brier[0]);
    for(const mode of ["raw","input","output"] as const)expect(p.scopes.complementary.pools[mode].brier.slice(2,6)).toEqual(old.scopes.complementary.pools[mode].brier.slice(2,6));
    expect(p.scopes.complementary.pools.output.brier[0]).not.toBe(old.scopes.complementary.pools.output.brier[0]);
    const summary=pairDecisionSummary(p,initialDecisionFilters("?cc_stability=fallback"));
    expect(summary.directions.every(d=>d.stability!=="no_reversal")).toBe(true);
  });
  it("loads the new source and preserves the same support in all calibration modes",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>read(url.split("data/")[1])})));
    const next=await loadDecisionPairIndex(undefined,true);
    const meta=next.pairs.find(p=>p.id==="p-8ff6126fb390")!;
    await expect(loadDecisionPair(meta,next)).resolves.toHaveProperty("stability","reversed");
    const key="gap3-coverage50-all",data=await loadDecisionMechanisms(key,undefined,"stable"),pools=await loadDecisionPools(key,undefined,"stable");
    expect(data.cohort).toBe("stable");
    expect(data.view.primary.scopes.all.pairs).toBe(pools.raw.view.primary.scopes.all.pairs);
    expect(pools.raw.view.primary.scopes.all.pairs).toBe(pools.calibrated.view.primary.stages.output.all.pairs);
  });
});
