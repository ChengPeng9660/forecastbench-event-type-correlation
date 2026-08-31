import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Heatmap } from "./components/Heatmap";
import { CrossTypeStability } from "./components/CrossTypeStability";
import { PairAggregationExplorer } from "./components/PairAggregationExplorer";
import { PolymarketAggregationExplorer } from "./components/PolymarketAggregationExplorer";
import { FreezeMarketCorrelationExplorer } from "./components/FreezeMarketCorrelationExplorer";
import { MarketDiversityPerformanceExplorer } from "./components/MarketDiversityPerformanceExplorer";
import { UpperLeftModelPairAggregationExplorer } from "./components/UpperLeftModelPairAggregationExplorer";
import { WithoutFreezeBaseExplorer } from "./components/WithoutFreezeBaseExplorer";
import { FixedFocalWithoutFreezeExplorer } from "./components/FixedFocalWithoutFreezeExplorer";
import { GlobalBaseline } from "./components/GlobalBaseline";
import { ModelProfile } from "./components/ModelProfile";
import { ModelMultiSelect } from "./components/ModelMultiSelect";
import { PairRanking } from "./components/PairRanking";
import { ResearchHeader, ResearchMasthead, ResearchPanel, ResearchPending } from "./components/ResearchShell";
import { ResearchOverview } from "./components/ResearchOverview";
import { researchPageFromHash, researchGroupFor, usesAtlasFilters, type ResearchPage } from "./lib/navigation";
import { useHistoryRestore } from "./lib/useHistoryRestore";
import { loadAppData, loadCrossTypeData, loadEventType, loadFixedFocalWithoutFreezeData, loadFreezeMarketCorrelationData, loadGlobalBaselineData, loadMarketDiversityPerformanceData, loadPairAggregationData, loadPolymarketAggregationData, loadUpperLeftModelPairAggregationData, loadWithoutFreezeBaseData } from "./lib/data";
import { dependenceDirectionLabel, MODEL_DEPENDENCE_DIRECTION, orientMetricToDependence } from "./lib/metrics";
import type { AppData, CrossTypeData, EventTypeData, FixedBaseAggregationData, FixedFocalWithoutFreezeData, FreezeMarketCorrelationData, GlobalBaselineData, MarketDiversityPerformanceData, MetricId, PairAggregationData, PairMetrics, PolymarketAggregationData, UpperLeftModelPairAggregationData } from "./types/data";

const ComplementarityExplorer = lazy(() => import("./components/ComplementarityExplorer"));

interface Filters {
  eventType: string;
  metric: MetricId;
  model: string;
  provider: string;
  minOverlap: number;
  nearBi: boolean;
  heatmapModels: string[];
}

function filtersFromQuery(query: URLSearchParams): Filters {
  return {
  eventType: query.get("type") ?? "",
  metric: (query.get("metric") as MetricId) ?? "adjusted_pog",
  model: query.get("model") ?? "",
  provider: query.get("provider") ?? "all",
  minOverlap: Number(query.get("min_n") ?? 50),
  nearBi: query.get("near_bi") !== "0",
  heatmapModels: [...new Set((query.get("heatmap_models") ?? "").split(",").filter(Boolean))].slice(0, 30),
  };
}

