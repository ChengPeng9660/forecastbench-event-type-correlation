import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../public/data/manifest.json";
import models from "../public/data/models.json";
import type { EventTypeData } from "../src/types/data";
import type {
  CrossTypeManifest,
  CrossTypeSummary,
  GlobalBaselineManifest,
  GlobalBaselineSummary,
  GlobalPartnerProfiles,
} from "../src/types/data";

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

const crossTypeManifestPath = join(dataRoot, "cross-type", "manifest.json");
const crossTypePublished = existsSync(crossTypeManifestPath);

describe("cross-event-type stability contract", () => {
  it("never ships a partial cross-type release", () => {
    if (!crossTypePublished) {
      expect(existsSync(join(dataRoot, "cross-type", "summary.json"))).toBe(false);
      return;
    }
    const crossManifest = JSON.parse(readFileSync(crossTypeManifestPath, "utf8")) as CrossTypeManifest;
    for (const path of [crossManifest.summary_json, crossManifest.summary_csv, crossManifest.pair_details_gzip, crossManifest.audit_json]) {
      expect(existsSync(join(dataRoot, path))).toBe(true);
    }
  });

  it.skipIf(!crossTypePublished)("keeps the 7-topic, 3-metric, 2-sample stability matrix auditable", () => {
    const crossManifest = JSON.parse(readFileSync(crossTypeManifestPath, "utf8")) as CrossTypeManifest;
    const summary = JSON.parse(readFileSync(join(dataRoot, crossManifest.summary_json), "utf8")) as CrossTypeSummary;
    const topicIds = crossManifest.topics.map((topic) => topic.id);
    const metricIds = crossManifest.metrics.map((metric) => metric.id);
    const sampleIds = crossManifest.samples.map((sample) => sample.id);

    expect(crossManifest.schema_version).toBe(summary.schema_version);
    expect(topicIds).toHaveLength(7);
    expect(new Set(topicIds).size).toBe(7);
    expect(metricIds).toHaveLength(3);
    expect(sampleIds).toHaveLength(2);
    expect(crossManifest.samples.filter((sample) => sample.primary)).toHaveLength(1);
    expect(summary.topic_ids).toEqual(topicIds);
    expect(summary.metric_ids).toEqual(metricIds);
    expect(summary.sample_ids).toEqual(sampleIds);
    expect(summary.cells).toHaveLength(21 * metricIds.length * sampleIds.length);

    const seen = new Set<string>();
    for (const cell of summary.cells) {
      expect(topicIds).toContain(cell.topic_a);
      expect(topicIds).toContain(cell.topic_b);
      expect(cell.topic_a).not.toBe(cell.topic_b);
      expect(metricIds).toContain(cell.metric_id);
      expect(sampleIds).toContain(cell.sample_id);
      const unordered = [cell.topic_a, cell.topic_b].sort().join("::");
      const key = `${unordered}::${cell.metric_id}::${cell.sample_id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);

      expect(cell.n_defined_pairs).toBeLessThanOrEqual(cell.n_sample_pairs);
      expect(cell.n_sample_pairs).toBeLessThanOrEqual(cell.n_pair_universe);
      for (const correlation of [cell.spearman, cell.pearson]) {
        expect(correlation === null || (correlation >= -1 && correlation <= 1)).toBe(true);
      }
      for (const rate of [
        cell.dependent_top_jaccard,
        cell.complementary_top_jaccard,
        cell.dependency_persistence_a_to_b,
        cell.dependency_persistence_b_to_a,
        cell.complementarity_persistence_a_to_b,
        cell.complementarity_persistence_b_to_a,
        cell.dependency_to_complementarity_a_to_b,
        cell.dependency_to_complementarity_b_to_a,
      ]) {
        expect(rate === null || (rate >= 0 && rate <= 1)).toBe(true);
      }

      if (cell.interpretation_status === "insufficient") {
        expect(cell.n_defined_pairs).toBeLessThan(crossManifest.thresholds.reporting_min_defined_pairs);
        expect(cell.spearman).toBeNull();
        expect(cell.pearson).toBeNull();
        expect(cell.reason).toBeTruthy();
      } else if (cell.interpretation_status === "limited") {
        expect(cell.n_defined_pairs).toBeGreaterThanOrEqual(crossManifest.thresholds.reporting_min_defined_pairs);
        expect(cell.n_defined_pairs).toBeLessThan(crossManifest.thresholds.headline_min_defined_pairs);
      } else {
        expect(cell.n_defined_pairs).toBeGreaterThanOrEqual(crossManifest.thresholds.headline_min_defined_pairs);
      }
    }
  });
});

const globalManifestPath = join(dataRoot, "global-baseline", "manifest.json");
const globalBaselinePublished = existsSync(globalManifestPath);

describe("global-baseline stability contract", () => {
  it("never ships a partial global-baseline release", () => {
    if (!globalBaselinePublished) {
      expect(existsSync(join(dataRoot, "global-baseline", "summary.json"))).toBe(false);
      return;
    }
    const globalManifest = JSON.parse(readFileSync(globalManifestPath, "utf8")) as GlobalBaselineManifest;
    for (const path of [
      globalManifest.summary_json,
      globalManifest.pair_metrics_gzip,
      globalManifest.pair_stability_csv,
      globalManifest.partner_stability_gzip,
      globalManifest.partner_summary_csv,
      globalManifest.model_ability_csv,
      globalManifest.ability_stability_csv,
      globalManifest.audit_json,
    ]) expect(existsSync(join(dataRoot, path))).toBe(true);
    for (const path of Object.values(globalManifest.partner_profile_files)) expect(existsSync(join(dataRoot, path))).toBe(true);
  });

  it.skipIf(!globalBaselinePublished)("keeps global, transfer, partner, and ability outputs aligned", () => {
    const globalManifest = JSON.parse(readFileSync(globalManifestPath, "utf8")) as GlobalBaselineManifest;
    const summary = JSON.parse(readFileSync(join(dataRoot, globalManifest.summary_json), "utf8")) as GlobalBaselineSummary;
    const scopeIds = globalManifest.global_scopes.map((scope) => scope.id);
    const topicIds = globalManifest.topics.map((topic) => topic.id);
    const metricIds = globalManifest.metrics.map((metric) => metric.id);
    const sampleIds = globalManifest.samples.map((sample) => sample.id);
    const comparisonIds = globalManifest.comparison_modes.map((mode) => mode.id);

    expect(globalManifest.schema_version).toBe(summary.schema_version);
    expect(scopeIds).toHaveLength(2);
    expect(topicIds).toHaveLength(7);
    expect(metricIds).toHaveLength(3);
    expect(sampleIds).toHaveLength(2);
    expect(comparisonIds).toEqual(["leave_topic_out", "inclusive_global"]);
    expect(globalManifest.comparison_modes.filter((mode) => mode.primary).map((mode) => mode.id)).toEqual(["leave_topic_out"]);
    expect(summary.global_pair_summary).toHaveLength(scopeIds.length * metricIds.length * sampleIds.length);
    expect(summary.pair_stability).toHaveLength(scopeIds.length * topicIds.length * metricIds.length * sampleIds.length * comparisonIds.length);
    expect(summary.partner_summary).toHaveLength(scopeIds.length * topicIds.length * metricIds.length * sampleIds.length * comparisonIds.length);
    expect(summary.ability_stability).toHaveLength(scopeIds.length * topicIds.length * comparisonIds.length);

    const publishedModelIds = new Set(models.map((model) => model.id));
    const profileEntries = Object.entries(globalManifest.partner_profile_files);
    expect(profileEntries).toHaveLength(263);
    expect(profileEntries.every(([modelId]) => publishedModelIds.has(modelId))).toBe(true);
    const profileRoot = join(dataRoot, "global-baseline", "partner-profiles");
    const expectedProfileFiles = profileEntries.map(([, path]) => path.replace("global-baseline/partner-profiles/", "")).sort();
    expect(readdirSync(profileRoot).filter((file) => file.endsWith(".json")).sort()).toEqual(expectedProfileFiles);
    for (const [modelId, path] of profileEntries) {
      const payload = JSON.parse(readFileSync(join(dataRoot, path), "utf8")) as GlobalPartnerProfiles;
      expect(payload.schema_version).toBe(globalManifest.schema_version);
      expect(payload.focal_model_id).toBe(modelId);
      expect(payload.profiles).toHaveLength(topicIds.length * metricIds.length * sampleIds.length * comparisonIds.length);
      expect(payload.profiles.every((profile) => profile.focal_model_id === modelId)).toBe(true);
    }

    for (const row of summary.pair_stability) {
      expect(scopeIds).toContain(row.global_scope);
      expect(topicIds).toContain(row.topic_id);
      expect(metricIds).toContain(row.metric_id);
      expect(sampleIds).toContain(row.sample_id);
      expect(comparisonIds).toContain(row.comparison_mode);
      expect(row.n_defined_pairs).toBeLessThanOrEqual(row.n_sample_pairs);
      expect(row.n_sample_pairs).toBeLessThanOrEqual(row.n_pair_universe);
      for (const coefficient of [row.spearman, row.pearson]) expect(coefficient === null || (coefficient >= -1 && coefficient <= 1)).toBe(true);
      if (row.interpretation_status === "insufficient") {
        expect(row.spearman).toBeNull();
        expect(row.reason).toBeTruthy();
      }
    }
  });
});
