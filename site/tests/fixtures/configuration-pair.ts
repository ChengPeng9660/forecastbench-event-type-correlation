import { CONFIGURATION_PAIR_METHODS, CONFIGURATION_PAIR_METRICS } from "../../src/lib/configurationPairAggregation";
import type { ConfigurationPairIndexEntry, ConfigurationPairManifest, ConfigurationPairShard, ConfigurationPairView } from "../../src/types/configurationPairAggregation";

export const configurations: ConfigurationPairIndexEntry[] = [
  { exact_configuration: "Shared model (zero shot)", canonical_model_version: "Shared model", model_configuration: "zero shot", provider: "OpenAI", prompt_type: "zero_shot", prompt_label: "Zero shot", information_type: "none", information_label: "No extra information", file: "a.json", eligible_partner_count: 2 },
  { exact_configuration: "Shared model (zero shot with freeze values)", canonical_model_version: "Shared model", model_configuration: "zero shot with freeze values", provider: "OpenAI", prompt_type: "zero_shot", prompt_label: "Zero shot", information_type: "freeze_values", information_label: "Freeze values", file: "b.json", eligible_partner_count: 2 },
  { exact_configuration: "Other model (scratchpad with news)", canonical_model_version: "Other model", model_configuration: "scratchpad with news", provider: "Z.ai", prompt_type: "scratchpad", prompt_label: "Scratchpad", information_type: "news", information_label: "News", file: "c.json", eligible_partner_count: 2 },
  { exact_configuration: "Isolated model (zero shot)", canonical_model_version: "Isolated model", model_configuration: "zero shot", provider: "Meta", prompt_type: "zero_shot", prompt_label: "Zero shot", information_type: "none", information_label: "No extra information", file: "d.json", eligible_partner_count: 0 },
];
const metricLabels = ["Prediction diversity", "Adjusted POG", "High-loss diversity", "Adjusted-loss diversity", "Total variation (TV)"];
export const manifest: ConfigurationPairManifest = {
  schema_version: 1, generated_at: "2026-08-30T00:00:00Z",
  method_order: [...CONFIGURATION_PAIR_METHODS], metric_order: [...CONFIGURATION_PAIR_METRICS],
  methods: Object.fromEntries(CONFIGURATION_PAIR_METHODS.map((id) => [id, { label: id }])) as ConfigurationPairManifest["methods"],
  metrics: Object.fromEntries(CONFIGURATION_PAIR_METRICS.map((id, index) => [id, { label: metricLabels[index], axis: metricLabels[index] }])) as ConfigurationPairManifest["metrics"],
  split: { repetitions: 10, seeds: Array.from({ length: 10 }, (_, i) => 20260825 + i), minimum_fold_overlap: 1, near_bi_gap: 2 },
  configurations, audit: {},
};

export function view(overrides: Partial<ConfigurationPairView> = {}): ConfigurationPairView {
  return {
    fold_count: 20, fold_ids: Array.from({ length: 20 }, (_, i) => String(i)), train_target_cells: 1500, test_target_cells: 1500,
    min_train_rows: 70, min_test_rows: 70, small_support: false, train_bi_gap: 1,
    train_diversity: { prediction_diversity: .1, adjusted_pog: .2, high_loss_lift: -.3, adjusted_loss_corr: -.4, total_variation: 0 },
    base: { raw_brier: .2, adjusted_brier: .2, brier_index: 70 }, partner: { raw_brier: .21, adjusted_brier: .21, brier_index: 69 }, market: { raw_brier: .22, adjusted_brier: .22, brier_index: 68 },
    methods: Object.fromEntries(CONFIGURATION_PAIR_METHODS.map((id) => [id, { raw_brier: .15, adjusted_brier: .15, brier_index: 80, gain_vs_base: .25, gain_vs_partner: .28, gain_vs_market: .3, beats_market: true }])) as ConfigurationPairView["methods"],
    ...overrides,
  };
}

export function shard(baseIndex = 0): ConfigurationPairShard {
  const base = configurations[baseIndex];
  return {
    schema_version: 1, base_configuration: base.exact_configuration, base,
    partners: configurations.filter((item) => item !== base).map((partner) => {
      const unavailable = baseIndex === 3 || partner === configurations[3];
      const small = partner === configurations[2];
      const combined = view(small ? { min_train_rows: 12, min_test_rows: 13, small_support: true, train_diversity: { ...view().train_diversity, total_variation: .2 } } : {});
      const directional = view({ ...combined, fold_count: 10, fold_ids: Array.from({ length: 10 }, (_, i) => String(i)) });
      const near = view({ fold_count: 3, fold_ids: ["0", "1", "2"], train_diversity: { ...view().train_diversity, total_variation: .75 } });
      return {
        partner, n_common: unavailable ? 0 : 150, status: unavailable ? "zero_common_support" : "eligible",
        ...(unavailable ? { reason: "No shared forecast targets" } : {}),
        views: {
          all: { combined: unavailable ? null : combined, a_to_b: unavailable ? null : directional, b_to_a: unavailable ? null : directional },
          near_bi: { combined: unavailable || small ? null : near, a_to_b: null, b_to_a: unavailable || small ? null : near },
        },
      };
    }),
  };
}

export function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const path = String(input);
  const value = path.endsWith("manifest.json") ? manifest : shard(configurations.findIndex((item) => path.endsWith(item.file)));
  return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
}