const METRIC_DESCRIPTIONS: Record<MetricId, string> = {
  adjusted_pog: "Measures whether two models excel on different questions. Lower gain means higher model dependence; larger gain indicates more ex post complementarity.",
  high_loss_lift: "Shared adjusted-loss exceedances relative to their marginal rates. Higher lift means greater severe-error dependence; 1 is the independence reference, not proof of independence. Rare high-loss records can make lift unstable.",
  adjusted_loss_corr: "Measures alignment in question-level difficulty-adjusted Brier losses. Higher correlation means higher model dependence.",
  total_variation: "Mean absolute probability difference on shared questions: mean |p − q|. Ranges from 0 to 1; higher TV means greater prediction diversity, not necessarily better aggregation.",
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
  const [activePage, setActivePage] = useState<ResearchPage>(() => researchPageFromHash(window.location.hash));
  const [visitedPages, setVisitedPages] = useState<Set<ResearchPage>>(() => new Set([researchPageFromHash(window.location.hash)]));
  const [appData, setAppData] = useState<AppData | null>(null);
  const [eventData, setEventData] = useState<EventTypeData | null>(null);
  const [filters, setFilters] = useState<Filters>(() => filtersFromQuery(new URLSearchParams(window.location.search)));
  const [selectedPair, setSelectedPair] = useState<PairMetrics | null>(null);
  const [error, setError] = useState("");
  const [loadingSlice, setLoadingSlice] = useState(true);
  const [crossTypeData, setCrossTypeData] = useState<CrossTypeData | null>(null);
  const [crossTypeLoading, setCrossTypeLoading] = useState(true);
  const [crossTypeError, setCrossTypeError] = useState("");
  const [globalBaselineData, setGlobalBaselineData] = useState<GlobalBaselineData | null>(null);
  const [globalBaselineLoading, setGlobalBaselineLoading] = useState(true);
  const [globalBaselineError, setGlobalBaselineError] = useState("");
  const [pairAggregationData, setPairAggregationData] = useState<PairAggregationData | null>(null);
  const [pairAggregationError, setPairAggregationError] = useState("");
  const [polymarketAggregationData, setPolymarketAggregationData] = useState<PolymarketAggregationData | null>(null);
  const [polymarketAggregationError, setPolymarketAggregationError] = useState("");
  const [freezeMarketCorrelationData, setFreezeMarketCorrelationData] = useState<FreezeMarketCorrelationData | null>(null);
  const [freezeMarketCorrelationError, setFreezeMarketCorrelationError] = useState("");
  const [marketDiversityPerformanceData, setMarketDiversityPerformanceData] = useState<MarketDiversityPerformanceData | null>(null);
  const [marketDiversityPerformanceError, setMarketDiversityPerformanceError] = useState("");
  const [upperLeftPairData, setUpperLeftPairData] = useState<UpperLeftModelPairAggregationData | null>(null);
  const [upperLeftPairError, setUpperLeftPairError] = useState("");
  const [withoutFreezeBaseData, setWithoutFreezeBaseData] = useState<FixedBaseAggregationData | null>(null);
  const [withoutFreezeBaseError, setWithoutFreezeBaseError] = useState("");
  const [fixedFocalWithoutFreezeData, setFixedFocalWithoutFreezeData] = useState<FixedFocalWithoutFreezeData | null>(null);
  const [fixedFocalWithoutFreezeError, setFixedFocalWithoutFreezeError] = useState("");
  useHistoryRestore((params) => setFilters(filtersFromQuery(params)));

  useEffect(() => {
    const followLocation = () => {
      const page = researchPageFromHash(window.location.hash);
      setVisitedPages((current) => new Set([...current, page]));
      setActivePage(page);
    };
    window.addEventListener("hashchange", followLocation);
    window.addEventListener("popstate", followLocation);
    return () => {
      window.removeEventListener("hashchange", followLocation);
      window.removeEventListener("popstate", followLocation);
    };
  }, []);

  useEffect(() => {
    const group = researchGroupFor(activePage);
    document.title = `${activePage === "complementarity" ? "Complementarity · " : group ? `${group.label} · ` : ""}ForecastBench Research Atlas`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activePage]);

  function navigate(page: ResearchPage) {
    if (page !== activePage) window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#${page}`);
    setVisitedPages((current) => new Set([...current, page]));
    setActivePage(page);
    document.getElementById("top")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  useEffect(() => {
    loadAppData().then(setAppData).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (activePage !== "stability" || crossTypeData || crossTypeError) return;
    loadCrossTypeData()
      .then(setCrossTypeData)
      .catch((reason: Error) => setCrossTypeError(reason.message))
      .finally(() => setCrossTypeLoading(false));
  }, [activePage, crossTypeData, crossTypeError]);

  useEffect(() => {
    if (activePage !== "global" || globalBaselineData || globalBaselineError) return;
    loadGlobalBaselineData()
      .then(setGlobalBaselineData)
      .catch((reason: Error) => setGlobalBaselineError(reason.message))
      .finally(() => setGlobalBaselineLoading(false));
  }, [activePage, globalBaselineData, globalBaselineError]);

  useEffect(() => {
    if (activePage !== "gain" || pairAggregationData || pairAggregationError) return;
    loadPairAggregationData().then(setPairAggregationData).catch((reason: Error) => setPairAggregationError(reason.message));
  }, [activePage, pairAggregationData, pairAggregationError]);

  useEffect(() => {
    if (activePage !== "polymarket-aggregation" || polymarketAggregationData || polymarketAggregationError) return;
    loadPolymarketAggregationData().then(setPolymarketAggregationData).catch((reason: Error) => setPolymarketAggregationError(reason.message));
  }, [activePage, polymarketAggregationData, polymarketAggregationError]);

  useEffect(() => {
    if (activePage !== "freeze-correlation" || freezeMarketCorrelationData || freezeMarketCorrelationError) return;
    loadFreezeMarketCorrelationData().then(setFreezeMarketCorrelationData).catch((reason: Error) => setFreezeMarketCorrelationError(reason.message));
  }, [activePage, freezeMarketCorrelationData, freezeMarketCorrelationError]);

  useEffect(() => {
    if (activePage !== "market-performance" || marketDiversityPerformanceData || marketDiversityPerformanceError) return;
    loadMarketDiversityPerformanceData().then(setMarketDiversityPerformanceData).catch((reason: Error) => setMarketDiversityPerformanceError(reason.message));
  }, [activePage, marketDiversityPerformanceData, marketDiversityPerformanceError]);

  useEffect(() => {
    if (activePage !== "upper-left-pairs" || upperLeftPairData || upperLeftPairError) return;
    loadUpperLeftModelPairAggregationData().then(setUpperLeftPairData).catch((reason: Error) => setUpperLeftPairError(reason.message));
  }, [activePage, upperLeftPairData, upperLeftPairError]);

  useEffect(() => {
    if (activePage !== "without-freeze-base" || withoutFreezeBaseData || withoutFreezeBaseError) return;
    loadWithoutFreezeBaseData().then(setWithoutFreezeBaseData).catch((reason: Error) => setWithoutFreezeBaseError(reason.message));
  }, [activePage, withoutFreezeBaseData, withoutFreezeBaseError]);

  useEffect(() => {
    if (activePage !== "fixed-focal-no-freeze" || fixedFocalWithoutFreezeData || fixedFocalWithoutFreezeError) return;
    loadFixedFocalWithoutFreezeData().then(setFixedFocalWithoutFreezeData).catch((reason: Error) => setFixedFocalWithoutFreezeError(reason.message));
  }, [activePage, fixedFocalWithoutFreezeData, fixedFocalWithoutFreezeError]);

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
    else params.delete("model");
    if (filters.provider !== "all") params.set("provider", filters.provider);
    else params.delete("provider");
    params.set("min_n", String(filters.minOverlap));
    params.set("near_bi", filters.nearBi ? "1" : "0");
    if (filters.heatmapModels.length) params.set("heatmap_models", filters.heatmapModels.join(","));
    else params.delete("heatmap_models");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [filters]);

  const eligibleModels = useMemo(() => {
    if (!appData || !eventData) return [];
    return appData.models
      .filter((model) => eventData.models.includes(model.id))
      .filter((model) => filters.provider === "all" || model.provider === filters.provider)
      .sort((a, b) => a.release_order - b.release_order || a.name.localeCompare(b.name));
  }, [appData, eventData, filters.provider]);

  const eligiblePairs = useMemo(() => {
    if (!eventData) return [];
    const modelIds = new Set(eligibleModels.map((model) => model.id));
    return eventData.pairs.filter((pair) =>
      modelIds.has(pair.a) && modelIds.has(pair.b) &&
      pair.n_overlap >= filters.minOverlap &&
      (!filters.nearBi || pair.diagnostics.near_bi === true)
    );
  }, [eventData, filters.minOverlap, filters.nearBi, eligibleModels]);

  const visiblePairs = useMemo(() => eligiblePairs.filter((pair) =>
    !filters.model || pair.a === filters.model || pair.b === filters.model
  ), [eligiblePairs, filters.model]);

  const heatmapModels = useMemo(() => {
    if (filters.heatmapModels.length) {
      const selectedIds = new Set(filters.heatmapModels);
      return eligibleModels.filter((model) => selectedIds.has(model.id));
    }
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
  }, [eligibleModels, filters.heatmapModels, filters.model, visiblePairs]);

  const heatmapPairs = useMemo(() => {
    const ids = new Set(heatmapModels.map((model) => model.id));
    const sourcePairs = filters.heatmapModels.length ? eligiblePairs : visiblePairs;
    return sourcePairs.filter((pair) => ids.has(pair.a) && ids.has(pair.b));
  }, [eligiblePairs, filters.heatmapModels.length, heatmapModels, visiblePairs]);

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
    <div className="app-shell public-research">
      <a className="skip-link" href="#top" onClick={(event) => { event.preventDefault(); document.getElementById("top")?.focus(); }}>Skip to content</a>
      <ResearchHeader page={activePage} onNavigate={navigate} />

      <main id="top" tabIndex={-1}>
        {activePage === "overview" && <ResearchOverview appData={appData} models={eligibleModels} pairs={visiblePairs} metric={metric} eventLabel={eventRef.label_en} nearBi={filters.nearBi} onNavigate={navigate} />}
        <ResearchMasthead page={activePage} onNavigate={navigate} />

        {appData.manifest.fixture && (
          <div className="fixture-notice" role="status"><strong>SAMPLE DATA</strong><span>The interface, schema, and audit trail are ready. Values currently come from a front-end fixture; this notice disappears automatically once derived JSON is connected.</span></div>
        )}

        {usesAtlasFilters(activePage) && <section className="filter-dock" aria-label="Analysis filters">
          <label><span>EVENT TYPE</span><select aria-label="Event type" value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}>{["topic", "origin_type", "official_source"].map((dimension) => <optgroup key={dimension} label={dimension === "topic" ? "Event topics" : dimension === "origin_type" ? "Question origin" : "Official sources"}>{appData.manifest.event_types.filter((item) => (item.dimension ?? "topic") === dimension).map((item) => <option value={item.id} key={item.id}>{item.label_en}</option>)}</optgroup>)}</select></label>
          <label><span>METRIC</span><select aria-label="Metric" value={filters.metric} onChange={(event) => setFilters({ ...filters, metric: event.target.value as MetricId })}>{appData.manifest.metrics.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <ModelMultiSelect models={appData.models} selectedIds={filters.heatmapModels} onChange={(heatmapModels) => { setFilters({ ...filters, heatmapModels }); setSelectedPair(null); }} />
          <label className="check-label"><input type="checkbox" checked={filters.nearBi} onChange={(event) => setFilters({ ...filters, nearBi: event.target.checked })} /><span>Near-BI only</span></label>
          <details className="atlas-filter-details">
            <summary>More filters <span>{filters.provider !== "all" ? `${filters.provider} · ` : ""}{filters.model ? "Focal model selected · " : ""}Min. overlap {filters.minOverlap}</span></summary>
            <div className="atlas-advanced-filters">
              <label><span>FOCAL MODEL</span><select aria-label="Focal model" value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })}><option value="">All models</option>{appData.models.filter((model) => eventData.models.includes(model.id)).map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
              <label><span>PROVIDER</span><select aria-label="Provider" value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value, model: "" })}><option value="all">All providers</option>{providers.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>
              <label className="range-label"><span>MIN OVERLAP <b>{filters.minOverlap}</b></span><input aria-label="Minimum overlap" type="range" min="50" max="250" step="25" value={filters.minOverlap} onChange={(event) => setFilters({ ...filters, minOverlap: Number(event.target.value) })} /></label>
            </div>
          </details>
        </section>}

        <ResearchPanel page="matrix" active={activePage} visited={visitedPages}>
        <section className={`matrix-section ${loadingSlice ? "is-loading" : ""}`} id="matrix">
          <div className="section-heading">
            <div><p className="eyebrow">PAIRWISE MATRIX · {eventRef.label_en.toUpperCase()}</p><h2>{metric.label}</h2></div>
            <p>{heatmapModels.length} models · {visiblePairs.length.toLocaleString()} eligible pairs<br />Ordered by release date. Select a cell to highlight a pair.</p>
          </div>
          <div className="matrix-layout">
            <div>
              <div className="legend"><span>Lower diversity</span><i className="legend-gradient" /><span>Higher diversity</span></div>
              <Heatmap models={heatmapModels} pairs={heatmapPairs} metric={metric} selectedModel={filters.model} selectedPair={selectedPair} onSelectPair={selectPair} />
            </div>
          </div>
          <details className="research-details"><summary>About this matrix</summary><div><p>{METRIC_DESCRIPTIONS[metric.id]} {filters.heatmapModels.length ? "Only your selected models are shown." : "The matrix displays up to 30 highest-coverage models under the current filters."} Purple is oriented toward greater diversity. Missing cells are not estimates of zero.</p><p>Near-BI limits comparisons to models with similar difficulty-adjusted Brier performance. This descriptive matrix does not measure out-of-sample aggregation gain.</p></div></details>
        </section>
        </ResearchPanel>

        <ResearchPanel page="complementarity" active={activePage} visited={visitedPages}>
          <Suspense fallback={<ResearchPending id="complementarity" />}><ComplementarityExplorer /></Suspense>
        </ResearchPanel>

        <ResearchPanel page="gain" active={activePage} visited={visitedPages}>
        {pairAggregationData ? <PairAggregationExplorer
          data={pairAggregationData}
          active={activePage === "gain"}
          nearBiOnly={filters.nearBi}
          onNearBiOnlyChange={(nearBi) => setFilters((current) => ({ ...current, nearBi }))}
        /> : <ResearchPending id="gain" error={pairAggregationError} />}
        </ResearchPanel>

        <ResearchPanel page="polymarket-aggregation" active={activePage} visited={visitedPages}>
        {polymarketAggregationData ? <PolymarketAggregationExplorer data={polymarketAggregationData} /> : <ResearchPending id="polymarket-aggregation" error={polymarketAggregationError} />}
        </ResearchPanel>

        <ResearchPanel page="market-performance" active={activePage} visited={visitedPages}>
        {marketDiversityPerformanceData ? <MarketDiversityPerformanceExplorer data={marketDiversityPerformanceData} /> : <ResearchPending id="market-performance" error={marketDiversityPerformanceError} />}
        </ResearchPanel>

        <ResearchPanel page="upper-left-pairs" active={activePage} visited={visitedPages}>
        {upperLeftPairData ? <UpperLeftModelPairAggregationExplorer data={upperLeftPairData} /> : <ResearchPending id="upper-left-pairs" error={upperLeftPairError} />}
        </ResearchPanel>

        <ResearchPanel page="freeze-correlation" active={activePage} visited={visitedPages}>
        {freezeMarketCorrelationData ? <FreezeMarketCorrelationExplorer data={freezeMarketCorrelationData} /> : <ResearchPending id="freeze-correlation" error={freezeMarketCorrelationError} />}
        </ResearchPanel>

        <ResearchPanel page="without-freeze-base" active={activePage} visited={visitedPages}>
        {withoutFreezeBaseData ? <WithoutFreezeBaseExplorer data={withoutFreezeBaseData} /> : <ResearchPending id="without-freeze-base" error={withoutFreezeBaseError} />}
        </ResearchPanel>

        <ResearchPanel page="fixed-focal-no-freeze" active={activePage} visited={visitedPages}>
        {fixedFocalWithoutFreezeData ? <FixedFocalWithoutFreezeExplorer data={fixedFocalWithoutFreezeData} /> : <ResearchPending id="fixed-focal-no-freeze" error={fixedFocalWithoutFreezeError} />}
        </ResearchPanel>

        <ResearchPanel page="global" active={activePage} visited={visitedPages}>
        <div className="global-model-picker"><ModelMultiSelect models={appData.models} selectedIds={filters.heatmapModels} onChange={(heatmapModels) => setFilters((current) => ({ ...current, heatmapModels }))} /><span>Shared with your event-atlas selection</span></div>
        <GlobalBaseline data={globalBaselineData} models={appData.models} heatmapModelIds={filters.heatmapModels} loading={globalBaselineLoading} error={globalBaselineError} />
        </ResearchPanel>

        <ResearchPanel page="stability" active={activePage} visited={visitedPages}>
        <CrossTypeStability data={crossTypeData} loading={crossTypeLoading} error={crossTypeError} />
        </ResearchPanel>

        <ResearchPanel page="ranking" active={activePage} visited={visitedPages}>
        <section className="ranking-section" id="ranking">
          <div className="section-heading">
            <div><p className="eyebrow">MODEL DEPENDENCE ORDER</p><h2>Model pair ranking</h2></div>
            <button type="button" className="download-button" onClick={() => downloadPairs(visiblePairs, appData, eventData)}>Download current CSV ↓</button>
          </div>
          <PairRanking pairs={visiblePairs} metric={metric} models={appData.models} selectedPair={selectedPair} onSelectPair={selectPair} />
        </section>
        </ResearchPanel>

        <ResearchPanel page="model-view" active={activePage} visited={visitedPages}>
        <ModelProfile modelId={profileModel} pairs={visiblePairs} models={appData.models} manifest={appData.manifest} onSelectPair={selectPair} />
        </ResearchPanel>

        <ResearchPanel page="methods" active={activePage} visited={visitedPages}>
        <section className="method-section" id="methods">
          <div className="section-heading">
            <div><p className="eyebrow">MEASURING DIVERSITY</p><h2>Four complementary lenses</h2></div>
            <p>Shared errors, loss alignment, oracle complementarity, and probability differences answer different questions.</p>
          </div>
          <div className="method-list">
            {appData.manifest.metrics.map((item, index) => (
              <article key={item.id}><span>0{index + 1}</span><h3>{item.label}</h3><p>{METRIC_DESCRIPTIONS[item.id]}</p><small>{dependenceDirectionLabel(item.id)}</small></article>
            ))}
          </div>
          <div className="evaluation-principles">
            <article><h3>Held-out evaluation</h3><p>Cross-fit experiments split events into disjoint A/B folds, swap train and test, and average across ten reproducible splits. Training data supplies dependence estimates and fitted parameters; the opposite fold supplies performance. Random cross-fit is internal out-of-sample evaluation, not a chronological deployment test.</p></article>
            <article><h3>Matched market comparisons</h3><p>Market-comparison blocks use only market questions with valid freeze-time Polymarket probabilities. Each model or pair is compared with the market on identical test support. Dataset-only questions are excluded.</p></article>
            <article><h3>Read scores in the right direction</h3><p>Lower Brier score is better; higher Brier Index is better. Fractional gain measures Brier reduction relative to the named base. Best Single is a hindsight benchmark, not a deployable selection rule. Correlations alone do not establish a causal effect of diversity.</p></article>
          </div>
          <a className="research-text-link" href="https://github.com/ChengPeng9660/forecastbench-event-type-correlation/tree/main/docs" target="_blank" rel="noreferrer">Full methodology & experiment records ↗</a>
        </section>
        </ResearchPanel>

        <ResearchPanel page="audit" active={activePage} visited={visitedPages}>
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
          <dl className="audit-version-line"><div><dt>Dataset</dt><dd>{appData.manifest.dataset_version}</dd></div><div><dt>Metric version</dt><dd>{appData.manifest.metric_version}</dd></div><div><dt>Taxonomy</dt><dd>{appData.manifest.taxonomy_version}</dd></div></dl>
        </section>
        </ResearchPanel>
      </main>

      <footer className="research-footer">
        <div><strong>ForecastBench Research Atlas</strong><p>Independent research into forecast diversity and aggregation.</p></div>
        <div className="research-footer-links"><a href="https://github.com/ChengPeng9660/forecastbench-event-type-correlation" target="_blank" rel="noreferrer">GitHub ↗</a><a href="https://huggingface.co/datasets/forecastingresearch/forecastbench-datasets" target="_blank" rel="noreferrer">Source data ↗</a><a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0 ↗</a></div>
        <p className="research-attribution">Derived with changes from ForecastBench data by the Forecasting Research Institute.</p>
      </footer>
    </div>
  );
}
