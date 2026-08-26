import { useEffect, useMemo, useState } from "react";
import type { FreezeMarketCorrelationData, FreezeMarketCorrelationPoint } from "../types/data";

export type FreezeCorrelationSort = "correlation" | "exact_copy" | "mad" | "support";

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const decimal = (value: number, digits = 3) => value.toFixed(digits);

export function sortFreezeCorrelationPoints(
  points: FreezeMarketCorrelationPoint[],
  sort: FreezeCorrelationSort,
): FreezeMarketCorrelationPoint[] {
  const rows = [...points];
  rows.sort((a, b) => {
    if (sort === "exact_copy") return b.exact_copy_share - a.exact_copy_share || b.n_common - a.n_common;
    if (sort === "mad") return a.mean_absolute_difference - b.mean_absolute_difference || b.n_common - a.n_common;
    if (sort === "support") return b.n_common - a.n_common || b.prediction_pearson - a.prediction_pearson;
    return b.prediction_pearson - a.prediction_pearson || b.n_common - a.n_common;
  });
  return rows;
}

export function summarizeFreezeCorrelationPoints(points: FreezeMarketCorrelationPoint[]) {
  const support = points.reduce((sum, point) => sum + point.n_common, 0);
  const weighted = (key: "prediction_pearson" | "exact_copy_share" | "mean_absolute_difference") => (
    support ? points.reduce((sum, point) => sum + point[key] * point.n_common, 0) / support : 0
  );
  return {
    models: points.length,
    support,
    correlation: weighted("prediction_pearson"),
    exactCopy: weighted("exact_copy_share"),
    mad: weighted("mean_absolute_difference"),
  };
}

