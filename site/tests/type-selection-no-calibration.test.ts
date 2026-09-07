import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach,describe,expect,it,vi } from "vitest";
import { loadRawPooling,rawDirections,rawGain,rawViewKey,type RawAggregate,type RawIndex,type RawView } from "../src/lib/typeSelectionNoCalibration";

const root="public/data/type-selection-no-calibration";
const read=(file:string)=>JSON.parse(readFileSync(resolve(root,file),"utf8"));
const index:RawIndex=read("index.json");
afterEach(()=>vi.unstubAllGlobals());

describe("raw pooling without calibration",()=>{
  it("preserves the original methods on all common directions and filters",()=>{
    for(const key of index.views){
      const view:RawView=read(`views/${key}.json`);
      const parent=JSON.parse(readFileSync(resolve(`public/data/type-selection-mechanisms/views/${key}.json`),"utf8"));
      expect(view.key).toBe(rawViewKey(view.gap,view.coverage,view.pair_scope));
      for(let d=0;d<10;d++)for(const scope of ["all","complementary"] as const){
        const r=view.directions[d].scopes[scope],old=parent.directions[d].scopes[scope];
        expect(r.pairs).toBe(old.pairs);
        if(!r.pairs){expect(r.brier).toBeNull();continue;}
        [0,2,3,4,5].forEach((m,k)=>expect(r.brier![m]).toBeCloseTo(old.brier[k],11));
        expect(r.group.mass!.reduce((a,b)=>a+b,0)).toBeCloseTo(1,11);
        for(let m=0;m<10;m++){
          expect(r.group.loss!.reduce((a,b)=>a+b[m],0)).toBeCloseTo(r.brier![m],11);
          expect(r.group.duplicate_loss!.reduce((a,b)=>a+b[m],0)).toBeCloseTo(r.duplicate_brier![m],11);
          expect(r.wins![m]).toBeGreaterThanOrEqual(0);expect(r.wins![m]).toBeLessThanOrEqual(1);
        }
        expect(r.weight_bins!.reduce((a,b)=>a+b,0)).toBeCloseTo(1,11);
        expect(r.weights![1]).toBeGreaterThanOrEqual(0);expect(r.weights![1]).toBeLessThanOrEqual(1);
        expect(r.weights![2]).toBeGreaterThanOrEqual(0);expect(r.weights![2]).toBeLessThanOrEqual(1);
      }
    }
  });
  it("uses method-specific duplicate baselines and retains negative comparisons",()=>{
    const view:RawView=read("views/gap3-coverage50-all.json");
    const r=view.primary.scopes.all;
    expect(rawGain(r,6,"selection")).toBeLessThan(0);
    expect(rawGain(r,6,"duplicate")).toBeGreaterThan(0);
    for(const scope of ["all","complementary"] as const){
      expect(rawDirections(view,scope,7,"selection")).toEqual({positive:10,total:10});
      expect(rawGain(view.primary.scopes[scope],7,"selection")).toBeCloseTo(rawGain(view.primary.scopes[scope],7,"duplicate")!,11);
    }
    expect(rawGain({...r,brier:null} as RawAggregate,7,"selection")).toBeNull();
  });
  it("checks audit, methods, view identity and fetch failure before displaying results",async()=>{
    const key="gap3-coverage50-all",view=read(`views/${key}.json`);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503}));
    await expect(loadRawPooling(key)).rejects.toThrow("503");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>index}).mockResolvedValueOnce({ok:true,json:async()=>view}));
    await expect(loadRawPooling(key)).resolves.toEqual({index,view});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({...index,audit:{status:"SMOKE"}})}).mockResolvedValueOnce({ok:true,json:async()=>view}));
    await expect(loadRawPooling(key)).rejects.toThrow("contract");
  });
});
