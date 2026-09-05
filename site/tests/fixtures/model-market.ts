import { CONFIGURATION_PAIR_METHODS } from "../../src/lib/configurationPairAggregation";
import type { ConfigurationPairView } from "../../src/types/configurationPairAggregation";
import type { ModelMarketAggregationData } from "../../src/types/modelMarketAggregation";
import { configurations, manifest, view } from "./configuration-pair";

export function modelMarketFixture(): ModelMarketAggregationData {
  return {
    schema_version: 2, generated_at: "2026-09-05T00:00:00Z", scope: "Polymarket market questions only", market_base: "Polymarket Freeze",
    methods: manifest.methods, method_order: manifest.method_order, metrics: manifest.metrics, metric_order: manifest.metric_order,
    split: manifest.split, aggregation: {}, audit: {}, provenance: {},
    points: configurations.map((configuration, index) => {
      const market = { raw_brier: .2, adjusted_brier: .2, brier_index: 70 };
      const outcome = [80, 68, 70, 75][index];
      const methods = Object.fromEntries(CONFIGURATION_PAIR_METHODS.map((id) => {
        const bi = id === "simple_mean" ? 69 : outcome;
        return [id, { raw_brier: [.15, .18, .2, .1][index], adjusted_brier: (100 - bi) / 100, brier_index: bi, gain_vs_base: (bi - 70) / 30, gain_vs_partner: .1, gain_vs_market: (bi - 70) / 30, beats_market: bi > 70 }];
      })) as ConfigurationPairView["methods"];
      const combined = view({
        base: market, market, partner: { raw_brier: .3, adjusted_brier: .3, brier_index: index === 1 ? 90 : 50 },
        methods, train_diversity: { prediction_diversity: .1 + index / 10, adjusted_pog: .2 + index / 10, high_loss_lift: -.3 - index / 10, adjusted_loss_corr: -.4, total_variation: index / 10 },
      });
      const directional = { ...combined, fold_count: 10, fold_ids: combined.fold_ids.slice(0, 10) };
      const near = { ...combined, fold_count: 3, fold_ids: combined.fold_ids.slice(0, 3), train_diversity: { ...combined.train_diversity, total_variation: .75 } };
      const unavailable = index === 3;
      return {
        configuration, n_common: unavailable ? 0 : 150, unique_event_count: unavailable ? 0 : 60,
        status: unavailable ? "zero_common_support" : "eligible", ...(unavailable ? { reason: "No shared forecast targets" } : {}),
        views: {
          all: { combined: unavailable ? null : combined, a_to_b: unavailable ? null : directional, b_to_a: unavailable ? null : directional },
          near_bi: { combined: index === 0 ? near : null, a_to_b: null, b_to_a: index === 0 ? near : null },
        },
      };
    }),
  };
}

export const modelMarketFetch = () => Promise.resolve(new Response(JSON.stringify(modelMarketFixture()), { status: 200 }));
