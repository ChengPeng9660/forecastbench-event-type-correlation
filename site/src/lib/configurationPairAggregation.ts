import type { ConfigurationPairIndexEntry, ConfigurationPairManifest, ConfigurationPairShard } from "../types/configurationPairAggregation";

export const CONFIGURATION_PAIR_METHODS = ["simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional", "best_single"] as const;
export const CONFIGURATION_PAIR_METRICS = ["prediction_diversity", "adjusted_pog", "high_loss_lift", "adjusted_loss_corr", "total_variation"] as const;
const IDENTITY_FIELDS = ["exact_configuration", "canonical_model_version", "model_configuration", "provider", "prompt_type", "prompt_label", "information_type", "information_label"] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const identity = (value: unknown) => record(value) && IDENTITY_FIELDS.every((field) => typeof value[field] === "string");
const scores = (value: unknown) => record(value) && ["raw_brier", "adjusted_brier", "brier_index"].every((field) => numeric(value[field]));

function validView(value: unknown): boolean {
  if (value === null) return true;
  if (!record(value) || !count(value.fold_count) || !Array.isArray(value.fold_ids) || value.fold_ids.length !== value.fold_count
    || !["train_target_cells", "test_target_cells", "train_event_cells", "test_event_cells", "min_train_rows", "min_test_rows", "min_train_events", "min_test_events"].every((key) => count(value[key]))
    || typeof value.small_support !== "boolean" || !numeric(value.train_bi_gap) || !record(value.train_diversity)
    || !scores(value.base) || !scores(value.partner) || !scores(value.market) || !record(value.methods)) return false;
  const diversity = value.train_diversity;
  if (!CONFIGURATION_PAIR_METRICS.every((id) => numeric(diversity[id]))) return false;
  if (typeof diversity.total_variation === "number" && (diversity.total_variation < 0 || diversity.total_variation > 1)) return false;
  const methods = value.methods;
  const market = value.market as Record<string, unknown>;
  return CONFIGURATION_PAIR_METHODS.every((id) => {
    const score = methods[id];
    return record(score) && scores(score) && typeof score.beats_market === "boolean"
      && ["gain_vs_base", "gain_vs_partner", "gain_vs_market"].every((field) => numeric(score[field]))
      && (!score.beats_market || (typeof score.brier_index === "number" && typeof market.brier_index === "number" && score.brier_index > market.brier_index));
  });
}

function assetUrl(file: string): string {
  if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.json$/i.test(file)) throw new Error("Invalid configuration-aggregation shard path.");
  return `${import.meta.env.BASE_URL}data/configuration-pair-aggregation/${file}`;
}
async function readJson(file: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(assetUrl(file), { signal });
  if (!response.ok) throw new Error(`Unable to load configuration aggregation (${response.status}).`);
  return response.json();
}
export async function loadConfigurationPairManifest(signal?: AbortSignal): Promise<ConfigurationPairManifest> {
  const payload = await readJson("manifest.json", signal);
  if (!record(payload) || payload.schema_version !== 2 || !Array.isArray(payload.configurations) || !record(payload.methods)
    || !record(payload.metrics) || !record(payload.split) || !record(payload.audit) || !Array.isArray(payload.method_order)
    || !Array.isArray(payload.metric_order) || typeof payload.generated_at !== "string") throw new Error("Invalid configuration-aggregation manifest or unsupported schema.");
  const methods = payload.methods;
  const metrics = payload.metrics;
  if (!CONFIGURATION_PAIR_METHODS.every((id) => record(methods[id]) && typeof methods[id].label === "string")
    || !CONFIGURATION_PAIR_METRICS.every((id) => record(metrics[id]) && typeof metrics[id].label === "string" && typeof metrics[id].axis === "string")
    || payload.method_order.length !== 6 || !CONFIGURATION_PAIR_METHODS.every((id) => (payload.method_order as unknown[]).includes(id))
    || payload.metric_order.length !== 5 || !CONFIGURATION_PAIR_METRICS.every((id) => (payload.metric_order as unknown[]).includes(id))
    || typeof payload.split.repetitions !== "number" || !count(payload.split.repetitions) || payload.split.repetitions < 1
    || typeof payload.split.near_bi_gap !== "number" || !Number.isFinite(payload.split.near_bi_gap)) throw new Error("Incomplete configuration-aggregation metric, method, or split contract.");
  const seen = new Set<string>();
  for (const entry of payload.configurations) {
    if (!record(entry) || !identity(entry) || typeof entry.file !== "string" || !count(entry.eligible_partner_count)) throw new Error("Invalid exact-configuration index.");
    assetUrl(entry.file);
    const exact = entry.exact_configuration as string;
    if (seen.has(exact)) throw new Error("Duplicate exact configuration in the aggregation index.");
    seen.add(exact);
  }
  return payload as unknown as ConfigurationPairManifest;
}
export async function loadConfigurationPairShard(entry: ConfigurationPairIndexEntry, manifest: ConfigurationPairManifest, signal?: AbortSignal): Promise<ConfigurationPairShard> {
  const payload = await readJson(entry.file, signal);
  if (!record(payload) || payload.schema_version !== manifest.schema_version || !record(payload.base) || !identity(payload.base)
    || payload.base_configuration !== entry.exact_configuration || !Array.isArray(payload.partners)) throw new Error("Aggregation data does not match the selected exact configuration.");
  const base = payload.base;
  if (IDENTITY_FIELDS.some((field) => base[field] !== entry[field])) throw new Error("Aggregation base identity does not match the exact index.");
  const catalog = new Map(manifest.configurations.map((item) => [item.exact_configuration, item]));
  const seen = new Set<string>();
  for (const row of payload.partners) {
    if (!record(row) || !record(row.partner) || !identity(row.partner) || !count(row.n_common) || typeof row.status !== "string" || !record(row.views)) throw new Error("Invalid aggregation partner data.");
    const partner = row.partner;
    const exact = partner.exact_configuration as string;
    const expected = catalog.get(exact);
    if (!expected || exact === entry.exact_configuration || seen.has(exact) || IDENTITY_FIELDS.some((field) => partner[field] !== expected[field])) throw new Error("Aggregation partner identity does not match the exact catalog.");
    seen.add(exact);
    const views = row.views;
    if (!["all", "near_bi"].every((sample) => record(views[sample]) && ["combined", "a_to_b", "b_to_a"].every((fold) => validView((views[sample] as Record<string, unknown>)[fold])))) throw new Error("Invalid aggregation fold data.");
  }
  if (seen.size !== manifest.configurations.length - 1) throw new Error("The aggregation shard does not account for every other exact configuration.");
  return payload as unknown as ConfigurationPairShard;
}
