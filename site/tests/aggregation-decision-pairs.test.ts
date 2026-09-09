import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {initialDecisionFilters} from "../src/lib/aggregationDecision";
import {loadDecisionPair,loadDecisionPairIndex,pairEligible,pairDecisionSummary,searchDecisionPairs,pairsForBase,pairBaseSide,pairPartner,type DecisionPairIndex,type DecisionPair} from "../src/lib/aggregationDecisionPairs";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data",p),"utf8"));
const index:DecisionPairIndex=read("aggregation-decision-pairs/index.json");
const pair=(id:string):DecisionPair=>read(`aggregation-decision-pairs/pairs/${id.slice(2,4)}.json`)[id];
afterEach(()=>vi.unstubAllGlobals());
describe("individual pair evidence",()=>{
  it("keeps exact base configurations and reverses role labels without changing scores",()=>{
    const p=pair("p-feba1dc1f7ef"),f=initialDecisionFilters("");
    for(const base of [p.model_a,p.model_b]){
      const partners=pairsForBase(index.pairs,base,f);
      expect(partners.every(v=>v.model_a===base||v.model_b===base)).toBe(true);
      expect(partners.some(v=>v.id===p.id)).toBe(true);
      expect(pairPartner(p,base)).toBe(base===p.model_a?p.model_b:p.model_a);
      expect(pairBaseSide(p,base)).toBe(base===p.model_a?0:1);
    }
    expect(pairsForBase(index.pairs,"missing exact configuration",f)).toEqual([]);
  });
  it("reproduces the eligible primary pair counts for every cohort",()=>{
    const mechanisms=read("type-selection-mechanisms/index.json");
    for(const key of mechanisms.views){
      const v=read(`type-selection-mechanisms/views/${key}.json`);
      const f={gap:v.gap,coverage:v.coverage,pairScope:v.pair_scope,scope:"all" as const};
      expect(index.pairs.filter(p=>pairEligible(p,f))).toHaveLength(v.primary.scopes.all.pairs);
    }
    expect(read("aggregation-decision-pairs/provenance.json").validated_primary_mean_scores).toBe(3840);
  });
  it("retains a losing pair and uses that pair's direction eligibility",()=>{
    const p=pair("p-feba1dc1f7ef"),f={...initialDecisionFilters(""),scope:"all" as const};
    const s=pairDecisionSummary(p,f);
    expect(s.gain).toBeCloseTo(-0.00023816306136345577,12);
    expect(s.row.events).toBe(180);
    expect(s.relative).toBeLessThan(0);
    expect(s.directions.every(d=>d.train_gap<=3+1e-12&&d.train_coverage>=.5)).toBe(true);
    expect(s.positive).toBe(s.directions.filter(d=>d.scopes.all.brier[2]!>d.scopes.all.brier[3]!+1e-10).length);
    expect(pairEligible(p,{...f,pairScope:"matched_conditions"})).toBe(false);
    expect(pairDecisionSummary(p,{...f,scope:"complementary"}).row.events).not.toBe(s.row.events);
  });
  it("searches full exact configurations without ranking on test gains",()=>{
    expect(searchDecisionPairs(index.pairs,"gpt-5 claude").every(p=>`${p.model_a} ${p.model_b}`.toLowerCase().includes("gpt-5")&&`${p.model_a} ${p.model_b}`.toLowerCase().includes("claude"))).toBe(true);
    expect(searchDecisionPairs(index.pairs,"p-feba1dc1f7ef").map(p=>p.id)).toEqual(["p-feba1dc1f7ef"]);
    expect(searchDecisionPairs(index.pairs,"not-a-model")).toHaveLength(0);
  });
  it("loads only the chosen shard and rejects inconsistent supports",async()=>{
    const requested:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{requested.push(url);return {ok:true,json:async()=>read(url.split("data/")[1])};}));
    await expect(loadDecisionPairIndex()).resolves.toHaveProperty("pairs.length",2805);
    const meta=index.pairs.find(p=>p.id==="p-001112c40ea7")!;
    const expected=pair(meta.id);
    const typewise=read("typewise-matched-aggregation/pairs/00.json").pairs[meta.id];
    await expect(loadDecisionPair(meta,index)).resolves.toEqual({...expected,typewise});
    expect(requested).toHaveLength(3);
    expect(requested[1]).toContain("/pairs/00.json");
    expect(requested[2]).toContain("/typewise-matched-aggregation/pairs/00.json");
    const other=index.pairs.find(p=>p.id==="p-feba1dc1f7ef")!;
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>{const d=read(url.split("data/")[1]);d[other.id].scopes.all.pools.output.events-=1;return d;}})));
    await expect(loadDecisionPair(other,index)).rejects.toThrow("same test support");
  });
});
