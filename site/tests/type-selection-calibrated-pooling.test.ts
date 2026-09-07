import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {calibratedGain,calibrationGain,calibratedDirections,loadCalibratedPooling,type CalIndex,type CalView} from "../src/lib/typeSelectionCalibratedPooling";
const root="public/data/type-selection-calibrated-pooling";
const read=(file:string)=>JSON.parse(readFileSync(resolve(root,file),"utf8"));
const index:CalIndex=read("index.json");
afterEach(()=>vi.unstubAllGlobals());

describe("input and output calibrated pooling",()=>{
  it("retains raw supports and scores in every direction, scope and filter",()=>{
    for(const key of index.views){
      const view:CalView=read(`views/${key}.json`);
      const raw=JSON.parse(readFileSync(resolve(`public/data/type-selection-no-calibration/views/${key}.json`),"utf8"));
      const mechanism=JSON.parse(readFileSync(resolve(`public/data/type-selection-mechanisms/views/${key}.json`),"utf8"));
      for(let d=0;d<10;d++)for(const stage of ["input","output"] as const)for(const scope of ["all","complementary"] as const){
        const r=view.directions[d].stages[stage][scope],parent=raw.directions[d].scopes[scope];
        expect(r.pairs).toBe(parent.pairs);
        if(!r.pairs){expect(r.brier).toBeNull();continue;}
        expect(r.raw_brier).toEqual(parent.brier);expect(r.raw_ece).toEqual(parent.ece);
        if(stage==="output")expect(r.brier![0]).toBeCloseTo(mechanism.directions[d].scopes[scope].brier[5],8);
        for(let m=0;m<10;m++){
          expect(r.group.loss!.reduce((sum,g)=>sum+g[m],0)).toBeCloseTo(r.brier![m],10);
          expect(r.group.duplicate_loss!.reduce((sum,g)=>sum+g[m],0)).toBeCloseTo(r.duplicate_brier![m],10);
          expect(calibrationGain(r,m)).toBeCloseTo(r.raw_brier![m]-r.brier![m],12);
          expect(calibratedGain(r,m,"selection")).toBeCloseTo(r.brier![0]-r.brier![m],12);
          expect(calibratedGain(r,m,"duplicate")).toBeCloseTo(r.duplicate_brier![m]-r.brier![m],12);
          expect(r.ece![m]).toBeGreaterThanOrEqual(0);expect(r.ece![m]).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it("uses the stage-specific baseline and counts only defined directions",()=>{
    const view:CalView=read("views/gap3-coverage50-all.json");
    expect(view.primary.stages.input.all.brier![0]).not.toBeCloseTo(view.primary.stages.output.all.brier![0],6);
    for(const stage of ["input","output"] as const){
      expect(calibratedGain(view.primary.stages[stage].all,0,"selection")).toBe(0);
      expect(calibratedDirections(view,stage,"all",0,"selection")).toEqual({positive:0,total:10});
    }
  });
  it("rejects failed, smoke, missing-stage and mismatched-view responses",async()=>{
    const key="gap3-coverage50-all",view=read(`views/${key}.json`);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503}));
    await expect(loadCalibratedPooling(key)).rejects.toThrow("503");
    const mock=(i:unknown,v:unknown)=>vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>i}).mockResolvedValueOnce({ok:true,json:async()=>v}));
    mock(index,view);await expect(loadCalibratedPooling(key)).resolves.toEqual({index,view});
    mock({...index,audit:{status:"SMOKE"}},view);await expect(loadCalibratedPooling(key)).rejects.toThrow("contract");
    mock(index,{...view,primary:{...view.primary,stages:{input:view.primary.stages.input}}});await expect(loadCalibratedPooling(key)).rejects.toThrow("contract");
    mock(index,{...view,key:"wrong"});await expect(loadCalibratedPooling(key)).rejects.toThrow("contract");
  });
});
