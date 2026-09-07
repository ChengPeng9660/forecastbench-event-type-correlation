import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brierGain, groupRows, loadMechanisms, mechanismKey, positiveDirections,
  type MechanismIndex, type MechanismView } from "../src/lib/typeSelectionMechanisms";

const root = "public/data/type-selection-mechanisms/";
const index: MechanismIndex = JSON.parse(readFileSync(resolve(root, "index.json"), "utf8"));
const readView = (key: string): MechanismView => JSON.parse(readFileSync(resolve(root, `views/${key}.json`), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("exploratory type-selection mechanism diagnostics", () => {
  it("preserves original routing scores and additive contributions in all directions and filters", () => {
    const parent = JSON.parse(readFileSync(resolve("public/data/type-selection/overview.json"), "utf8"));
    for (const key of index.views) {
      const view = readView(key);
      expect(view.key).toBe(mechanismKey(view.gap,view.coverage,view.pair_scope));
      expect(view.directions).toHaveLength(10);
      for (const direction of view.directions) {
        const original = parent.summaries.find((r: {ability_gap:number; coverage:number; pair_scope:string; split:number; fold:number}) => r.ability_gap===view.gap && r.coverage===view.coverage && r.pair_scope===view.pair_scope && r.split===direction.split && r.fold===direction.fold);
        for (const scope of ["complementary","all"] as const) {
          const r = direction.scopes[scope];
          expect(r.pairs).toBe(original.scopes[scope].defined_pairs);
          if (!r.pairs) { expect(r.brier).toBeNull(); continue; }
          for (let method=0; method<5; method++) expect(r.brier![method]).toBeCloseTo(original.scopes[scope].scores.brier[method],11);
          for (const group of r.groups) {
            expect(group.mass!.reduce((a,b)=>a+b,0)).toBeCloseTo(1,11);
            for (let method=0; method<10; method++) expect(group.loss!.reduce((a,b)=>a+b[method],0)).toBeCloseTo(r.brier![method],11);
            const rows = groupRows(group,0,4);
            expect(rows.reduce((a,b)=>a+b.gain!,0)).toBeCloseTo(brierGain(r.brier,0,4)!,11);
          }
        }
      }
    }
  });
  it("keeps sparse matching coverage explicit and direction counts bounded", () => {
    const view = readView("gap3-coverage50-all");
    for (const scope of ["complementary","all"] as const) {
      const r=view.primary.scopes[scope], stability=positiveDirections(view,scope,6,7);
      expect(r.pairs).toBe(2431);
      expect(r.matching.pairs).toBeLessThanOrEqual(r.pairs);
      expect(r.matching.cells).toBeGreaterThanOrEqual(r.matching.pairs);
      expect(stability.total).toBe(10);
      expect(stability.positive).toBeGreaterThanOrEqual(0);
      expect(stability.positive).toBeLessThanOrEqual(10);
    }
  });
  it("does not invent scores for empty groups or reverse improvement signs", () => {
    expect(brierGain([.2,.1],0,1)).toBeCloseTo(.1);
    expect(brierGain(null,0,1)).toBeNull();
    const rows = groupRows({mass:[0,1,0,0],loss:[[0,0],[.2,.1],[0,0],[0,0]],probability:[[0,0],[.8,.9],[0,0],[0,0]],outcome:[0,1,0,0]},0,1);
    expect(rows[0].conditionalGain).toBeNull();
    expect(rows[1].gain).toBeCloseTo(.1);
    expect(rows[1].outcome).toBe(1);
  });
  it("accepts only the audited contract and requested filter view", async () => {
    const key="gap3-coverage50-all", view=readView(key);
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503}));
    await expect(loadMechanisms(key)).rejects.toThrow("503");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>index}).mockResolvedValueOnce({ok:true,json:async()=>view}));
    await expect(loadMechanisms(key)).resolves.toEqual({index,view});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({...index,audit:{status:"RUNNING"}})}).mockResolvedValueOnce({ok:true,json:async()=>view}));
    await expect(loadMechanisms(key)).rejects.toThrow("contract");
  });
});
