import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {EVENT_TYPE_METHODS,loadTypewiseAggregation,loadTypewisePair,TYPEWISE_METHODS,type TypewiseIndex,type TypewiseView} from "../src/lib/typewiseMatchedAggregation";

const read=(path:string)=>JSON.parse(readFileSync(resolve("public/data",path),"utf8"));
const index=read("typewise-matched-aggregation/index.json") as TypewiseIndex;
afterEach(()=>vi.unstubAllGlobals());

describe("event-type matched aggregation publication",()=>{
  it("joins pair scores only when identity, split, support, and both baselines match",async()=>{
    const id="p-b1f8f0fb8e7d",pair=read("aggregation-stability/pairs/b1.json")[id];
    const parentIndex=read("aggregation-stability/index.json"),published=read("typewise-matched-aggregation/pairs/b1.json");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503}));
    await expect(loadTypewisePair(pair,parentIndex)).rejects.toThrow("503");
    for(const corrupt of [
      (d:typeof published)=>d.event_type_methods=[...EVENT_TYPE_METHODS,"bad"],
      (d:typeof published)=>d.primary_fold=1,
      (d:typeof published)=>d.pairs[id].model_a="different configuration",
      (d:typeof published)=>d.pairs[id].scopes.complementary.events++,
      (d:typeof published)=>d.pairs[id].scopes.complementary.brier[0]+=.001,
      (d:typeof published)=>d.pairs[id].scopes.complementary.ece[1]+=.001,
      (d:typeof published)=>d.pairs[id].scopes.complementary.ece[2]=NaN,
      (d:typeof published)=>delete d.pairs[id].event_types[Object.keys(d.pairs[id].event_types)[0]],
      (d:typeof published)=>d.pairs[id].event_types[Object.keys(d.pairs[id].event_types)[0]].brier[3]+=.001,
      (d:typeof published)=>d.pairs[id].event_types[Object.keys(d.pairs[id].event_types)[0]].ece[2]=NaN,
    ]){
      const data=structuredClone(published);corrupt(data);
      vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>data}));
      await expect(loadTypewisePair(pair,parentIndex)).rejects.toThrow(/contract|selected pair|test support|reproduce/);
    }
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>published}));
    await expect(loadTypewisePair(pair,parentIndex)).resolves.toEqual(published.pairs[id]);
    await expect(loadTypewisePair(pair,parentIndex)).resolves.toEqual(published.pairs[id]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("publishes both models and both matched rules on every complementary event type",()=>{
    const id="p-b1f8f0fb8e7d",pair=read("aggregation-stability/pairs/b1.json")[id];
    const published=read("typewise-matched-aggregation/pairs/b1.json");
    expect(published.schema_version).toBe(2);
    expect(published.event_type_methods).toEqual(EVENT_TYPE_METHODS);
    const result=published.pairs[id];
    const complementary=pair.routes.filter((route:{complementary:boolean})=>route.complementary);
    expect(Object.keys(result.event_types).sort()).toEqual(complementary.map((route:{type:string})=>route.type).sort());
    for(const route of complementary){
      const row=result.event_types[route.type];
      expect(row.events).toBe(route.test_events);
      expect(row.brier).toHaveLength(4);expect(row.ece).toHaveLength(4);
      expect(row.brier[0]).toBeCloseTo(route.test_brier_a,12);
      expect(row.brier[1]).toBeCloseTo(route.test_brier_b,12);
    }
  });
  it("reproduces selection and the global coefficient before adding the event-type result",()=>{
    for(const key of index.views){
      const view=read(`typewise-matched-aggregation/views/${key}.json`) as TypewiseView;
      const original=read(`type-selection-no-calibration/views/${key}.json`);
      const stable=read(`aggregation-stability/views/${key}.json`);
      for(let direction=0;direction<10;direction++)for(const scope of ["all","complementary"] as const){
        const main=view.cohorts.all.directions[direction].scopes[scope];
        const parent=original.directions[direction].scopes[scope];
        expect(main.pairs).toBe(parent.pairs);
        main.brier?.slice(0,2).forEach((value,method)=>expect(value).toBeCloseTo(parent.brier[[0,7][method]],12));
        main.ece?.slice(0,2).forEach((value,method)=>expect(value).toBeCloseTo(parent.ece[[0,7][method]],12));
        const retained=view.cohorts.no_reversal.directions[direction].scopes[scope];
        const retainedParent=stable.cohorts.stable.directions[direction].scopes[scope];
        expect(retained.pairs).toBe(retainedParent.pairs);
        retained.brier?.slice(0,2).forEach((value,method)=>expect(value).toBeCloseTo(retainedParent.pools.raw.brier[[0,7][method]],12));
        retained.ece?.slice(0,2).forEach((value,method)=>expect(value).toBeCloseTo(retainedParent.pools.raw.ece[[0,7][method]],12));
      }
    }
  });
  it("improves both metrics over type selection in every default direction",()=>{
    const view=read("typewise-matched-aggregation/views/gap3-coverage50-all.json") as TypewiseView;
    for(const cohort of ["all","no_reversal"] as const)for(const scope of ["all","complementary"] as const){
      for(const direction of view.cohorts[cohort].directions){
        const row=direction.scopes[scope];
        expect(row.brier![0]-row.brier![2]).toBeGreaterThan(0);
        expect(row.ece![0]-row.ece![2]).toBeGreaterThan(0);
      }
    }
  });
  it("validates audit status, methods, cohort partition, and failed requests",async()=>{
    const key="gap3-coverage50-all",view=read(`typewise-matched-aggregation/views/${key}.json`);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503}));
    await expect(loadTypewiseAggregation("failed-view")).rejects.toThrow("503");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>index}).mockResolvedValueOnce({ok:true,json:async()=>view}));
    await expect(loadTypewiseAggregation(key)).resolves.toEqual({index,view});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({...index,methods:[...TYPEWISE_METHODS,"bad"]})}).mockResolvedValueOnce({ok:true,json:async()=>({...view,key:"invalid-view"})}));
    await expect(loadTypewiseAggregation("invalid-view")).rejects.toThrow("contract");
  });
});
