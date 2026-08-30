import { colorForScore, diversityScore, findPair, formatMetric, highLossDiagnosticLabel, textColorForScore } from "../lib/metrics";
import { HighLossRawNotice } from "./HighLossNotice";
import type { MetricDefinition, Model, PairMetrics } from "../types/data";

interface HeatmapProps {
  models: Model[];
  pairs: PairMetrics[];
  metric: MetricDefinition;
  selectedModel: string;
  selectedPair: PairMetrics | null;
  onSelectPair: (pair: PairMetrics) => void;
  testId?: string;
}

export function Heatmap({ models, pairs, metric, selectedModel, selectedPair, onSelectPair, testId = "heatmap" }: HeatmapProps) {
  if (models.length < 2) {
    return <div className="heatmap-empty" data-testid={testId} role="status">Select at least two models available under the active filters.</div>;
  }
  const values = pairs
    .map((pair) => pair.metrics[metric.id].value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const compact = models.length < 12;
  const densityClass = models.length <= 3
    ? "is-sparse"
    : models.length <= 5
      ? "is-roomy"
      : models.length <= 8
        ? "is-relaxed"
        : "is-dense";
  const gridTemplate = compact
    ? `minmax(var(--heatmap-label-min), var(--heatmap-label-width)) repeat(${models.length}, var(--heatmap-cell-width))`
    : `minmax(100px, 1.35fr) repeat(${models.length}, minmax(30px, 1fr))`;

  return (
    <><HighLossRawNotice metric={metric.id} colorScale /><div className="heatmap-scroll" data-testid={testId}>
      <div className={`heatmap-grid ${compact ? `is-compact ${densityClass}` : ""}`} style={{ gridTemplateColumns: gridTemplate }}>
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
              if (!pair || value === null || !Number.isFinite(value)) {
                return <div key={`${rowModel.id}-${columnModel.id}`} className="heat-cell missing" aria-label="Missing pair" title={pair?.metrics[metric.id].reason ?? "No defined value on the selected support"}>·</div>;
              }
              const score = diversityScore(value, metric, values);
              const active = selectedPair?.row_id === pair.row_id;
              const related = !selectedModel || pair.a === selectedModel || pair.b === selectedModel;
              return (
                <button
                  type="button"
                  key={`${rowModel.id}-${columnModel.id}`}
                  className={`heat-cell value ${active ? "is-active" : ""} ${related ? "" : "is-muted"}`}
                  style={{ background: colorForScore(score), color: textColorForScore(score) }}
                  aria-label={`${rowModel.name} and ${columnModel.name}: ${formatMetric(value, metric.id)}`}
                  title={metric.id === "high_loss_lift" ? highLossDiagnosticLabel(pair) : undefined}
                  onClick={() => onSelectPair(pair)}
                >
                  {formatMetric(value, metric.id)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div></>
  );
}
