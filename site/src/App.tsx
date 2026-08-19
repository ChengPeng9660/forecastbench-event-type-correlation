import { useEffect, useMemo, useState } from "react";
import { Heatmap } from "./components/Heatmap";
import { CrossTypeStability } from "./components/CrossTypeStability";
import { GlobalBaseline } from "./components/GlobalBaseline";
import { ModelProfile } from "./components/ModelProfile";
import { PairRanking } from "./components/PairRanking";
import { loadAppData, loadCrossTypeData, loadEventType, loadGlobalBaselineData } from "./lib/data";
import { dependenceDirectionLabel, MODEL_DEPENDENCE_DIRECTION, orientMetricToDependence } from "./lib/metrics";
import type { AppData, CrossTypeData, EventTypeData, GlobalBaselineData, MetricId, PairMetrics } from "./types/data";

interface Filters {
  eventType: string;
  metric: MetricId;
  model: string;
  provider: string;
  minOverlap: number;
  nearBi: boolean;
}

const query = new URLSearchParams(window.location.search);
const initialFilters: Filters = {
  eventType: query.get("type") ?? "",
  metric: (query.get("metric") as MetricId) ?? "adjusted_pog",
  model: query.get("model") ?? "",
  provider: query.get("provider") ?? "all",
  minOverlap: Number(query.get("min_n") ?? 50),
  nearBi: query.get("near_bi") !== "0",
};

const METRIC_DESCRIPTIONS: Record<MetricId, string> = {
  adjusted_pog: "Measures whether two models excel on different questions. Lower gain means higher model dependence; larger gain indicates more ex post complementarity.",
  high_loss_lift: "Measures how often two models incur severe errors together. Higher lift means higher model dependence; 1 indicates approximate independence.",
  adjusted_loss_corr: "Measures alignment in question-level difficulty-adjusted Brier losses. Higher correlation means higher model dependence.",
};

const TOPIC_DEFINITIONS: Record<string, string> = {
  finance_economics: "Macroeconomics, interest rates, exchange rates, equities, crypto assets, and financial markets.",
  politics_conflict: "Elections, public policy, diplomacy, war, armed conflict, and geopolitics.",
  climate_weather: "Temperature, precipitation, weather indicators, and climate-related questions.",
  health_science: "Disease, vaccines, biomedicine, clinical research, and general science.",
  technology_ai: "Artificial intelligence, models, technology companies, semiconductors, cybersecurity, and product launches.",
  sports: "Sporting events, rankings, records, athletes, and competition outcomes.",
  entertainment_culture: "Film, television, music, publishing, gaming, awards, and cultural events.",
  other: "Questions that cannot be reliably assigned to one topic, have unrecoverable text, or require manual review.",
};

export function pairCsvRows(pairs: PairMetrics[], appData: AppData, eventData: EventTypeData) {
  const metricIds = appData.manifest.metrics.map((metric) => metric.id);
  const modelNames = new Map(appData.models.map((model) => [model.id, model.name]));
  const eventRef = appData.manifest.event_types.find((item) => item.id === eventData.event_type.id);
  const rows = [
    [
      "row_id", "event_type_id", "event_type_dimension", "origin_type", "source", "date_min", "date_max",
      "model_a_id", "model_a_name", "model_b_id", "model_b_name", "n_overlap", "n_dates",
      ...metricIds.flatMap((metric) => [metric, `${metric}_dependence_direction`, `${metric}_reason`]),
      "high_loss_rate_a", "high_loss_rate_b", "joint_high_loss_rate", "joint_high_loss_count", "mean_bi_gap", "near_bi",
    ],
    ...pairs.map((pair) => [
      pair.row_id,
      eventData.event_type.id,
      eventRef?.dimension ?? "topic",
      eventData.scope.origin_type,
      eventData.scope.source,
      eventData.sample.date_min,
      eventData.sample.date_max,
      pair.a,
      modelNames.get(pair.a) ?? pair.a,
      pair.b,
      modelNames.get(pair.b) ?? pair.b,
      pair.n_overlap,
      pair.n_dates,
      ...metricIds.flatMap((metric) => [pair.metrics[metric].value ?? "", `${MODEL_DEPENDENCE_DIRECTION[metric]}=higher_model_dependence`, pair.metrics[metric].reason ?? ""]),
      pair.diagnostics.high_loss_rate_a ?? "",
      pair.diagnostics.high_loss_rate_b ?? "",
      pair.diagnostics.joint_high_loss_rate ?? "",
      pair.diagnostics.joint_high_loss_count ?? "",
      pair.diagnostics.mean_bi_gap ?? "",
      pair.diagnostics.near_bi ?? "",
    ]),
  ];
  return rows;
}

