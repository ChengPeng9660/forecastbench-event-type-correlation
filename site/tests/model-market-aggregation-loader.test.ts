import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModelMarketAggregation } from "../src/lib/modelMarketAggregation";
import { modelMarketFixture } from "./fixtures/model-market";

afterEach(() => vi.unstubAllGlobals());

describe("model + market aggregation data contract", () => {
  it("loads the published summary with cancellation and preserves a defined zero TV", async () => {
    const data = modelMarketFixture();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const loaded = await loadModelMarketAggregation(controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/data\/model-market-aggregation\/summary\.json$/), { signal: controller.signal });
    expect(loaded.points[0].views.all.combined?.train_diversity.total_variation).toBe(0);
    expect(loaded.points).toHaveLength(4);
  });

  it("rejects duplicate exact identities rather than collapsing configurations", async () => {
    const data = modelMarketFixture();
    data.points[1].configuration = data.points[0].configuration;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    await expect(loadModelMarketAggregation()).rejects.toThrow(/Duplicate exact configuration/);
  });

  it.each(["wrong market", "wrong win flag", "unsupported schema"])("rejects %s", async (fault) => {
    const data = modelMarketFixture();
    const view = data.points[0].views.all.combined!;
    if (fault === "wrong market") view.market = { ...view.market, brier_index: 99 };
    if (fault === "wrong win flag") view.methods.ec_w0_56.beats_market = false;
    const payload = fault === "unsupported schema" ? { ...data, schema_version: 2 } : data;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    await expect(loadModelMarketAggregation()).rejects.toThrow(/Invalid model \+ market/);
  });

  it("allows explicitly undefined comparison values but never a fabricated win", async () => {
    const data = modelMarketFixture();
    const view = data.points[0].views.all.combined!;
    view.market.brier_index = null;
    view.base.brier_index = null;
    Object.values(view.methods).forEach((score) => { score.beats_market = false; });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data)))));
    await expect(loadModelMarketAggregation()).resolves.toEqual(data);
    view.methods.ec_w0_56.beats_market = true;
    await expect(loadModelMarketAggregation()).rejects.toThrow(/matched-market comparison/);
  });
});
