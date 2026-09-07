import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {decisionSummary,gainAgainstStrongSelection,initialDecisionFilters,loadDecisionPools} from "../src/lib/aggregationDecision";
import type {MechanismView} from "../src/lib/typeSelectionMechanisms";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data",p),"utf8"));
afterEach(()=>vi.unstubAllGlobals());
describe("aggregation verdict uses the strong matched comparator",()=>{
  it("keeps historical global atlas filters separate and validates the three study filters",()=>{
    expect(initialDecisionFilters("?type=finance_economics&metric=adjusted_pog&cc_gap=100&cc_scope=bad&cc_coverage=0.9")).toEqual({gap:3,pairScope:"all",coverage:.5,scope:"all",stability:"stable"});
    expect(initialDecisionFilters("?cc_gap=5&cc_scope=matched_conditions&cc_coverage=0.8&cc_test_scope=complementary")).toEqual({gap:5,pairScope:"matched_conditions",coverage:.8,scope:"complementary",stability:"stable"});
  });
  it("uses flexible selection versus the matched joint in every published view",()=>{
    const index=read("type-selection-mechanisms/index.json");
    for(const key of index.views){
      const view:MechanismView=read(`type-selection-mechanisms/views/${key}.json`);
      for(const scope of ["all","complementary"] as const){
        const s=decisionSummary(view,scope),r=view.primary.scopes[scope];
        expect(s.rows.map(v=>v.method)).toEqual([0,5,6,7]);
        if(!r.pairs){expect(s.gain).toBeNull();continue;}
        expect(s.gain).toBeCloseTo(r.brier![6]-r.brier![7],12);
        expect(s.relative).toBeCloseTo((r.brier![6]-r.brier![7])/r.brier![6],12);
        expect(s.pairWins).toBe(r.wins![1]);
        const defined=view.directions.filter(d=>d.scopes[scope].pairs);
        expect(s.directions).toEqual({positive:defined.filter(d=>d.scopes[scope].brier![6]-d.scopes[scope].brier![7]>1e-10).length,total:defined.length});
      }
    }
  });
  it("does not imply simpler calibration pools beat the strong single baseline",()=>{
    const key="gap3-coverage50-all",view=read(`type-selection-mechanisms/views/${key}.json`),cal=read(`type-selection-calibrated-pooling/views/${key}.json`);
    for(const scope of ["all","complementary"] as const)for(const stage of ["input","output"] as const){
      const r=cal.primary.stages[stage][scope],strong=view.primary.scopes[scope].brier[6];
      expect(r.brier[0]-r.brier[8]).toBeGreaterThan(0);
      expect(gainAgainstStrongSelection(r,8,strong)).toBeLessThan(0);
      expect(gainAgainstStrongSelection({...r,brier:null},8,strong)).toBeNull();
    }
  });
  it("validates that raw and calibrated supporting results use the same support",async()=>{
    const key="gap3-coverage50-all";
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>read(url.split("data/")[1])})));
    await expect(loadDecisionPools(key)).resolves.toHaveProperty("raw.view.key",key);
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>{
      const v=read(url.split("data/")[1]);
      if(url.includes("calibrated-pooling/views"))v.primary.stages.input.all.pairs-=1;
      return v;
    }})));
    await expect(loadDecisionPools(key)).rejects.toThrow("same published test support");
  });
});
