import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigurationPairManifest, loadConfigurationPairShard } from "../src/lib/configurationPairAggregation";
import { configurations, fixtureFetch, manifest, shard } from "./fixtures/configuration-pair";

afterEach(() => vi.unstubAllGlobals());

describe("exact-configuration lazy loader", () => {
  it("loads only the manifest-directed shard and forwards the abort signal", async () => {
    const fetchMock = vi.fn(fixtureFetch);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const index = await loadConfigurationPairManifest(controller.signal);
    const data = await loadConfigurationPairShard(index.configurations[0], index, controller.signal);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([expect.stringMatching(/\/data\/configuration-pair-aggregation\/manifest\.json$/), expect.stringMatching(/\/data\/configuration-pair-aggregation\/a\.json$/)]);
    expect((fetchMock.mock.calls as unknown[][])[1][1]).toEqual({ signal: controller.signal });
    expect(data.partners[0].views.all.combined?.train_diversity.total_variation).toBe(0);
    expect(data.partners).toHaveLength(configurations.length - 1);
  });

  it("rejects unsupported schemas and unsafe shard paths", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...manifest, schema_version: 1 }))));
    await expect(loadConfigurationPairManifest()).rejects.toThrow(/unsupported schema/);
    await expect(loadConfigurationPairShard({ ...configurations[0], file: "../other.json" }, manifest)).rejects.toThrow(/Invalid.*path/);
  });

  it("rejects a similarly named but different exact base", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(shard(1)))));
    await expect(loadConfigurationPairShard(configurations[0], manifest)).rejects.toThrow(/selected exact configuration/);
  });

  it("requires all other exact configurations to have a result or explicit status", async () => {
    const missing = shard();
    missing.partners.pop();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(missing))));
    await expect(loadConfigurationPairShard(configurations[0], manifest)).rejects.toThrow(/every other exact configuration/);
  });

  it("permits undefined BI without manufacturing a market win", async () => {
    const data = shard();
    const view = data.partners[0].views.all.combined!;
    view.market.brier_index = null;
    for (const score of Object.values(view.methods)) { score.brier_index = null; score.beats_market = false; score.gain_vs_market = null; }
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data)))));
    await expect(loadConfigurationPairShard(configurations[0], manifest)).resolves.toEqual(data);
    view.methods.simple_mean.beats_market = true;
    await expect(loadConfigurationPairShard(configurations[0], manifest)).rejects.toThrow(/Invalid aggregation fold data/);
  });
});
