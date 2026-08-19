import { aggregationScore, colorForScore, findPair, formatMetric, textColorForScore } from "../lib/metrics";
import type { MetricDefinition, Model, PairMetrics } from "../types/data";

interface HeatmapProps {
  models: Model[];
  pairs: PairMetrics[];
  metric: MetricDefinition;
  selectedModel: string;
  selectedPair: PairMetrics | null;
  onSelectPair: (pair: PairMetrics) => void;
}

export function Heatmap({ models, pairs, metric, selectedModel, selectedPair, onSelectPair }: HeatmapProps) {
  const values = pairs
    .map((pair) => pair.metrics[metric.id].value)
    .filter((value): value is number => value !== null);
  const gridTemplate = `minmax(100px, 1.35fr) repeat(${models.length}, minmax(30px, 1fr))`;

  return (
    <div className="heatmap-scroll" data-testid="heatmap">
      <div className="heatmap-grid" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="corner-label">MODEL PAIR</div>
        {models.map((model) => (
          <div key={`column-${model.id}`} className={`column-label ${model.id === selectedModel ? "is-focus" : ""}`}>
            <span>{model.name}</span>
          </div>
        ))}
        {models.map((rowModel) => (
          <div className="heatmap-row" key={rowModel.id} style={{ display: "contents" }}>
            <div className={`row-label ${rowModel.id === selectedModel ? "is-focus" : ""}`}>
              <span>{rowModel.name}</span>
              <small>{rowModel.provider}</small>
            </div>
            {models.map((columnModel) => {
              if (rowModel.id === columnModel.id) {
                return <div key={`${rowModel.id}-${columnModel.id}`} className="heat-cell diagonal" aria-label={`${rowModel.name} diagonal`}>—</div>;
              }
              const pair = findPair(pairs, rowModel.id, columnModel.id);
              const value = pair?.metrics[metric.id].value ?? null;
              if (!pair || value === null) {
                return <div key={`${rowModel.id}-${columnModel.id}`} className="heat-cell missing" aria-label="Missing pair">·</div>;
              }
              const score = aggregationScore(value, metric, values);
              const active = selectedPair?.row_id === pair.row_id;
              const related = !selectedModel || pair.a === selectedModel || pair.b === selectedModel;
              return (
                <button
                  type="button"
                  key={`${rowModel.id}-${columnModel.id}`}
                  className={`heat-cell value ${active ? "is-active" : ""} ${related ? "" : "is-muted"}`}
                  style={{ background: colorForScore(score), color: textColorForScore(score) }}
                  aria-label={`${rowModel.name} and ${columnModel.name}: ${formatMetric(value, metric.id)}`}
                  onClick={() => onSelectPair(pair)}
                >
                  {formatMetric(value, metric.id)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
