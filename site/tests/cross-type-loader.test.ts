import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCrossTypeData } from "../src/lib/data";

const manifest = {
  schema_version: "1.0.0",
  generated_at: "2026-08-19T00:00:00Z",
  topics: [],
  metrics: [],
  samples: [],
  thresholds: { reporting_min_defined_pairs: 30, headline_min_defined_pairs: 100, quartile: 0.25 },
  summary_json: "cross-type/summary.json",
  summary_csv: "cross-type/summary.csv",
  pair_details_gzip: "cross-type/pair-details.csv.gz",
  audit_json: "cross-type/audit.json",
};

const summary = {
  schema_version: "1.0.0",
  topic_ids: [],
  metric_ids: [],
  sample_ids: [],
  thresholds: { reporting_min_defined_pairs: 30, headline_min_defined_pairs: 100 },
  cells: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("cross-type data loader", () => {
  it("treats an unpublished optional release as unavailable without inventing data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(loadCrossTypeData()).resolves.toBeNull();
  });

  it("loads the manifest-directed summary and enforces one schema version", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(summary), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadCrossTypeData()).resolves.toEqual({ manifest, summary });
    expect(String(fetchMock.mock.calls[1][0])).toContain("data/cross-type/summary.json");
  });

  it("rejects a manifest-summary schema mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...summary, schema_version: "2.0.0" }), { status: 200 })));
    await expect(loadCrossTypeData()).rejects.toThrow("Cross-type schema mismatch");
  });
});
