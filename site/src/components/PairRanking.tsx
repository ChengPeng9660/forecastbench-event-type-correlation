import { formatMetric, highLossDiagnosticLabel, sortPairs } from "../lib/metrics";
import { HighLossRawNotice } from "./HighLossNotice";
import type { MetricDefinition, Model, PairMetrics } from "../types/data";

interface PairRankingProps {
  pairs: PairMetrics[];
  metric: MetricDefinition;
  models: Model[];
  selectedPair: PairMetrics | null;
  onSelectPair: (pair: PairMetrics) => void;
}

export function PairRanking({ pairs, metric, models, selectedPair, onSelectPair }: PairRankingProps) {
  const names = new Map(models.map((model) => [model.id, model.name]));
  const ranked = sortPairs(pairs, metric);
  const rendered = ranked.slice(0, 200);
  return (
    <div className="ranking-wrap">
      <HighLossRawNotice metric={metric.id} />
      <p className="scale-note">Showing the {Math.min(200, ranked.length).toLocaleString()} highest-dependence pairs out of {ranked.length.toLocaleString()}. The CSV download includes every pair under the active filters.</p>
      <table className="ranking-table">
        <thead>
          <tr><th>Rank</th><th>Model pair</th><th>{metric.short_label}</th><th>Overlap</th><th>Near-BI</th></tr>
        </thead>
        <tbody>
          {rendered.map((pair, index) => (
            <tr
              key={pair.row_id}
              className={selectedPair?.row_id === pair.row_id ? "is-selected" : ""}
              onClick={() => onSelectPair(pair)}
            >
              <td><span className="rank-number">{String(index + 1).padStart(2, "0")}</span></td>
              <td><button type="button" onClick={() => onSelectPair(pair)}>{names.get(pair.a)} <span>×</span> {names.get(pair.b)}</button></td>
              <td className="metric-number" title={metric.id === "high_loss_lift" ? highLossDiagnosticLabel(pair) : undefined}>{formatMetric(pair.metrics[metric.id].value, metric.id)}</td>
              <td>{pair.n_overlap.toLocaleString()}</td>
              <td>{pair.diagnostics.near_bi === null ? "—" : pair.diagnostics.near_bi ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length === 0 && <p className="empty-state">No model pairs meet the sample threshold under the active filters.</p>}
    </div>
  );
}