function downloadCorrelationCsv(points: FreezeMarketCorrelationPoint[]) {
  const fields: Array<keyof FreezeMarketCorrelationPoint> = [
    "model", "provider", "family", "exact_configuration", "n_common", "prediction_pearson",
    "exact_copy_share", "mean_absolute_difference", "root_mean_squared_difference",
    "market_mean_probability", "model_mean_probability", "market_brier_index",
    "model_brier_index", "model_gain_vs_market",
  ];
  const rows = [fields, ...points.map((point) => fields.map((field) => point[field]))];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "forecastbench_with_freeze_market_correlation.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function FreezeMarketCorrelationExplorer({ data }: { data: FreezeMarketCorrelationData }) {
  const [provider, setProvider] = useState("all");
  const [sort, setSort] = useState<FreezeCorrelationSort>("correlation");
  const [showAll, setShowAll] = useState(false);
  const [selectedModel, setSelectedModel] = useState(data.points[0]?.model ?? "");
  const providers = useMemo(() => [...new Set(data.points.map((point) => point.provider))], [data.points]);
  const filtered = useMemo(
    () => data.points.filter((point) => provider === "all" || point.provider === provider),
    [data.points, provider],
  );
  const ranked = useMemo(() => sortFreezeCorrelationPoints(filtered, sort), [filtered, sort]);
  const summary = useMemo(() => summarizeFreezeCorrelationPoints(filtered), [filtered]);
  const displayed = showAll || ranked.length <= 12 ? ranked : ranked.slice(0, 12);
  const selected = ranked.find((point) => point.model === selectedModel) ?? ranked[0];

  useEffect(() => {
    if (!ranked.some((point) => point.model === selectedModel)) setSelectedModel(ranked[0]?.model ?? "");
  }, [ranked, selectedModel]);

  function chooseProvider(nextProvider: string) {
    setProvider(nextProvider);
    setShowAll(false);
  }

  return (
    <section className="freeze-correlation-section" id="freeze-correlation">
      <div className="section-heading freeze-correlation-heading">
        <div>
          <p className="eyebrow">WITH-FREEZE MODEL ↔ MARKET</p>
          <h2>How closely do models track the market snapshot?</h2>
        </div>
        <p>Prediction-level Pearson correlation compares each explicit with-freeze model with the same ForecastBench freeze-time Polymarket probability. Higher values mean closer alignment—not higher forecasting quality or causal market influence.</p>
      </div>

      <div className="freeze-correlation-kpis" aria-label="Correlation summary">
        <div><span>MODELS</span><strong>{summary.models}</strong><small>canonical configurations</small></div>
        <div><span>WEIGHTED r</span><strong>{decimal(summary.correlation)}</strong><small>support-weighted Pearson</small></div>
        <div><span>EXACT COPY</span><strong>{percent(summary.exactCopy)}</strong><small>identical probabilities</small></div>
        <div><span>MEAN |Δp|</span><strong>{percent(summary.mad, 2)}</strong><small>absolute probability gap</small></div>
        <div><span>COMMON CELLS</span><strong>{summary.support.toLocaleString()}</strong><small>non-imputed model–events</small></div>
      </div>

      <div className="freeze-correlation-toolbar">
        <div className="freeze-provider-tabs" role="group" aria-label="Filter models by provider">
          <button className={provider === "all" ? "active" : ""} type="button" onClick={() => chooseProvider("all")}>All providers</button>
          {providers.map((item) => <button className={provider === item ? "active" : ""} type="button" onClick={() => chooseProvider(item)} key={item}>{item}</button>)}
        </div>
        <div className="freeze-correlation-actions">
          <label><span>SORT BY</span><select aria-label="Sort freeze correlation models" value={sort} onChange={(event) => setSort(event.target.value as FreezeCorrelationSort)}><option value="correlation">Prediction correlation</option><option value="exact_copy">Exact-copy share</option><option value="mad">Mean |Δp| (closest first)</option><option value="support">Common support</option></select></label>
          <button className="download-button" type="button" onClick={() => downloadCorrelationCsv(filtered)}>Download CSV ↓</button>
        </div>
      </div>

      <div className="freeze-correlation-layout">
        <div className="freeze-correlation-ranking">
          <div className="freeze-correlation-scale" aria-hidden="true"><span>−1</span><span>0</span><span>+1</span></div>
          {displayed.map((point, index) => {
            const position = Math.max(0, Math.min(100, (point.prediction_pearson + 1) * 50));
            return (
              <button
                className={`freeze-correlation-row ${selected?.model === point.model ? "active" : ""}`}
                type="button"
                aria-label={`Inspect ${point.model}, prediction correlation ${decimal(point.prediction_pearson)}`}
                aria-pressed={selected?.model === point.model}
                onClick={() => setSelectedModel(point.model)}
                key={point.model}
              >
                <span className="freeze-correlation-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="freeze-correlation-model"><strong>{point.model}</strong><small>{point.provider} · n {point.n_common.toLocaleString()}</small></span>
                <span className="freeze-correlation-track"><i className="freeze-correlation-zero" /><i className="freeze-correlation-segment" style={{ left: "50%", width: `${Math.max(0, position - 50)}%` }} /><i className="freeze-correlation-dot" style={{ left: `${position}%` }} /></span>
                <strong className="freeze-correlation-value">{decimal(point.prediction_pearson)}</strong>
              </button>
            );
          })}
          {ranked.length > 12 && <button className="freeze-correlation-more" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show top 12" : `Show all ${ranked.length}`}</button>}
        </div>

        {selected && <aside className="freeze-correlation-detail" aria-live="polite">
          <p className="eyebrow">SELECTED MODEL</p>
          <h3>{selected.model}</h3>
          <p className="freeze-correlation-config">{selected.exact_configuration}</p>
          <dl>
            <div><dt>Prediction r</dt><dd>{decimal(selected.prediction_pearson)}</dd></div>
            <div><dt>Exact copy</dt><dd>{percent(selected.exact_copy_share)}</dd></div>
            <div><dt>Mean |Δp|</dt><dd>{percent(selected.mean_absolute_difference, 2)}</dd></div>
            <div><dt>RMSE Δp</dt><dd>{percent(selected.root_mean_squared_difference, 2)}</dd></div>
            <div><dt>Market BI</dt><dd>{selected.market_brier_index.toFixed(2)}</dd></div>
            <div><dt>Model BI</dt><dd>{selected.model_brier_index.toFixed(2)}</dd></div>
            <div><dt>Model gain vs market</dt><dd className={selected.model_gain_vs_market >= 0 ? "positive" : "negative"}>{selected.model_gain_vs_market >= 0 ? "+" : ""}{percent(selected.model_gain_vs_market, 2)}</dd></div>
            <div><dt>Common events</dt><dd>{selected.n_common.toLocaleString()}</dd></div>
          </dl>
          <p className="freeze-correlation-note"><strong>Read this as redundancy.</strong> {data.metric.causal_warning} A high correlation means the model stays close to the market input it saw; it does not by itself imply better BI or positive aggregation gain.</p>
        </aside>}
      </div>

      <div className="freeze-correlation-audit">
        <p><strong>Exact freeze exposure.</strong> One canonical configuration per model version; all displayed configurations explicitly include <code>with freeze values</code>.</p>
        <p><strong>Outcome-blind support.</strong> Imputed market rows are excluded, leaving {data.audit.model_event_cells.toLocaleString()} model–event cells; correlation is computed only on each model's exact common support.</p>
      </div>
    </section>
  );
}
