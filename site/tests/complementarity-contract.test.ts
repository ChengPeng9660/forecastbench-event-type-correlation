import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { csvForPairs, defaultPair, directionSummaries, eligiblePairs, loadComplementarity, pairGain, score, studySummary } from "../src/lib/complementarity";
import type { ComplementarityData } from "../src/types/complementarity";

const directory = resolve(process.cwd(), "public/data/complementarity");
const data: ComplementarityData = JSON.parse(readFileSync(resolve(directory, "study.json"), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("audited uniform-target complementarity publication", () => {
  it("publishes every primary pair view with the frozen provenance intact", () => {
    expect(data.schema_version).toBe(2);
    expect(data.weighting).toBe("uniform_rows");
    expect(data.ability_thresholds).toEqual([3, 5]);
    expect(data.pairs).toHaveLength(2618);
    expect(new Set(data.pairs.map(pair => `${pair.dimension}:${pair.id}`)).size).toBe(2618);
    expect(data.summaries).toHaveLength(352);
    expect(data.directions).toHaveLength(3520);
    expect(data.sample.scored_models).toBe(94);
    expect(data.sample.genuine_scored_predictions).toBe(421932);
    expect(data.sample.events).toBe(3670);
    expect(data.methods.filter(method => method.kind !== "research")).toHaveLength(6);
    expect(data.audit.event_disjointness).toBe("PASS");
    expect(data.audit.max_absolute_error).toBeLessThan(8e-14);
    const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
    expect(manifest.weighting).toBe("uniform_rows");
    for (const [name, info] of Object.entries(manifest.files) as [string, { sha256: string; bytes: number }][]) {
      const bytes = readFileSync(resolve(directory, name));
      expect(bytes.length, name).toBe(info.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(info.sha256);
    }
  });

  it.each([
    [3, .5, 226, 432], [3, .6, 198, 430], [3, .7, 143, 416], [3, .8, 122, 180],
    [5, .5, 241, 505], [5, .6, 210, 503], [5, .7, 148, 470], [5, .8, 126, 212],
  ] as const)("reproduces gap %s / coverage %s crossing counts", (gap, coverage, topic, source) => {
    expect(eligiblePairs(data, "topic", coverage, "crossing", gap)).toHaveLength(topic);
    expect(eligiblePairs(data, "source", coverage, "crossing", gap)).toHaveLength(source);
  });

  it("reconstructs every published primary mean from pair-level records", () => {
    for (const row of data.summaries) {
      const pairs = eligiblePairs(data, row.dimension, row.coverage, row.cohort, row.ability_gap as 3 | 5);
      expect(pairs.length).toBe(row.n);
      const whole = pairs.map(pair => pairGain(pair, row.method, "single")).filter((value): value is number => value !== null);
      const increments = pairs.map(pair => pairGain(pair, row.method, "global")).filter((value): value is number => value !== null);
      expect(whole).toHaveLength(row.n_defined);
      if (whole.length) expect(whole.reduce((a, b) => a + b, 0) / whole.length).toBeCloseTo(row.mean_gain_vs_test_best_bi!, 10);
      if (increments.length) expect(increments.reduce((a, b) => a + b, 0) / increments.length).toBeCloseTo(row.mean_increment_vs_global_bi!, 10);
    }
  });

  it("uses the requested whole-test result as the first endpoint", () => {
    const topic3 = studySummary(data, "topic", .5, "crossing", 3, "type_shrunk")!;
    expect(topic3.n).toBe(226);
    expect(topic3.mean_gain_vs_test_best_bi).toBeCloseTo(.5087439417450774, 12);
    expect(topic3.beats_both_rate).toBeCloseTo(.9203539823008849, 12);
    expect(topic3.mean_gain_vs_train_selected_bi).toBeCloseTo(.7181724492893071, 12);
    expect(topic3.mean_increment_vs_global_bi).toBeCloseTo(.1615042346399036, 12);
    const interval = data.intervals.find(row => row.ability_gap === 3 && row.coverage === .5 && row.dimension === "topic" && row.cohort === "crossing" && row.target === "type_shrunk_gain_best_bi")!;
    expect(interval.ci_low).toBeCloseTo(.37572894151391534, 12);
    expect(interval.ci_high).toBeCloseTo(.6458159728248547, 12);
  });

  it("keeps the featured pair's whole gain distinct from the category increment", () => {
    const pair = defaultPair(eligiblePairs(data, "topic", .5, "crossing", 3))!;
    expect(pair.id).toBe("44_58");
    expect(pair.train_gap).toBeCloseTo(.5240092207484608, 12);
    expect(pair.train_coverage).toBeCloseTo(.8556280587275693, 12);
    expect(pairGain(pair, "type_shrunk", "single")).toBeCloseTo(.5346437182345861, 12);
    expect(pairGain(pair, "type_shrunk", "global")).toBeCloseTo(.08738295932118723, 12);
    expect(pair.crossing_persists).toBe(true);
  });

  it("shows robust directions and the weaker newly admitted gap ring", () => {
    for (const gap of [3, 5] as const) for (const dimension of ["topic", "source"] as const) {
      const rows = directionSummaries(data, dimension, .5, "crossing", gap, "type_shrunk");
      expect(rows).toHaveLength(10);
      expect(rows.every(row => row.mean_gain_vs_test_best_bi! > 0)).toBe(true);
      expect(rows.every(row => row.mean_increment_vs_global_bi! > 0)).toBe(true);
      const narrow = new Set(eligiblePairs(data, dimension, .5, "crossing", 3).map(pair => pair.id));
      const wide = eligiblePairs(data, dimension, .5, "crossing", 5);
      expect([...narrow].every(id => wide.some(pair => pair.id === id))).toBe(true);
    }
  });

  it("never filters with test skill and never converts missing results to zero", () => {
    const original = eligiblePairs(data, "topic", .5, "crossing", 3);
    const perturbed = { ...data, pairs: data.pairs.map(pair => ({ ...pair, test_gap: 999, test_bi_a: -100, test_bi_b: 100 })) };
    expect(eligiblePairs(perturbed, "topic", .5, "crossing", 3).map(pair => pair.id)).toEqual(original.map(pair => pair.id));
    const missing = { ...data.pairs[0], methods: { ...data.pairs[0].methods, type_shrunk: null } };
    expect(pairGain(missing, "type_shrunk", "single")).toBeNull();
    expect(score(null)).toBe("—");
    expect(score(0)).toBe("0.000");
    expect(csvForPairs([missing], "type_shrunk")).not.toMatch(/NaN|undefined|null/);
  });

  it("rejects failed or incompatible publications and supports retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...data, weighting: "balanced" })))
      .mockResolvedValueOnce(new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadComplementarity()).rejects.toThrow(/503/);
    await expect(loadComplementarity()).rejects.toThrow(/expected audited study/);
    await expect(loadComplementarity()).resolves.toHaveProperty("pairs.length", 2618);
  });
});
