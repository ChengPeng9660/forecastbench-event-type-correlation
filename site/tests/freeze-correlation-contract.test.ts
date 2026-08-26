import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FreezeMarketCorrelationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "freeze-exposed-correlation.json"), "utf8"),
) as FreezeMarketCorrelationData;

describe("with-freeze model/market correlation contract", () => {
  it("publishes only explicit with-freeze canonical configurations", () => {
    expect(payload.audit.model_count).toBe(27);
    expect(payload.audit.model_event_cells).toBe(9_323);
    expect(payload.audit.all_configs_explicitly_with_freeze).toBe(true);
    expect(payload.points).toHaveLength(27);
    expect(new Set(payload.points.map((point) => point.model)).size).toBe(27);
    expect(payload.points.every((point) => point.exact_configuration.toLowerCase().includes("with freeze values"))).toBe(true);
    expect(payload.provenance.market_probability).toContain("freeze_datetime_value");
    expect(payload.provenance.imputation_policy).toContain("exclude");
  });

  it("reproduces every published support-weighted summary", () => {
    const support = payload.points.reduce((sum, point) => sum + point.n_common, 0);
    const weighted = (field: "prediction_pearson" | "exact_copy_share" | "mean_absolute_difference") => (
      payload.points.reduce((sum, point) => sum + point[field] * point.n_common, 0) / support
    );
    expect(support).toBe(payload.audit.model_event_cells);
    expect(weighted("prediction_pearson")).toBeCloseTo(payload.audit.support_weighted_prediction_pearson, 12);
    expect(weighted("exact_copy_share")).toBeCloseTo(payload.audit.support_weighted_exact_copy_share, 12);
    expect(weighted("mean_absolute_difference")).toBeCloseTo(payload.audit.support_weighted_mean_absolute_difference, 12);
  });

  it("keeps correlation, probability-distance, support, and BI fields in valid ranges", () => {
    for (const point of payload.points) {
      expect(point.n_common).toBeGreaterThan(1);
      expect(point.prediction_pearson).toBeGreaterThanOrEqual(-1);
      expect(point.prediction_pearson).toBeLessThanOrEqual(1);
      expect(point.exact_copy_share).toBeGreaterThanOrEqual(0);
      expect(point.exact_copy_share).toBeLessThanOrEqual(1);
      expect(point.mean_absolute_difference).toBeGreaterThanOrEqual(0);
      expect(point.root_mean_squared_difference).toBeGreaterThanOrEqual(point.mean_absolute_difference);
      expect(Number.isFinite(point.market_brier_index)).toBe(true);
      expect(Number.isFinite(point.model_brier_index)).toBe(true);
      expect(Number.isFinite(point.model_gain_vs_market)).toBe(true);
    }
    expect(payload.audit.correlation_minimum).toBe(Math.min(...payload.points.map((point) => point.prediction_pearson)));
    expect(payload.audit.correlation_maximum).toBe(Math.max(...payload.points.map((point) => point.prediction_pearson)));
  });
});
