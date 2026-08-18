import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../public/data/manifest.json";
import models from "../public/data/models.json";
import type { EventTypeData } from "../src/types/data";

const dataRoot = resolve(process.cwd(), "public/data");
const slices = manifest.event_types.map((reference) =>
  JSON.parse(readFileSync(join(dataRoot, reference.file), "utf8")) as EventTypeData
);

describe("static data contract", () => {
  it("discovers event slices from the manifest and keeps one schema version", () => {
    expect(slices).toHaveLength(manifest.event_types.length);
    expect(new Set(slices.map((slice) => slice.schema_version))).toEqual(new Set([manifest.schema_version]));
  });

  it("does not retain stale event-slice fixtures outside the manifest", () => {
    const eventTypeRoot = join(dataRoot, "event-types");
    const files = readdirSync(eventTypeRoot).filter((file) => file.endsWith(".json")).sort();
    const referenced = manifest.event_types.map((item) => item.file.replace("event-types/", "")).sort();
    expect(files).toEqual(referenced);
  });

  it("stores each unordered pair exactly once", () => {
    for (const slice of slices) {
      const ids = slice.pairs.map((pair) => [pair.a, pair.b].sort().join("::"));
      expect(new Set(ids).size).toBe(ids.length);
      expect(slice.pairs.every((pair) => pair.a !== pair.b)).toBe(true);
    }
  });

  it("keeps every present metric finite and correlations bounded", () => {
    for (const slice of slices) {
      for (const pair of slice.pairs) {
        const pog = pair.metrics.adjusted_pog.value;
        const lift = pair.metrics.high_loss_lift.value;
        const corr = pair.metrics.adjusted_loss_corr.value;
        expect(pog === null || Number.isFinite(pog)).toBe(true);
        expect(lift === null || lift >= 0).toBe(true);
        expect(corr === null || (corr >= -1 && corr <= 1)).toBe(true);
      }
    }
  }, 120_000);

  it("references declared models and reports missing-value reasons", () => {
    const ids = new Set(models.map((model) => model.id));
    for (const slice of slices) {
      expect(slice.models.every((id) => ids.has(id))).toBe(true);
      expect(slice.pairs.every((pair) => ids.has(pair.a) && ids.has(pair.b))).toBe(true);
      expect(Array.isArray(slice.missing_summary)).toBe(true);
      for (const pair of slice.pairs) {
        for (const metric of Object.values(pair.metrics)) {
          if (metric.value === null) expect(metric.reason).toBeTruthy();
        }
      }
    }
  });
});
