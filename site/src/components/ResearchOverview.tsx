import { colorForScore, diversityScore, findPair, formatMetric } from "../lib/metrics";
import type { AppData, MetricDefinition, Model, PairMetrics } from "../types/data";
import { ResearchLink, type NavigateResearch } from "./ResearchShell";

function shortName(name: string) {
  // Keep version/date suffixes: two releases of the same family are not duplicate models.
  return name.length > 31 ? `${name.slice(0, 20)}…${name.slice(-8)}` : name;
}

function AtlasPreview({ models, pairs, metric, eventLabel, nearBi, onNavigate }: {
  models: Model[]; pairs: PairMetrics[]; metric: MetricDefinition; eventLabel: string;
  nearBi: boolean; onNavigate: NavigateResearch;
}) {
  const coverage = new Map<string, number>();
  for (const pair of pairs) {
    coverage.set(pair.a, (coverage.get(pair.a) ?? 0) + pair.n_overlap);
    coverage.set(pair.b, (coverage.get(pair.b) ?? 0) + pair.n_overlap);
  }
  const preview = [...models].filter((model) => coverage.has(model.id))
    .sort((a, b) => (coverage.get(b.id) ?? 0) - (coverage.get(a.id) ?? 0)).slice(0, 8)
    .sort((a, b) => a.release_order - b.release_order || a.name.localeCompare(b.name));
  const values = pairs.map((pair) => pair.metrics[metric.id].value).filter((value): value is number => value !== null);
  return <figure className="overview-visual">
    <figcaption><span className="eyebrow">INSIDE THE ATLAS</span><ResearchLink page="matrix" onNavigate={onNavigate}>Explore matrix <span aria-hidden="true">↗</span></ResearchLink></figcaption>
    <div className="overview-visual-heading"><strong>{eventLabel}</strong><span>{metric.id === "adjusted_pog" ? "Adjusted oracle gain" : metric.label}</span></div>
    {preview.length > 1 ? <svg className="overview-matrix" viewBox={`0 0 465 ${66 + preview.length * 34}`} role="img" aria-label={`${preview.length}-model preview of ${metric.label} for ${eventLabel}; darker purple means higher diversity`}>
      {preview.map((model, index) => <g key={`label-${model.id}`}>
        <text x="0" y={64 + index * 34} className="overview-matrix-label"><title>{model.name}</title><tspan className="overview-matrix-index">{String(index + 1).padStart(2, "0")}</tspan><tspan dx="9">{shortName(model.name)}</tspan></text>
        <text x={207 + index * 32} y="30" textAnchor="middle" className="overview-matrix-index">{String(index + 1).padStart(2, "0")}</text>
      </g>)}
      {preview.flatMap((a, row) => preview.map((b, column) => {
        const value = a.id === b.id ? null : findPair(pairs, a.id, b.id)?.metrics[metric.id].value ?? null;
        const fill = a.id === b.id ? "#ece8ef" : value === null ? "#f7f5f9" : colorForScore(diversityScore(value, metric, values));
        return <rect key={`${a.id}-${b.id}`} x={192 + column * 32} y={45 + row * 34} width="29" height="30" rx="3" fill={fill}>
          <title>{a.name} × {b.name}: {a.id === b.id ? "same model" : formatMetric(value, metric.id)}</title>
        </rect>;
      }))}
    </svg> : <p className="overview-preview-empty">Choose a wider sample to explore the matrix.</p>}
    <div className="overview-visual-key"><span><i /> Higher diversity</span><small>{preview.length}-model preview{nearBi ? " · Near-BI" : " · All eligible"}</small></div>
  </figure>;
}

export function ResearchOverview({ appData, models, pairs, metric, eventLabel, nearBi, onNavigate }: {
  appData: AppData; models: Model[]; pairs: PairMetrics[]; metric: MetricDefinition;
  eventLabel: string; nearBi: boolean; onNavigate: NavigateResearch;
}) {
  return <>
    <section className="overview-hero" id="overview">
      <div className="overview-hero-copy">
        <p className="eyebrow"><span className="research-kicker-dot" /> AN OPEN FORECASTING RESEARCH ATLAS</p>
        <h1>Different models.<br /><em>Better together?</em></h1>
        <p className="overview-deck">Explore what model diversity means for forecasting—and when combining predictions makes a difference.</p>
        <div className="overview-actions"><ResearchLink page="matrix" onNavigate={onNavigate} className="research-button">Explore the atlas <span aria-hidden="true">→</span></ResearchLink><ResearchLink page="gain" onNavigate={onNavigate} className="research-text-link">Compare aggregators <span aria-hidden="true">↗</span></ResearchLink></div>
        <p className="overview-byline">Built with ForecastBench data. Made for exploration.</p>
      </div>
      <AtlasPreview models={models} pairs={pairs} metric={metric} eventLabel={eventLabel} nearBi={nearBi} onNavigate={onNavigate} />
    </section>
    <section className="overview-stat-strip" aria-label="Research dataset overview">
      <div><strong>{appData.models.length.toLocaleString()}</strong><span>Model versions</span></div>
      <div><strong>{appData.manifest.source_snapshot.unique_events.toLocaleString()}</strong><span>Unique events</span></div>
      <div><strong>{appData.manifest.source_snapshot.official_targets.toLocaleString()}</strong><span>Forecast targets</span></div>
      <div><strong>{appData.manifest.event_types.length}</strong><span>Analysis slices</span></div>
    </section>
    <section className="overview-paths" aria-labelledby="explore-title">
      <div className="overview-section-heading"><p className="eyebrow">THE RESEARCH</p><h2 id="explore-title">Three questions. One place to explore.</h2></div>
      <div className="overview-path-grid">
        <ResearchLink page="matrix" onNavigate={onNavigate} className="overview-path"><span className="overview-path-index">01 / DIVERSITY</span><h3>Where do models differ?</h3><p>Map pairwise relationships across topics, model families, and performance levels.</p><span className="overview-path-bottom">Matrices, rankings & stability <span aria-hidden="true">↗</span></span></ResearchLink>
        <ResearchLink page="gain" onNavigate={onNavigate} className="overview-path"><span className="overview-path-index">02 / AGGREGATION</span><h3>Which combinations help?</h3><p>Compare pooling methods with a fixed model and changing partners.</p><span className="overview-path-bottom">Baselines & held-out experiments <span aria-hidden="true">↗</span></span></ResearchLink>
        <ResearchLink page="market-performance" onNavigate={onNavigate} className="overview-path"><span className="overview-path-index">03 / PREDICTION MARKETS</span><h3>Can models add to the market?</h3><p>Study market information, forecast alignment, and pair-matched performance.</p><span className="overview-path-bottom">Polymarket comparisons <span aria-hidden="true">↗</span></span></ResearchLink>
      </div>
    </section>
    <section className="overview-open-research">
      <div><p className="eyebrow">BUILT TO BE INSPECTED</p><h2>The evidence stays open.</h2><p>Download the results, inspect the methods, and follow the data back to its source.</p></div>
      <ResearchLink page="methods" onNavigate={onNavigate} className="research-text-link">Methods & data <span aria-hidden="true">→</span></ResearchLink>
    </section>
  </>;
}
