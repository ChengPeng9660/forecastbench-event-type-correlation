// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadModelMarketAggregation } from "../src/lib/modelMarketAggregation";

afterEach(() => vi.unstubAllGlobals());

it("loads the real published model-market summary and accounts for every overview exact configuration", async () => {
  const root = join(process.cwd(), "public/data");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const relative = String(input).split("/data/")[1];
    if (relative !== "model-market-aggregation/summary.json") throw new Error("Unexpected model-market data request");
    return new Response(readFileSync(join(root, relative), "utf8"), { status: 200 });
  });
  const overview = JSON.parse(readFileSync(join(root, "polymarket-aggregation/market-diversity-performance.json"), "utf8")) as { points: Array<{ exact_configuration: string }> };
  const data = await loadModelMarketAggregation();
  expect(data.points.map((point) => point.configuration.exact_configuration).sort()).toEqual(overview.points.map((point) => point.exact_configuration).sort());
  expect(data.method_order).toHaveLength(6);
  expect(data.metric_order).toHaveLength(5);
});
