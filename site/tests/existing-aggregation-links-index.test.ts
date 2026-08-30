// @vitest-environment node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAggregationLinks, buildPublishedAggregationLinks } from "../scripts/build-aggregation-links.mjs";

const outputPath = fileURLToPath(new URL("../src/data/existingAggregationLinks.json", import.meta.url));
const scriptPath = fileURLToPath(new URL("../scripts/build-aggregation-links.mjs", import.meta.url));

describe("existing exact-configuration aggregation links", () => {
  it("is byte-current with the published source artifacts", () => {
    const expected = `${JSON.stringify(buildPublishedAggregationLinks(), null, 2)}\n`;
    expect(readFileSync(outputPath, "utf8")).toBe(expected);
    expect(execFileSync(process.execPath, [scriptPath, "--check"], { encoding: "utf8" })).toContain("are current");
  });

  it("routes the actual Grok freeze configuration only to existing four-method results", () => {
    const { entries } = buildPublishedAggregationLinks();
    const name = "Grok-4-0709 (zero shot with freeze values)";
    expect(entries[name].map((link) => link.params.upper_left_view)).toEqual(["crossfit", "fixed"]);
    for (const link of entries[name]) {
      expect(link.page).toBe("upper-left-pairs");
      expect(link.params.upper_left_base).toBe(name);
      expect(link.scope).toBe("polymarket_only");
      expect(link.methods).toEqual(["simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds"]);
    }
    expect(entries["Grok-4-0709 (zero shot)"]).toBeUndefined();
  });

  it("explicitly opens all published cross-fit directions without changing fixed/default links", () => {
    const links = Object.values(buildPublishedAggregationLinks().entries).flat();
    for (const link of links) {
      if (link.page === "upper-left-pairs" && link.params.upper_left_view === "crossfit") {
        expect(link.params.upper_left_min_directions).toBe("1");
      } else {
        expect(link.params).not.toHaveProperty("upper_left_min_directions");
      }
    }
  });

  it("recovers only audited exact prompts and preserves an explicitly blank configuration", () => {
    const { entries } = buildPublishedAggregationLinks();
    expect(entries["GPT-4o-2024-11-20 (zero shot with web search)"]).toEqual([
      expect.objectContaining({ page: "fixed-focal-no-freeze", params: { nofreeze_base: "GPT-4o-2024-11-20" }, scope: "all_events" }),
    ]);
    expect(entries["GPT-4o-2024-11-20 (zero shot)"]).toBeUndefined();
    expect(entries["claude-3-5-haiku-20241022"]).toEqual([
      expect.objectContaining({ params: { nofreeze_base: "claude-3-5-haiku-20241022" } }),
    ]);
    expect(entries["claude-3-5-haiku-20241022 (zero shot)"]).toBeUndefined();
  });

  it("does not infer a link from model catalogs, ambiguous configurations, or aliases", () => {
    const overview = { points: ["Exact (zero shot)", "Ambiguous (zero shot)", "Alias (zero shot)", "Catalog only"].map((exact_configuration) => ({ exact_configuration })) };
    const upper = { methods: [{ id: "simple_mean" }], fixed: { models: [{ name: "Catalog only" }], rows: [] }, crossfit: { models: [], rows: [] } };
    const point = (base_model: string) => ({ base_model, combined: { test_target_cells: 10, aggregation: { simple_mean: {} } } });
    const fixed = { evaluation: { methods: { simple_mean: {} } }, audit: { model_configurations: {
      Exact: ["zero shot"], Ambiguous: ["zero shot", "scratchpad"], Canonical: ["zero shot"], "Catalog only": [""],
    } }, points: [point("Exact"), point("Ambiguous"), point("Canonical")] };
    const result = buildAggregationLinks(overview, upper, fixed);
    expect(Object.keys(result.entries)).toEqual(["Exact (zero shot)"]);
  });

  it("indexes rows on either pair side and labels full-sample results distinctly", () => {
    const overview = { points: [{ exact_configuration: "Right" }] };
    const upper = { methods: [{ id: "simple_mean" }], fixed: { rows: [{ model_a: "Left", model_b: "Right", n_pair: 4, method: "simple_mean" }] }, crossfit: { rows: [] } };
    const fixed = { evaluation: { methods: {} }, audit: { model_configurations: {} }, points: [] };
    expect(buildAggregationLinks(overview, upper, fixed).entries.Right).toEqual([
      expect.objectContaining({ evaluation: "full_sample", params: { upper_left_base: "Right", upper_left_view: "fixed" } }),
    ]);
  });
});
