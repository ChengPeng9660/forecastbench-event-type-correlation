import { formatMetric, sortPairs } from "../lib/metrics";
import type { Manifest, Model, PairMetrics } from "../types/data";

interface ModelProfileProps {
  modelId: string;
  pairs: PairMetrics[];
  models: Model[];
  manifest: Manifest;
  onSelectPair: (pair: PairMetrics) => void;
}

export function ModelProfile({ modelId, pairs, models, manifest, onSelectPair }: ModelProfileProps) {
  const model = models.find((item) => item.id === modelId);
  if (!model) return null;
  const relevant = pairs.filter((pair) => pair.a === modelId || pair.b === modelId);
  const names = new Map(models.map((item) => [item.id, item.name]));
  return (
    <section className="model-profile" id="model-view">
      <div className="section-heading">
        <div><p className="eyebrow">MODEL VIEW</p><h2>{model.name} dependence profile</h2></div>
        <p>Compare this model with every other model in the selected event type. Rankings are oriented toward greater aggregation value.</p>
      </div>
      <div className="profile-columns">
        {manifest.metrics.map((metric) => (
          <div className="profile-column" key={metric.id}>
            <header><span>{metric.short_label}</span><small>{metric.direction === "higher" ? "HIGHER →" : "LOWER →"}</small></header>
            <ol>
              {sortPairs(relevant, metric).slice(0, 20).map((pair) => {
                const partner = pair.a === modelId ? pair.b : pair.a;
                return (
                  <li key={pair.row_id}>
                    <button type="button" onClick={() => onSelectPair(pair)}>
                      <span>{names.get(partner)}</span>
                      <strong>{formatMetric(pair.metrics[metric.id].value, metric.id)}</strong>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
