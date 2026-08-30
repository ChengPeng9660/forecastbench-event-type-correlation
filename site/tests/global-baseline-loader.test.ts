import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeGlobalPairMatrix, loadGlobalBaselineData, loadGlobalPairMatrix, loadGlobalPartnerProfiles } from "../src/lib/data";

const comparisonModes = [
  { id: "leave_topic_out", label: "Leave topic out", description: "Transfer test.", primary: true },
  { id: "inclusive_global", label: "Inclusive global", description: "Sensitivity benchmark.", primary: false },
];

const manifest = {
  schema_version: "1.0.0",
  generated_at: "2026-08-19T00:00:00Z",
  global_scopes: [],
  topics: [],
  metrics: [],
  samples: [],
  comparison_modes: comparisonModes,
  thresholds: { min_overlap: 50, near_bi_gap: .05, high_loss_threshold: .25, min_partners: 20, reporting_min_defined: 30, headline_min_defined: 100, quartile: 0.25 },
  summary_json: "global-baseline/summary.json",
  partner_profile_files: { "model-a": "global-baseline/partner-profiles/model-a.json" },
  pair_metrics_gzip: "global-baseline/pair-metrics.csv.gz",
  pair_stability_csv: "global-baseline/pair-stability.csv",
  partner_stability_gzip: "global-baseline/partner-stability.csv.gz",
  partner_summary_csv: "global-baseline/partner-summary.csv",
  model_ability_csv: "global-baseline/model-ability.csv",
  ability_stability_csv: "global-baseline/ability-stability.csv",
  audit_json: "global-baseline/audit.json",
};

const summary = {
  schema_version: "1.0.0",
  global_scopes: [],
  topic_ids: [],
  metric_ids: [],
  sample_ids: [],
  comparison_modes: comparisonModes,
  thresholds: manifest.thresholds,
  global_pair_summary: [],
  pair_stability: [],
  partner_summary: [],
  ability_stability: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("global-baseline data loader", () => {
  it("treats an unpublished optional release as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(loadGlobalBaselineData()).resolves.toBeNull();
  });

  it("loads only manifest-directed artifacts with one schema version", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(summary), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadGlobalBaselineData()).resolves.toEqual({ manifest, summary });
    expect(String(fetchMock.mock.calls[1][0])).toContain("data/global-baseline/summary.json");
  });

  it("rejects mismatched summary and manifest schemas", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...summary, schema_version: "2.0.0" }), { status: 200 })));
    await expect(loadGlobalBaselineData()).rejects.toThrow("Global-baseline schema mismatch");
  });

  it("loads model-level profiles only when requested", async () => {
    const rows = [{ focal_model_id: "model-a" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ schema_version: "1.0.0", focal_model_id: "model-a", profiles: rows }), { status: 200 })));
    await expect(loadGlobalPartnerProfiles(manifest.partner_profile_files["model-a"], "1.0.0", "model-a")).resolves.toEqual(rows);
  });

  it("decodes a compact global pair matrix exactly once from its field contract", async () => {
    const compact = {
      schema_version: "1.0.0",
      global_scope: "official_full",
      models: [{ id: "model-a", name: "A", organization: "Org" }, { id: "model-b", name: "B", organization: "Org" }],
      fields: ["model_a_id", "model_b_id", "n_overlap", "n_dates", "eligible", "near_bi", "bi_reason", "insufficient_overlap_reason", "adjusted_pog", "pog_reason", "high_loss_lift", "lift_reason", "adjusted_loss_corr", "corr_reason", "total_variation", "tv_reason"],
      pairs: [["model-a", "model-b", 100, 2, true, true, null, null, .1, null, 1.2, null, .3, null, .125, null]],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(compact), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await loadGlobalPairMatrix("global-baseline/pair-matrices/official_full.json", "1.0.0");
    expect(decodeGlobalPairMatrix(loaded)).toEqual([{
      model_a_id: "model-a", model_b_id: "model-b", n_overlap: 100, n_dates: 2,
      eligible: true, near_bi: true, bi_reason: null, insufficient_overlap_reason: null,
      adjusted_pog: .1, pog_reason: null, high_loss_lift: 1.2, lift_reason: null,
      adjusted_loss_corr: .3, corr_reason: null,
      total_variation: .125, tv_reason: null,
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
