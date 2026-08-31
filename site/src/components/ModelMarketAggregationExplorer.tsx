import { useEffect, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { MarketWinBadge, MarketWinToggle, MarketWinVerdict } from "./MarketWinHighlight";
import { configurationProviderColor } from "./MarketConfigurationAggregationExplorer";
import { finiteExtent, linearPosition, linearTicks } from "./FreezeMarketCorrelationExplorer";
import { highLossAssociationReason, highLossAxis, isHighLossMetric, rawPearson, rawSpearman } from "../lib/highLoss";
import { loadModelMarketAggregation } from "../lib/modelMarketAggregation";
import { compareMatchedMarket, matchedMarketLabel, matchedMarketWinSummary } from "../lib/matchedMarketComparison";
import type { ConfigurationPairSample } from "../types/configurationPairAggregation";
import type { FreezeAggregationMethodId, FreezeFoldView, MarketPerformanceDiversityMetricId, MarketPerformanceOutcomeId } from "../types/data";
import type { ModelMarketAggregationData, ModelMarketAggregationFilters } from "../types/modelMarketAggregation";

const WIDTH = 1080;
const HEIGHT = 500;
const MARGIN = { top: 32, right: 34, bottom: 78, left: 88 };
const METRICS: Array<{ id: MarketPerformanceDiversityMetricId; label: string }> = [
  { id: "prediction_diversity", label: "Prediction diversity" },
  { id: "adjusted_pog", label: "Adjusted POG" },
  { id: "high_loss_lift", label: "High-loss diversity" },
  { id: "adjusted_loss_corr", label: "Adjusted-loss diversity" },
  { id: "total_variation", label: "Total variation (TV)" },
];
const OUTCOMES: Array<{ id: MarketPerformanceOutcomeId; label: string; axis: string }> = [
  { id: "raw_brier", label: "Raw Brier Score ↓", axis: "Aggregation Raw Brier Score (lower is better)" },
  { id: "brier_index", label: "Brier Index ↑", axis: "Aggregation Brier Index (higher is better)" },
];
const FOLDS: Array<{ id: FreezeFoldView; label: string }> = [
  { id: "combined", label: "Combined" }, { id: "a_to_b", label: "A→B" }, { id: "b_to_a", label: "B→A" },
];
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const format = (value: number | null | undefined, digits = 2) => finite(value) ? value.toFixed(digits) : "—";
const percentage = (value: number | null | undefined) => finite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%` : "—";
const formatX = (metric: MarketPerformanceDiversityMetricId, value: number | null | undefined) => format(value, metric === "total_variation" || metric === "adjusted_pog" ? 3 : 2);
const formatY = (outcome: MarketPerformanceOutcomeId, value: number | null | undefined) => format(value, outcome === "raw_brier" ? 3 : 1);
type Loaded = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: ModelMarketAggregationData };

export interface ModelMarketAggregationExplorerProps {
  selectedConfiguration: string | null;
  onSelectConfiguration: (exact: string) => void;
  filters: ModelMarketAggregationFilters;
}

export function ModelMarketAggregationExplorer({ selectedConfiguration, onSelectConfiguration, filters }: ModelMarketAggregationExplorerProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [metric, setMetric] = useState<MarketPerformanceDiversityMetricId>("prediction_diversity");
  const [outcome, setOutcome] = useState<MarketPerformanceOutcomeId>("brier_index");
  const [highlightMarketWins, setHighlightMarketWins] = useState(false);
  const [method, setMethod] = useState<FreezeAggregationMethodId>("ec_w0_56");
  const [fold, setFold] = useState<FreezeFoldView>("combined");
  const [sample, setSample] = useState<ConfigurationPairSample>("all");

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ status: "loading" });
    loadModelMarketAggregation(controller.signal).then((data) => {
      if (!controller.signal.aborted) setLoaded({ status: "ready", data });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoaded({ status: "error", error: reason instanceof Error ? reason.message : "Unable to load model + market aggregation." });
    });
    return () => controller.abort();
  }, [attempt]);

  const data = loaded.status === "ready" ? loaded.data : null;
  const candidates = (data?.points ?? []).filter(({ configuration }) => (filters.provider === "all" || configuration.provider === filters.provider)
    && (filters.prompt === "all" || configuration.prompt_type === filters.prompt)
    && (filters.information === "all" || configuration.information_type === filters.information));
  const inView = candidates.flatMap((row) => {
    const view = row.views[sample][fold];
    return view ? [{ row, view, score: view.methods[method] }] : [];
  });
  const points = inView.flatMap((item) => {
    const x = item.view.train_diversity[metric];
    const y = item.score[outcome];
    const comparison = compareMatchedMarket(item.score, item.view.market, outcome);
    return finite(x) && (!isHighLossMetric(metric) || x !== 1) && finite(y) && comparison !== "unavailable"
      ? [{ ...item, x, y, comparison, beatsMarket: comparison === "above" }] : [];
  });
  const selectedRow = data?.points.find((row) => row.configuration.exact_configuration === selectedConfiguration) ?? null;
  const selected = points.find((item) => item.row.configuration.exact_configuration === selectedConfiguration) ?? null;
  const selectedView = selectedRow?.views[sample][fold] ?? null;
  const selectedScore = selectedView?.methods[method];
  const selectedUnavailableReason = !selectedConfiguration ? "Select a configuration in the first chart or this chart to highlight its model + market result."
    : !selectedRow ? "The selected exact configuration is not included in this aggregation release."
      : !candidates.includes(selectedRow) ? "The selected exact configuration is outside the provider, prompt, or information filters above."
        : !selectedView ? `The selected exact configuration has no eligible result for this ${sample === "near_bi" ? "Near-BI " : ""}direction. ${selectedRow.reason ?? "No other configuration or all-sample result has been substituted."}`
          : isHighLossMetric(metric) && selectedView.train_diversity[metric] === 1 ? "High-loss diversity = 1 is hidden in this chart. The selected exact configuration is preserved."
            : !selected ? "The selected configuration has an undefined diversity, performance, or matched-market comparison in this view; it is not plotted."
              : null;
  const orderedPoints = [...points.filter((point) => point !== selected), ...(selected ? [selected] : [])];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const support = points.reduce((sum, point) => sum + point.view.test_target_cells, 0);
  const marketWins = matchedMarketWinSummary(points.map((point) => point.comparison));
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : finiteExtent(xs);
  const rawYDomain = finiteExtent(ys);
  const yDomain: [number, number] = outcome === "raw_brier" ? [Math.max(0, rawYDomain[0]), rawYDomain[1]] : rawYDomain;
  const highLossScale = isHighLossMetric(metric) ? highLossAxis(xs, [MARGIN.left, WIDTH - MARGIN.right]) : null;
  const xPosition = (raw: number) => highLossScale?.position(raw) ?? linearPosition(raw, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
  const xTicks = highLossScale?.ticks ?? linearTicks(xDomain, 6);
  const maximumDirections = (data?.split.repetitions ?? 10) * (fold === "combined" ? 2 : 1);
  const foldCounts = points.map((point) => point.view.fold_count);
  const associationReason = isHighLossMetric(metric) ? highLossAssociationReason(xs, ys, foldCounts, maximumDirections) : null;
  const pearson = associationReason ? null : rawPearson(xs, ys);
  const spearman = associationReason ? null : rawSpearman(xs, ys);
  const metricMeta = METRICS.find((item) => item.id === metric)!;
  const outcomeMeta = OUTCOMES.find((item) => item.id === outcome)!;
  const providers = [...new Set(points.map((point) => point.row.configuration.provider))].sort();
  const missingMetricCount = inView.filter((point) => !finite(point.view.train_diversity[metric])).length;
  const missingOutcomeCount = inView.filter((point) => !finite(point.score[outcome])).length;
  const missingComparisonCount = inView.filter((point) => compareMatchedMarket(point.score, point.view.market, outcome) === "unavailable").length;

  return <section className="model-market-section configuration-pair-section" id="model-market-aggregation" aria-labelledby="model-market-heading" aria-busy={loaded.status === "loading"}>
    <div className="section-heading market-performance-heading">
      <div><p className="eyebrow">MODEL + POLYMARKET · CROSS-FIT</p><h3 id="model-market-heading">Model + market aggregation</h3></div>
      <p>One point per exact model configuration combined with Polymarket. Training diversity versus aggregation performance on the opposite fold.</p>
    </div>
    <p className="research-scope model-market-filter-note">Provider, prompt, and information filters follow the first chart. Its selected exact configuration is highlighted here whenever this view has a defined result.</p>
    {loaded.status === "loading" && <div className="configuration-pair-loading" role="status">Loading model + market aggregation results…</div>}
    {loaded.status === "error" && <div className="configuration-pair-loading" role="alert"><p>{loaded.error}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setAttempt((value) => value + 1)}>Retry model + market results</button></div>}
    {data && <>
      <div className="configuration-pair-controls model-market-controls">
        <label><span>AGGREGATION METHOD</span><select aria-label="Model + market aggregation method" value={method} onChange={(event) => setMethod(event.target.value as FreezeAggregationMethodId)}>{data.method_order.map((id) => <option key={id} value={id}>{data.methods[id].label}</option>)}</select></label>
        <label><span>CROSS-FIT VIEW</span><select aria-label="Model + market cross-fit direction" value={fold} onChange={(event) => setFold(event.target.value as FreezeFoldView)}>{FOLDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>TRAIN SAMPLE</span><select aria-label="Model + market train sample" value={sample} onChange={(event) => setSample(event.target.value as ConfigurationPairSample)}><option value="all">All eligible</option><option value="near_bi">Near-BI (train gap ≤ {data.split.near_bi_gap})</option></select></label>
      </div>
      <div className="market-performance-axis-controls">
        <div><span>DIVERSITY · X</span><div className="market-performance-tabs" role="group" aria-label="Model + market diversity metric">{METRICS.map((item) => <button type="button" key={item.id} className={metric === item.id ? "active" : ""} aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div></div>
        <div><span>PERFORMANCE · Y</span><div className="market-performance-tabs" role="group" aria-label="Model + market performance outcome">{OUTCOMES.map((item) => <button type="button" key={item.id} className={outcome === item.id ? "active" : ""} aria-pressed={outcome === item.id} onClick={() => setOutcome(item.id)}>{item.label}</button>)}</div></div>
      </div>
      <MarketWinToggle scope="Model + market aggregation" checked={highlightMarketWins} onChange={setHighlightMarketWins} outcome={outcome} />
      <dl className="market-performance-kpis model-market-kpis">
        <div><dt>MODEL–MARKET PAIRS</dt><dd>{points.length}</dd><small>{candidates.length} exact candidates under filters</small></div>
        <div><dt>BEATS MATCHED MARKET</dt><dd>{marketWins.wins} / {marketWins.total}</dd><small>{marketWins.rate} · {outcome === "brier_index" ? "BI ↑" : "Raw Brier ↓"} · point estimates</small></div>
        <div><dt>PEARSON r</dt><dd>{format(pearson)}</dd><small>{outcome === "raw_brier" ? "positive means worse Brier" : "positive means better BI"}</small></div>
        <div><dt>SPEARMAN ρ</dt><dd>{format(spearman)}</dd><small>unweighted configuration ranks</small></div>
        <div><dt>REPEATED TEST CELLS</dt><dd>{support.toLocaleString()}</dd><small>not independent new events</small></div>
      </dl>
      {method === "best_single" && <p className="model-market-method-notice research-scope"><strong>Best Single is a test-fold hindsight reference.</strong> It is not a deployable aggregation method.</p>}
      <div className="market-performance-layout model-market-layout">
        <div className="market-performance-chart-wrap">
          {points.length > 0 ? <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="model-market-chart" role="img" aria-label={`${metricMeta.label} versus aggregation ${outcomeMeta.label}; model + Polymarket`}>
            {linearTicks(yDomain, 6).map((tick) => {
              const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              return <g key={`y-${tick}`}><line className="market-performance-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="market-performance-tick" x={MARGIN.left - 13} y={y + 4} textAnchor="end">{formatY(outcome, tick)}</text></g>;
            })}
            {xTicks.map((tick) => {
              const x = xPosition(tick);
              return <g key={`x-${tick}`}><line className="market-performance-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="market-performance-tick" x={x} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{formatX(metric, tick)}</text></g>;
            })}
            {orderedPoints.map((point) => {
              const exact = point.row.configuration.exact_configuration;
              const active = exact === selectedConfiguration;
              const x = xPosition(point.x);
              const y = linearPosition(point.y, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              const label = `${exact}\n${metricMeta.label}: ${formatX(metric, point.x)}\nAggregation ${outcomeMeta.label}: ${formatY(outcome, point.y)}\nMatched market ${outcomeMeta.label}: ${formatY(outcome, point.view.market[outcome])}\n${matchedMarketLabel[point.comparison]} · ${outcome === "brier_index" ? "BI" : "Raw Brier"}\n${point.view.fold_count}/${maximumDirections} directions · ${point.row.n_common} common targets`;
              return <g key={exact} className={`model-market-point${active ? " selected" : ""}`} data-configuration={exact} data-marker-shape="circle" data-market-comparison={point.comparison} data-above-market={point.beatsMarket} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} aria-pressed={active} aria-controls="market-performance" onClick={() => onSelectConfiguration(exact)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectConfiguration(exact); } }}>
                {active && <circle className="model-market-selection-halo" r={12} />}
                <circle className="model-market-glyph" r={6.5} fill={configurationProviderColor(point.row.configuration.provider)} />
                {highlightMarketWins && point.beatsMarket && <MarketWinBadge />}
                <circle className="market-performance-hit-target" r={12} /><title>{label}</title>
              </g>;
            })}
            <text className="market-performance-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 15} textAnchor="middle">Lower diversity ← {data.metrics[metric].axis} → Higher diversity{highLossScale ? " · signed-log display; raw ticks" : ""}</text>
            <text className="market-performance-axis-label" transform={`translate(20 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{outcomeMeta.axis}</text>
          </svg> : <div className="configuration-pair-empty"><strong>No model + market results to plot in this view.</strong><span>Change the filters, direction, or train sample.</span></div>}
        </div>
        <aside className="configuration-pair-inspector model-market-inspector" aria-live="polite" data-selected-configuration={selectedConfiguration ?? undefined}>
          <p className="eyebrow">SELECTED MODEL + MARKET</p>
          {selectedRow && <><h4>{selectedRow.configuration.canonical_model_version}</h4><p>{selectedRow.configuration.information_label} · {selectedRow.configuration.prompt_label}</p></>}
          {selectedUnavailableReason && <p className="model-market-unavailable">{selectedUnavailableReason}</p>}
          {selectedView && selectedScore && <MarketWinVerdict comparison={compareMatchedMarket(selectedScore, selectedView.market, outcome)} outcome={outcome} />}
          {selectedRow && <>
            {selectedView && selectedScore && <dl>
              <div><dt>{metricMeta.label}</dt><dd>{format(selectedView.train_diversity[metric], 3)}</dd></div>
              <div><dt>Aggregation BI ↑</dt><dd>{format(selectedScore.brier_index)}</dd></div>
              <div><dt>Matched market BI ↑</dt><dd>{format(selectedView.market.brier_index)}</dd></div>
              <div><dt>Model BI ↑</dt><dd>{format(selectedView.partner.brier_index)}</dd></div>
              <div><dt>Aggregation Raw Brier ↓</dt><dd>{format(selectedScore.raw_brier, 3)}</dd></div>
              <div><dt>Matched market Raw Brier ↓</dt><dd>{format(selectedView.market.raw_brier, 3)}</dd></div>
              <div><dt>Gain vs market</dt><dd>{percentage(selectedScore.gain_vs_market)}</dd></div>
              <div><dt>Train BI gap</dt><dd>{format(selectedView.train_bi_gap)}</dd></div>
              <div><dt>Available directions</dt><dd>{selectedView.fold_count}/{maximumDirections}</dd></div>
              <div><dt>Min train / test rows</dt><dd>{selectedView.min_train_rows} / {selectedView.min_test_rows}</dd></div>
              <div><dt>Common targets</dt><dd>{selectedRow.n_common.toLocaleString()}</dd></div>
              <div><dt>Unique events</dt><dd>{selectedRow.unique_event_count.toLocaleString()}</dd></div>
            </dl>}
            {selectedView?.small_support && <p className="configuration-pair-small-support">Small-support estimate: at least one included half has fewer than 50 targets.</p>}
            <small>{selectedRow.configuration.exact_configuration}</small>
          </>}
        </aside>
      </div>
      <div className="configuration-pair-legend model-market-legend"><strong>Model provider</strong>{providers.map((provider) => <span key={provider}><i style={{ background: configurationProviderColor(provider) }} />{provider}</span>)}</div>
      <p className="research-scope">Optional badges compare aggregation with Polymarket on that configuration’s own test events, using the selected Y metric. Repeated folds reuse events; a win is a point estimate, not statistical significance.</p>
      {!isHighLossMetric(metric) && <p className="research-scope">{candidates.length - inView.length} candidate(s) have no eligible view. {missingMetricCount} view(s) have an undefined selected diversity; {missingOutcomeCount} have an undefined selected outcome; {missingComparisonCount} have an undefined matched-market comparison. These counts may overlap.</p>}
      <ResearchDetails label="Model + market evaluation details">
        <p><strong>Exact configurations.</strong> Each model version, prompt, and information condition is kept separate. Color identifies the model provider; shape does not encode prompt or information. The selected exact configuration stays linked to the first chart.</p>
        <p><strong>Cross-fit evaluation.</strong> {data.split.repetitions} event-grouped splits are attempted in both directions. Diversity uses each training half; aggregation and market scores use the opposite half on identical non-imputed model–market target support. Combined pools available directions. Near-BI retains directions whose training BI gap is at most {data.split.near_bi_gap}, before pooling. It does not filter on test performance.</p>
        <p><strong>Unchanged methods.</strong> All six published methods retain their definitions. Directional CF uses Polymarket as the base and fits its weights on training data. Best Single chooses one forecaster using test-fold hindsight and is a reference, not a deployable method.</p>
        <p><strong>Interpretation.</strong> Prediction diversity is 1 − prediction correlation; TV is the mean absolute model–market probability difference. Loss-based measures use training outcomes. Correlations use raw coordinates and are descriptive; choosing a model after viewing the overview is exploratory post-selection. The optional badge and win count compare pooled aggregation and matched-market scores under the selected Y metric: higher BI or lower Raw Brier, with a 1e−12 numerical tolerance. Ties receive no badge. The published experiment’s BI-based beats_market field remains unchanged.</p>
      </ResearchDetails>
    </>}
  </section>;
}
