import { dependenceDirectionLabel, formatMetric } from "../lib/metrics";
import type { Manifest, Model, PairMetrics } from "../types/data";

interface PairInspectorProps {
  pair: PairMetrics | null;
  models: Model[];
  manifest: Manifest;
}

export function PairInspector({ pair, models, manifest }: PairInspectorProps) {
  const modelName = (id: string) => models.find((model) => model.id === id)?.name ?? id;

  if (!pair) {
    return (
      <aside className="inspector empty-inspector">
        <p className="eyebrow">PAIR DETAIL</p>
        <h3>Select a model pair</h3>
        <p>Choose a heatmap cell or a ranking row below to inspect all four metrics, sample size, and near-BI diagnostics.</p>
      </aside>
    );
  }

  return (
    <aside className="inspector" data-testid="pair-inspector">
      <p className="eyebrow">PAIR DETAIL</p>
      <h3>{modelName(pair.a)} <span>×</span> {modelName(pair.b)}</h3>
      <div className="metric-readout">
        {manifest.metrics.map((metric) => (
          <div key={metric.id}>
            <span>{metric.short_label}</span>
            <strong>{formatMetric(pair.metrics[metric.id].value, metric.id)}</strong>
            <small>{pair.metrics[metric.id].value === null ? (pair.metrics[metric.id].reason ?? "Missing value") : dependenceDirectionLabel(metric.id)}</small>
          </div>
        ))}
      </div>
      <dl className="pair-meta">
        <div><dt>Shared forecast targets</dt><dd>{pair.n_overlap.toLocaleString()}</dd></div>
        <div><dt>Forecast dates</dt><dd>{pair.n_dates}</dd></div>
        <div><dt>Mean BI gap</dt><dd>{pair.diagnostics.mean_bi_gap?.toFixed(2) ?? "—"}</dd></div>
        <div><dt>Near-BI</dt><dd>{pair.diagnostics.near_bi === null ? "—" : pair.diagnostics.near_bi ? "Yes" : "No"}</dd></div>
        <div><dt>High-loss rate A</dt><dd>{pair.diagnostics.high_loss_rate_a == null ? "—" : `${(pair.diagnostics.high_loss_rate_a * 100).toFixed(1)}%`}</dd></div>
        <div><dt>High-loss rate B</dt><dd>{pair.diagnostics.high_loss_rate_b == null ? "—" : `${(pair.diagnostics.high_loss_rate_b * 100).toFixed(1)}%`}</dd></div>
        <div><dt>Joint high-loss rate</dt><dd>{pair.diagnostics.joint_high_loss_rate == null ? "—" : `${(pair.diagnostics.joint_high_loss_rate * 100).toFixed(1)}%`}</dd></div>
        <div><dt>Joint high-loss count</dt><dd>{pair.diagnostics.joint_high_loss_count ?? "—"}</dd></div>
      </dl>
      <p className="row-id">AUDIT ID · {pair.row_id}</p>
    </aside>
  );
}
