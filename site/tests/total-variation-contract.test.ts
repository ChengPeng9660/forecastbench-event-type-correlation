// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const read = (path: string) => JSON.parse(readFileSync(join(dataRoot, path), "utf8"));

function expectTv(value: unknown) {
  expect(value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
}

describe("total variation publication contract", () => {
  it.each([
    "pair-aggregation/all-six-family-pairs.json",
    "polymarket-aggregation/freeze-baseline.json",
  ])("keeps raw TV as the diversity orientation in every %s view", (path) => {
    const payload = read(path);
    const views = [payload.points, payload.cross_fit.eligible_points, payload.cross_fit.near_bi_points,
      ...Object.values(payload.cross_fit.directional_points).flatMap((value) => {
        const direction = value as { eligible_points: unknown[]; near_bi_points: unknown[] };
        return [direction.eligible_points, direction.near_bi_points];
      })];
    for (const points of views) for (const point of points) {
      const metric = point.metrics.total_variation;
      expect(metric).toBeDefined();
      expectTv(metric.raw);
      expect(metric.complementarity).toBe(metric.raw);
    }
  });

  it("publishes the outcome-free TV field for the focal scatter", () => {
    const payload = read("focal-gain/gpt-4-1-2025-04-14.json");
    for (const point of payload.points) {
      expectTv(point.metrics.total_variation.raw);
      expect(point.metrics.total_variation.complementarity).toBe(point.metrics.total_variation.raw);
    }
  });

  it.each([
    "polymarket-aggregation/freeze-exposed-correlation.json",
    "polymarket-aggregation/without-freeze-base.json",
    "pair-aggregation/fixed-focal-without-freeze.json",
  ])("publishes train TV for Combined, A→B and B→A in %s", (path) => {
    const payload = read(path);
    const metadata = payload.aggregation ?? payload.evaluation;
    expect(metadata.diversity_metrics.total_variation.label).toBe("Total variation (TV)");
    for (const point of payload.points) {
      for (const view of [point.combined ?? point, point.directions.a_to_b, point.directions.b_to_a]) {
        expectTv(view.train_diversity.total_variation);
      }
    }
  });

  it("retains prediction correlation diversity alongside TV in all market configurations", () => {
    const payload = read("polymarket-aggregation/market-diversity-performance.json");
    expect(Object.keys(payload.metrics)).toEqual(expect.arrayContaining([
      "prediction_diversity", "adjusted_pog", "high_loss_lift", "adjusted_loss_corr", "total_variation",
    ]));
    expect(payload.metrics.total_variation.label).toBe("Total variation (TV)");
    for (const point of payload.points) expectTv(point.diversity.total_variation);
  });

  it("preserves both the independent fixed and cross-fit upper-left blocks with TV", () => {
    const payload = read("pair-aggregation/upper-left-model-pairs.json");
    expect(payload.metrics.total_variation.label).toBe("Total variation (TV)");
    expect(payload.fixed.rows.length).toBeGreaterThan(0);
    expect(payload.crossfit.rows.length).toBeGreaterThan(0);
    for (const row of payload.fixed.rows) expectTv(row.diversity.total_variation);
    for (const row of payload.crossfit.rows) expectTv(row.mean_train_diversity.total_variation);
  });
});
