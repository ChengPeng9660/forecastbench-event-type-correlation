import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { csvForPairs, defaultPair, eligiblePairs, loadComplementarity, pairGain, score, studyCohort } from "../src/lib/complementarity";
import type { ComplementarityData } from "../src/types/complementarity";

const directory = resolve(process.cwd(), "public/data/complementarity");
const data: ComplementarityData = JSON.parse(readFileSync(resolve(directory, "study.json"), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("audited cross-category study publication", () => {
  it("ships every primary dimension/pair, original method, and traceable file intact", () => {
    expect(data.pairs).toHaveLength(1436);
    expect(new Set(data.pairs.map(p => `${p.dimension}:${p.id}`)).size).toBe(1436);
    expect(data.sample.scored_models).toBe(94);
    expect(data.sample.genuine_scored_predictions).toBe(421932);
    expect(data.sample.events).toBe(3670);
    expect(data.methods.filter(m => m.kind !== "research")).toHaveLength(6);
    const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
    for (const [name, info] of Object.entries(manifest.files) as [string, { sha256: string; bytes: number }][]) {
      const bytes = readFileSync(resolve(directory, name));
      expect(bytes.length, name).toBe(info.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(info.sha256);
    }
  });

  it.each([ [.5, 152, 275], [.6, 115, 275], [.7, 66, 187], [.8, 1, 97] ])("retains the original and sensitivity counts at %s", (coverage, topic, source) => {
    expect(eligiblePairs(data, "topic", coverage, "crossing")).toHaveLength(topic);
    expect(eligiblePairs(data, "source", coverage, "crossing")).toHaveLength(source);
    for (const dim of ["topic", "source"] as const) {
      for (const cohort of ["crossing", "eligible"] as const) {
        const pairs = eligiblePairs(data, dim, coverage, cohort);
        const summary = studyCohort(data, dim, coverage, cohort)!;
        expect(pairs.length).toBe(summary.n);
        const pairedIncrements = pairs.map(p => pairGain(p, "type_shrunk")).filter((v): v is number => v !== null);
        if (pairedIncrements.length) expect(pairedIncrements.reduce((a, b) => a + b, 0) / pairedIncrements.length).toBeCloseTo(summary.type_increment_mean!, 10);
        for (const method of data.methods) {
          const values = pairs.map(p => pairGain(p, method.id, "single")).filter((v): v is number => v !== null);
          expect(values.length).toBe(summary.methods[method.id].n_bi);
          if (values.length) expect(values.reduce((a, b) => a + b, 0) / values.length).toBeCloseTo(summary.methods[method.id].gain_best_bi!, 10);
        }
      }
    }
  });

  it("separates the featured pair's whole gain from the category increment", () => {
    const pair = defaultPair(eligiblePairs(data, "topic", .5, "crossing"))!;
    expect(pair.id).toBe("44_58");
    expect(pair.train_gap).toBeCloseTo(.560703394, 8);
    expect(pair.test_gap).toBeCloseTo(.040050479, 8);
    expect(pairGain(pair, "type_shrunk", "single")).toBeCloseTo(.9236023375, 9);
    expect(pairGain(pair, "type_shrunk")).toBeCloseTo(.06497640755, 9);
    expect(pair.crossing_persists).toBe(true);
    const politics = pair.profiles.find(p => p.group === "politics_conflict")!;
    const finance = pair.profiles.find(p => p.group === "finance_economics")!;
    expect(politics.test_bi_a).toBeGreaterThan(politics.test_bi_b!);
    expect(finance.test_bi_b).toBeGreaterThan(finance.test_bi_a!);
    expect(pairGain(pair, "global_convex")).toBe(0);
  });

  it("does not filter with test skill gaps or test gains and retains failures", () => {
    const original = eligiblePairs(data, "topic", .5, "crossing");
    const perturbed = { ...data, pairs: data.pairs.map(p => ({ ...p, test_gap: 999, test_bi_a: -100, test_bi_b: 100 })) };
    expect(eligiblePairs(perturbed, "topic", .5, "crossing").map(p => p.id)).toEqual(original.map(p => p.id));
    expect(original.some(p => (pairGain(p, "type_shrunk") ?? 0) < 0)).toBe(true);
    const noMatches = data.matched.find(r => r.dimension === "topic" && r.coverage_threshold === .8)!;
    expect(noMatches.triplets).toBe(0);
    expect(noMatches.estimate).toBeNull();
  });

  it("retains negative temporal evidence and undefined values without zero imputation", () => {
    const late = studyCohort(data, "source", .5, "crossing", "novel_temporal_late", 0)!;
    expect(late.methods.type_shrunk.gain_best_bi! - late.methods.global_convex.gain_best_bi!).toBeLessThan(0);
    const p = { ...data.pairs[0], methods: { ...data.pairs[0].methods, type_shrunk: null } };
    expect(pairGain(p, "type_shrunk")).toBeNull();
    expect(score(null)).toBe("—");
    expect(score(0)).toBe("0.000");
    expect(csvForPairs([p], "type_shrunk")).not.toMatch(/NaN|undefined|null/);
  });

  it("rejects a failed or incompatible publication and supports retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...data, schema_version: 99 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadComplementarity()).rejects.toThrow(/503/);
    await expect(loadComplementarity()).rejects.toThrow(/expected audited study/);
    await expect(loadComplementarity()).resolves.toHaveProperty("pairs.length", 1436);
  });
});