function downloadPairs(pairs: PairMetrics[], appData: AppData, eventData: EventTypeData) {
  const rows = pairCsvRows(pairs, appData, eventData);
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `forecastbench_${eventData.event_type.id}_pair_metrics.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [appData, setAppData] = useState<AppData | null>(null);
  const [eventData, setEventData] = useState<EventTypeData | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selectedPair, setSelectedPair] = useState<PairMetrics | null>(null);
  const [error, setError] = useState("");
  const [loadingSlice, setLoadingSlice] = useState(true);
  const [crossTypeData, setCrossTypeData] = useState<CrossTypeData | null>(null);
  const [crossTypeLoading, setCrossTypeLoading] = useState(true);
  const [crossTypeError, setCrossTypeError] = useState("");
  const [globalBaselineData, setGlobalBaselineData] = useState<GlobalBaselineData | null>(null);
  const [globalBaselineLoading, setGlobalBaselineLoading] = useState(true);
  const [globalBaselineError, setGlobalBaselineError] = useState("");

  useEffect(() => {
    loadAppData().then(setAppData).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    loadCrossTypeData()
      .then(setCrossTypeData)
      .catch((reason: Error) => setCrossTypeError(reason.message))
      .finally(() => setCrossTypeLoading(false));
  }, []);

  useEffect(() => {
    loadGlobalBaselineData()
      .then(setGlobalBaselineData)
      .catch((reason: Error) => setGlobalBaselineError(reason.message))
      .finally(() => setGlobalBaselineLoading(false));
  }, []);

  useEffect(() => {
    if (!appData) return;
    const available = appData.manifest.event_types.find((item) => item.id === filters.eventType) ?? appData.manifest.event_types[0];
    if (!available) return;
    if (available.id !== filters.eventType) {
      setFilters((current) => ({ ...current, eventType: available.id }));
      return;
    }
    let active = true;
    setLoadingSlice(true);
    loadEventType(available.file)
      .then((data) => {
        if (!active) return;
        setEventData(data);
        setSelectedPair(null);
        setLoadingSlice(false);
      })
      .catch((reason: Error) => {
        if (!active) return;
        setError(reason.message);
        setLoadingSlice(false);
      });
    return () => { active = false; };
  }, [appData, filters.eventType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("type", filters.eventType);
    params.set("metric", filters.metric);
    if (filters.model) params.set("model", filters.model);
    if (filters.provider !== "all") params.set("provider", filters.provider);
    params.set("min_n", String(filters.minOverlap));
    params.set("near_bi", filters.nearBi ? "1" : "0");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [filters]);

  const eligibleModels = useMemo(() => {
    if (!appData || !eventData) return [];
    return appData.models
      .filter((model) => eventData.models.includes(model.id))
      .filter((model) => filters.provider === "all" || model.provider === filters.provider)
      .sort((a, b) => a.release_order - b.release_order || a.name.localeCompare(b.name));
  }, [appData, eventData, filters.provider]);

  const visiblePairs = useMemo(() => {
    if (!eventData) return [];
    const modelIds = new Set(eligibleModels.map((model) => model.id));
    return eventData.pairs.filter((pair) =>
      modelIds.has(pair.a) && modelIds.has(pair.b) &&
      pair.n_overlap >= filters.minOverlap &&
      (!filters.nearBi || pair.diagnostics.near_bi === true) &&
      (!filters.model || pair.a === filters.model || pair.b === filters.model)
    );
  }, [eventData, filters.minOverlap, filters.model, filters.nearBi, eligibleModels]);

  const heatmapModels = useMemo(() => {
    const coverage = new Map<string, number>();
    for (const pair of visiblePairs) {
      coverage.set(pair.a, (coverage.get(pair.a) ?? 0) + pair.n_overlap);
      coverage.set(pair.b, (coverage.get(pair.b) ?? 0) + pair.n_overlap);
    }
    const ranked = [...eligibleModels].sort((a, b) => (coverage.get(b.id) ?? 0) - (coverage.get(a.id) ?? 0));
    if (!filters.model) return ranked.slice(0, 30).sort((a, b) => a.release_order - b.release_order || a.name.localeCompare(b.name));
    const focus = eligibleModels.find((model) => model.id === filters.model);
    const partners = ranked.filter((model) => model.id !== filters.model).slice(0, 29);
    return [...(focus ? [focus] : []), ...partners].sort((a, b) => a.release_order - b.release_order || a.name.localeCompare(b.name));
  }, [eligibleModels, filters.model, visiblePairs]);

  const heatmapPairs = useMemo(() => {
    const ids = new Set(heatmapModels.map((model) => model.id));
    return visiblePairs.filter((pair) => ids.has(pair.a) && ids.has(pair.b));
  }, [heatmapModels, visiblePairs]);

  if (error) {
    return <main className="fatal"><p className="eyebrow">DATA LOAD ERROR</p><h1>Page data could not be loaded</h1><p>{error}</p></main>;
  }
  if (!appData || !eventData) {
    return <main className="loading"><div className="loading-mark">FB</div><p>Loading dependence atlas…</p></main>;
  }

  const rawMetric = appData.manifest.metrics.find((item) => item.id === filters.metric) ?? appData.manifest.metrics[0];
  const metric = orientMetricToDependence(rawMetric);
  const eventRef = appData.manifest.event_types.find((item) => item.id === filters.eventType) ?? appData.manifest.event_types[0];
  const providers = [...new Set(appData.models.map((model) => model.provider))];
  const profileModel = filters.model || heatmapModels[0]?.id || "";

  function selectPair(pair: PairMetrics) {
    setSelectedPair(pair);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ForecastBench Event-type Dependence Atlas home">
          <span className="brand-orbit" aria-hidden="true"><i /></span>
          <span><strong>ForecastBench</strong><small>DEPENDENCE ATLAS</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <a className="active" href="#matrix">Matrix</a><a href="#global">Global</a><a href="#stability">Stability</a><a href="#ranking">Model pairs</a><a href="#model-view">Model view</a><a href="#methods">Methodology</a><a href="#audit">Audit</a>
        </nav>
        <div className="build-state"><i /> {appData.manifest.fixture ? "Sample build" : "Verified build"}</div>
      </header>

      <main id="top">
        <section className="page-intro">
          <div className="intro-heading">
            <p className="eyebrow">FORECASTBENCH · DEPENDENCE ATLAS</p>
            <h1>Forecast Model<br />Dependence Atlas</h1>
            <p className="intro-copy">Compare model pairs across event types through three dependence metrics. Purple consistently indicates higher model dependence; taxonomy, sample thresholds, and missing values remain fully auditable.</p>
          </div>
          <dl className="dataset-stamp">
            <div><dt>OFFICIAL TARGETS</dt><dd>{appData.manifest.source_snapshot.official_targets.toLocaleString()}</dd></div>
            <div><dt>UNIQUE EVENTS</dt><dd>{appData.manifest.source_snapshot.unique_events.toLocaleString()}</dd></div>
            <div><dt>EXACT MODELS</dt><dd>{appData.models.length.toLocaleString()}</dd></div>
            <div><dt>ANALYSIS SLICES</dt><dd>{appData.manifest.event_types.length.toLocaleString()}</dd></div>
            <div className="dataset-version"><dt>DATASET VERSION</dt><dd>{appData.manifest.dataset_version}</dd></div>
          </dl>
        </section>

        {appData.manifest.fixture && (
          <div className="fixture-notice" role="status"><strong>SAMPLE DATA</strong><span>The interface, schema, and audit trail are ready. Values currently come from a front-end fixture; this notice disappears automatically once derived JSON is connected.</span></div>
        )}

        <section className="filter-dock" aria-label="Analysis filters">
          <label><span>EVENT TYPE</span><select aria-label="Event type" value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}>{appData.manifest.event_types.map((item) => <option value={item.id} key={item.id}>[{item.dimension ?? "topic"}] {item.label_en}</option>)}</select></label>
          <label><span>METRIC</span><select aria-label="Metric" value={filters.metric} onChange={(event) => setFilters({ ...filters, metric: event.target.value as MetricId })}>{appData.manifest.metrics.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label><span>MODEL</span><select aria-label="Model" value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })}><option value="">All models</option>{appData.models.filter((model) => eventData.models.includes(model.id)).map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
          <label><span>PROVIDER</span><select aria-label="Provider" value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value, model: "" })}><option value="all">All providers</option>{providers.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>
          <label className="range-label"><span>MIN OVERLAP <b>{filters.minOverlap}</b></span><input aria-label="Minimum overlap" type="range" min="50" max="250" step="25" value={filters.minOverlap} onChange={(event) => setFilters({ ...filters, minOverlap: Number(event.target.value) })} /></label>
          <label className="check-label"><input type="checkbox" checked={filters.nearBi} onChange={(event) => setFilters({ ...filters, nearBi: event.target.checked })} /><span>Near-BI only</span></label>
        </section>

        <section className={`matrix-section ${loadingSlice ? "is-loading" : ""}`} id="matrix">
          <div className="section-heading">
            <div><p className="eyebrow">PAIRWISE MATRIX · {eventRef.label_en.toUpperCase()}</p><h2>{metric.label}</h2></div>
            <p>{METRIC_DESCRIPTIONS[metric.id]} The heatmap shows the {heatmapModels.length} highest-coverage models out of {eligibleModels.length}, ordered from earliest to latest release; {visiblePairs.length.toLocaleString()} model pairs meet the active filters.</p>
          </div>
          <div className="matrix-layout">
            <div>
              <div className="legend"><span>Lower model dependence</span><i className="legend-gradient" /><span>Higher model dependence</span></div>
              <Heatmap models={heatmapModels} pairs={heatmapPairs} metric={metric} selectedModel={filters.model} selectedPair={selectedPair} onSelectPair={selectPair} />
            </div>
          </div>
        </section>

        <GlobalBaseline data={globalBaselineData} models={appData.models} loading={globalBaselineLoading} error={globalBaselineError} />

        <CrossTypeStability data={crossTypeData} loading={crossTypeLoading} error={crossTypeError} />

        <section className="ranking-section" id="ranking">
          <div className="section-heading">
            <div><p className="eyebrow">MODEL DEPENDENCE ORDER</p><h2>Model pair ranking</h2></div>
            <button type="button" className="download-button" onClick={() => downloadPairs(visiblePairs, appData, eventData)}>Download current CSV ↓</button>
          </div>
          <PairRanking pairs={visiblePairs} metric={metric} models={appData.models} selectedPair={selectedPair} onSelectPair={selectPair} />
        </section>

        <ModelProfile modelId={profileModel} pairs={visiblePairs} models={appData.models} manifest={appData.manifest} onSelectPair={selectPair} />

        <section className="method-section" id="methods">
          <div className="section-heading">
            <div><p className="eyebrow">THREE COMPLEMENTARY LENSES</p><h2>These metrics are not interchangeable</h2></div>
            <p>Each metric answers a different question. We report them separately and do not present ex post complementarity as deployable aggregation gain.</p>
          </div>
          <div className="method-list">
            {appData.manifest.metrics.map((item, index) => (
              <article key={item.id}><span>0{index + 1}</span><h3>{item.label}</h3><p>{METRIC_DESCRIPTIONS[item.id]}</p><small>{dependenceDirectionLabel(item.id)}</small></article>
            ))}
          </div>
        </section>

        <section className="audit-section" id="audit">
          <div className="section-heading">
            <div><p className="eyebrow">PROVENANCE & QUALITY</p><h2>Taxonomy & audit</h2></div>
            <p>Topic is a derived semantic layer. Dataset / Market and official source remain official structural dimensions, so source effects are not mistaken for topic effects.</p>
          </div>
          <div className="audit-layout">
            <div className="taxonomy-list">
              {appData.taxonomy.categories.map((category) => (
                <div key={category.id}><span>{category.label_en}</span><p>{TOPIC_DEFINITIONS[category.id] ?? "Definition not available in English."}</p><strong>{category.n_unique_events.toLocaleString()} events</strong></div>
              ))}
            </div>
            <aside className="audit-log">
              <header><span className={`status-dot ${appData.audit.status}`} /> <strong>{appData.audit.status.toUpperCase()}</strong><small>{appData.audit.generated_at.slice(0, 10)}</small></header>
              {appData.audit.checks.map((check) => <div key={check.id}><span className={`status-dot ${check.status}`} /><p><strong>{check.label}</strong><small>{check.detail}</small></p></div>)}
              <div className="missing-audit"><span className={`status-dot ${(eventData.missing_summary ?? []).length ? "warn" : "pass"}`} /><p><strong>Current-slice missing cells</strong><small>{(eventData.missing_summary ?? []).length ? eventData.missing_summary.map((item) => `${item.reason}: ${item.count}`).join(" · ") : "No missing model-pair cells reported."}</small></p></div>
              <dl><div><dt>Default min overlap</dt><dd>{appData.audit.thresholds.min_overlap_default}</dd></div><div><dt>Near-BI max gap</dt><dd>{appData.audit.thresholds.near_bi_max_gap}</dd></div><div><dt>High-loss threshold</dt><dd>{appData.audit.thresholds.high_loss_threshold}</dd></div></dl>
            </aside>
          </div>
        </section>
      </main>

      <footer>
        <span>ForecastBench Event-type Dependence Atlas</span>
        <span>Derived with changes from <a href="https://huggingface.co/datasets/forecastingresearch/forecastbench-datasets">ForecastBench data</a> by the Forecasting Research Institute · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></span>
        <span>Schema {appData.manifest.schema_version} · Metric {appData.manifest.metric_version} · Taxonomy {appData.manifest.taxonomy_version}</span>
      </footer>
    </div>
  );
}
