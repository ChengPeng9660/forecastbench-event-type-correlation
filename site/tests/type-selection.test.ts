import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRouting, loadRoutingPair, routingGain, routingSummary, type RoutingArchive, type RoutingPair } from "../src/lib/typeSelection";

const data: RoutingArchive = JSON.parse(readFileSync(resolve("public/data/type-selection/study.json"), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("historical type selection with two nested test scopes", () => {
  it("reconstructs every filtered primary mean from the same eligible pair rows", () => {
    for (const summary of data.summaries.filter(r => r.split === data.primary_split && r.fold === data.primary_fold)) {
      const pairs = data.pairs.filter(pair => pair.train_gap <= summary.ability_gap + 1e-12 && pair.train_coverage >= summary.coverage);
      // Scope flags are retained in the frozen JSON as well as the original pair catalog.
      const scoped = pairs.filter(pair => {
        const flags = pair as typeof pair & { same_model_version: boolean; same_prompt: boolean; same_information: boolean };
        return summary.pair_scope === "all" || (summary.pair_scope === "different_model_version" && !flags.same_model_version)
          || (summary.pair_scope === "matched_conditions" && flags.same_prompt && flags.same_information);
      });
      for (const scope of ["complementary", "all"] as const) {
        const defined = scoped.filter(p => p.scopes[scope].events > 0);
        expect(summary.scopes[scope].pairs).toBe(scoped.length);
        expect(summary.scopes[scope].defined_pairs).toBe(defined.length);
        for (const metric of ["brier", "bi", "ece"] as const) {
          for (let i = 0; i < 8; i++) {
            const values = defined.map(p => p.scopes[scope].scores[metric][i]!);
            const expected = values.reduce((a, b) => a + b, 0) / values.length;
            expect(summary.scopes[scope].scores[metric][i]).toBeCloseTo(expected, 10);
          }
        }
      }
    }
  });
  it("shows the observed difference between targeted and full-test conclusions", () => {
    const main = routingSummary(data, 3, .5, "all")!;
    expect(main.scopes.all.pairs).toBe(2431);
    expect(main.scopes.complementary.mean_event_fraction).toBeCloseTo(.511, 3);
    expect(main.scopes.complementary.scores.brier[0]).toBeCloseTo(.150402, 6);
    expect(main.scopes.all.scores.brier[0]).toBeCloseTo(.157282, 6);
    expect([1, 2, 3, 4].filter(i => routingGain(main.scopes.complementary.scores.brier, i, "brier")! > 0)).toHaveLength(3);
    expect([1, 2, 3, 4].filter(i => routingGain(main.scopes.all.scores.brier, i, "brier")! > 0)).toHaveLength(1);
  });
  it("orients gains by metric and preserves missing scores", () => {
    expect(routingGain([.1, .2], 1, "brier")).toBeCloseTo(.1);
    expect(routingGain([70, 60], 1, "bi")).toBe(10);
    expect(routingGain([.05, .02], 1, "ece")).toBeCloseTo(-.03);
    expect(routingGain([null, .2], 1, "brier")).toBeNull();
  });
  it("publishes every pair in exactly the indexed on-demand shard", async () => {
    for (const shard of new Set(Object.values(data.pair_shards))) {
      const pairs: Record<string, RoutingPair> = JSON.parse(readFileSync(resolve(`public/data/type-selection/pairs/${shard}.json`), "utf8"));
      for (const pair of Object.values(pairs)) {
        expect(data.pair_shards[pair.id]).toBe(shard);
        expect(pair).toEqual(data.pairs.find(value => value.id === pair.id));
      }
    }
    await expect(loadRoutingPair(data, "missing-pair")).resolves.toBeNull();
  });
  it("rejects unavailable or unverified results and accepts the audited contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(loadRouting()).rejects.toThrow("503");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...data, audit: { status: "RUNNING" } }) }));
    await expect(loadRouting()).rejects.toThrow("contract");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    await expect(loadRouting()).resolves.toBe(data);
  });
});
