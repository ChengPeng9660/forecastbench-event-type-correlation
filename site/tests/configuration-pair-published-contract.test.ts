// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadConfigurationPairManifest, loadConfigurationPairShard } from "../src/lib/configurationPairAggregation";

afterEach(() => vi.unstubAllGlobals());

it("parses every published exact-configuration shard with the actual frontend loader", async () => {
  const dataRoot = join(process.cwd(), "public/data");
  // No mock call history or shard cache: release each response before the next file.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const relative = String(input).split("/data/")[1];
    if (!relative) throw new Error("Unexpected public-data request");
    return new Response(readFileSync(join(dataRoot, relative), "utf8"), { status: 200 });
  });
  const overview = JSON.parse(readFileSync(join(dataRoot, "polymarket-aggregation/market-diversity-performance.json"), "utf8")) as { points: Array<{ exact_configuration: string }> };
  const manifest = await loadConfigurationPairManifest();
  expect(manifest.configurations.map((entry) => entry.exact_configuration).sort()).toEqual(overview.points.map((point) => point.exact_configuration).sort());
  let checked = 0;
  let marketComparisons = 0;
  for (const entry of manifest.configurations) {
    const shard = await loadConfigurationPairShard(entry, manifest);
    expect(shard.base_configuration).toBe(entry.exact_configuration);
    expect(shard.partners).toHaveLength(manifest.configurations.length - 1);
    const mismatches: string[] = [];
    for (const row of shard.partners) for (const [sample, directions] of Object.entries(row.views)) for (const [fold, view] of Object.entries(directions)) {
      if (!view) continue;
      for (const [method, score] of Object.entries(view.methods)) {
        const expected = score.brier_index !== null && view.market.brier_index !== null
          && score.brier_index > view.market.brier_index + 1e-12;
        if (score.beats_market !== expected) mismatches.push(`${row.partner.exact_configuration}: ${sample}/${fold}/${method}`);
        marketComparisons += 1;
      }
    }
    expect(mismatches, `pair-matched market wins for ${entry.exact_configuration}`).toEqual([]);
    checked += 1;
  }
  expect(checked).toBe(overview.points.length);
  expect(marketComparisons).toBeGreaterThan(0);
}, 180_000);
