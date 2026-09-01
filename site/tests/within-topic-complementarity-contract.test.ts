import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWithinTopicFocal, loadWithinTopicStudy, WITHIN_TOPIC_METHODS, WITHIN_TOPIC_TOPICS } from "../src/lib/withinTopicComplementarity";
import type { WithinTopicStudy } from "../src/types/withinTopicComplementarity";

const directory = resolve(process.cwd(), "public/data/within-topic-complementarity");
const studyBuffer = readFileSync(resolve(directory, "study.json"));
const study = JSON.parse(studyBuffer.toString()) as WithinTopicStudy;
const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8")) as { files: Record<string, { sha256: string }> };
const focal = "Grok-4-Fast-Reasoning (zero shot with freeze values)";

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

afterEach(() => vi.unstubAllGlobals());

describe("published within-topic complementarity contract", () => {
  it("publishes the audited exact-configuration study and all seven domains", () => {
    expect(study.schema_version).toBe(1);
    expect(study.weighting).toBe("uniform_rows_within_topic");
    expect(study.topics.map(item => item.id)).toEqual([...WITHIN_TOPIC_TOPICS]);
    expect(study.methods.map(item => item.id)).toEqual([...WITHIN_TOPIC_METHODS]);
    expect(study.configurations).toHaveLength(313);
    expect(Object.keys(study.focal_files)).toHaveLength(313);
    expect(study.sample).toMatchObject({ configurations: 313, canonical_model_versions: 96, events: 3670, targets: 26531, split_directions: 10 });
    expect(study.audit).toMatchObject({ status: "PASS", event_disjointness: "PASS", implementation_independent: true, train_only_selection: true, no_test_gap_filter: true });
    expect(study.audit.independent_maximum_absolute_error).toBeLessThan(1e-9);
    expect(study.audit.max_pog_identity_error).toBe(0);
    expect(study.validation.status).toBe("PASS");
  });

  it("preserves reciprocal POG identities and unchanged method outputs in a focal shard", () => {
    const file = study.focal_files[focal];
    const buffer = readFileSync(resolve(directory, file));
    const data = JSON.parse(buffer.toString()) as { focal: string; pairs: Array<Record<string, any>> };
    expect(data.focal).toBe(focal);
    expect(data.pairs.length).toBeGreaterThan(200);
    expect(new Set(data.pairs.map(pair => pair.id)).size).toBe(data.pairs.length);
    for (const pair of data.pairs) {
      expect([pair.model_a, pair.model_b]).toContain(focal);
      expect(pair.train_overall_gap).toBeLessThanOrEqual(5 + 1e-12);
      expect(pair.train_topic_gap).toBeLessThanOrEqual(3 + 1e-12);
      expect(pair.train_topic_events).toBeGreaterThanOrEqual(20);
      expect(pair.train_adjusted_pog).toBeCloseTo(Math.min(pair.train_a_rescue, pair.train_b_rescue), 12);
      expect(pair.train_normalized_pog).toBeCloseTo(pair.train_adjusted_pog / pair.train_mean_raw_loss, 12);
      expect(pair.train_a_win_share + pair.train_b_win_share + pair.train_tie_share).toBeCloseTo(1, 12);
      expect(Object.keys(pair.methods)).toEqual([...WITHIN_TOPIC_METHODS]);
    }
    expect(manifest.files["study.json"].sha256).toBe(sha256(studyBuffer));
    expect(manifest.files[file].sha256).toBe(sha256(buffer));
    for (const name of ["README.md", "PROTOCOL.md", "REPORT.md", "REPRODUCE.md", "LICENSE-DATA.md", "independent_audit.json"]) {
      expect(manifest.files[name]).toBeDefined();
    }
  });

  it("reports the pre-specified all-model ability-control result", () => {
    const result = study.validation.validations.find(row => row.pair_scope === "all" && row.method === "cf_directional" && row.outcome === "topic" && row.metric === "normalized_pog");
    expect(result).toMatchObject({ n: 85113, n_defined: 84626, positive_top_minus_all_directions: 10, defined_directions: 10 });
    expect(result!.top_quartile_mean_gain_bi).toBeCloseTo(.6193573287476681, 12);
    expect(result!.mean_gain_bi).toBeCloseTo(.23199358946538237, 12);
    expect(result!.standardized_pog_beta).toBeGreaterThan(0);
    expect(result!.pog_incremental_r2).toBeGreaterThan(0);
    expect(Math.abs(result!.overall_mean_bi_correlation!)).toBeLessThan(.02);
  });

  it("loads the study and focal shard through the strict public loader", async () => {
    vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request instanceof Request ? request.url : request);
      if (url.endsWith("/data/within-topic-complementarity/study.json")) return new Response(studyBuffer);
      const file = url.match(/\/data\/within-topic-complementarity\/(focals\/\d+\.json)$/)?.[1];
      return file ? new Response(readFileSync(resolve(directory, file))) : new Response("not found", { status: 404 });
    }));
    const loaded = await loadWithinTopicStudy();
    const selected = await loadWithinTopicFocal(loaded, focal);
    expect(selected.focal).toBe(focal);
    expect(selected.pairs.length).toBeGreaterThan(200);
  });
});
