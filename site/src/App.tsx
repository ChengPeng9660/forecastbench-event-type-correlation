import { useEffect, useMemo, useState } from "react";
import { Heatmap } from "./components/Heatmap";
import { ModelProfile } from "./components/ModelProfile";
import { PairInspector } from "./components/PairInspector";
import { PairRanking } from "./components/PairRanking";
import { loadAppData, loadEventType } from "./lib/data";
import type { AppData, EventTypeData, MetricId, PairMetrics } from "./types/data";

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

function downloadPairs(pairs: PairMetrics[], appData: AppData, eventData: EventTypeData) {
  const metricIds = appData.manifest.metrics.map((metric) => metric.id);
  const modelNames = new Map(appData.models.map((model) => [model.id, model.name]));
  const eventRef = appData.manifest.event_types.find((item) => item.id === eventData.event_type.id);
  const rows = [
    [
      "row_id", "event_type_id", "event_type_dimension", "origin_type", "source", "date_min", "date_max",
      "model_a_id", "model_a_name", "model_b_id", "model_b_name", "n_overlap", "n_dates",
      ...metricIds.flatMap((metric) => [metric, `${metric}_reason`]),
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
      ...metricIds.flatMap((metric) => [pair.metrics[metric].value ?? "", pair.metrics[metric].reason ?? ""]),
      pair.diagnostics.high_loss_rate_a ?? "",
      pair.diagnostics.high_loss_rate_b ?? "",
      pair.diagnostics.joint_high_loss_rate ?? "",
      pair.diagnostics.joint_high_loss_count ?? "",
      pair.diagnostics.mean_bi_gap ?? "",
      pair.diagnostics.near_bi ?? "",
    ]),
  ];
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

  useEffect(() => {
    loadAppData().then(setAppData).catch((reason: Error) => setError(reason.message));
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
    const params = new URLSearchParams();
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
      .sort((a, b) => a.release_order - b.release_order);
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
    if (!filters.model) return ranked.slice(0, 30).sort((a, b) => a.release_order - b.release_order);
    const focus = eligibleModels.find((model) => model.id === filters.model);
    const partners = ranked.filter((model) => model.id !== filters.model).slice(0, 29);
    return [...(focus ? [focus] : []), ...partners].sort((a, b) => a.release_order - b.release_order);
  }, [eligibleModels, filters.model, visiblePairs]);

  const heatmapPairs = useMemo(() => {
    const ids = new Set(heatmapModels.map((model) => model.id));
    return visiblePairs.filter((pair) => ids.has(pair.a) && ids.has(pair.b));
  }, [heatmapModels, visiblePairs]);

  if (error) {
    return <main className="fatal"><p className="eyebrow">DATA LOAD ERROR</p><h1>页面数据未能载入</h1><p>{error}</p></main>;
  }
  if (!appData || !eventData) {
    return <main className="loading"><div className="loading-mark">FB</div><p>Loading dependence atlas…</p></main>;
  }

  const metric = appData.manifest.metrics.find((item) => item.id === filters.metric) ?? appData.manifest.metrics[0];
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
          <span className="brand-mark">FB</span>
          <span><strong>ForecastBench</strong><small>EVENT-TYPE DEPENDENCE ATLAS</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#matrix">Matrix</a><a href="#ranking">Pairs</a><a href="#model-view">Models</a><a href="#methods">Methods</a><a href="#audit">Audit</a>
        </nav>
        <div className="build-state"><i /> {appData.manifest.fixture ? "FIXTURE BUILD" : "VERIFIED BUILD"}</div>
      </header>

      <main id="top">
        <section className="page-intro">
          <div>
            <p className="eyebrow">MODEL DEPENDENCE BY EVENT TYPE</p>
            <h1>哪里相似，<br /><em>哪里互补。</em></h1>
          </div>
          <p className="intro-copy">按事件类型比较模型对的三种依赖指标。紫色始终表示更有利于聚合；所有分类、样本阈值和缺失值均可追溯。</p>
          <dl className="dataset-stamp">
            <div><dt>OFFICIAL TARGETS</dt><dd>{appData.manifest.source_snapshot.official_targets.toLocaleString()}</dd></div>
            <div><dt>UNIQUE EVENTS</dt><dd>{appData.manifest.source_snapshot.unique_events.toLocaleString()}</dd></div>
            <div><dt>DATASET</dt><dd>{appData.manifest.dataset_version}</dd></div>
          </dl>
        </section>

        {appData.manifest.fixture && (
          <div className="fixture-notice" role="status"><strong>示例数据</strong><span>界面、schema 与审计链已就绪；当前数值是前端 fixture，真实派生 JSON 接入后此提示会自动消失。</span></div>
        )}

        <section className="filter-dock" aria-label="Analysis filters">
          <label><span>EVENT TYPE</span><select aria-label="Event type" value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}>{appData.manifest.event_types.map((item) => <option value={item.id} key={item.id}>[{item.dimension ?? "topic"}] {item.label_zh} · {item.label_en}</option>)}</select></label>
          <label><span>METRIC</span><select aria-label="Metric" value={filters.metric} onChange={(event) => setFilters({ ...filters, metric: event.target.value as MetricId })}>{appData.manifest.metrics.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label><span>MODEL</span><select aria-label="Model" value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })}><option value="">All models</option>{appData.models.filter((model) => eventData.models.includes(model.id)).map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
          <label><span>PROVIDER</span><select aria-label="Provider" value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value, model: "" })}><option value="all">All providers</option>{providers.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>
          <label className="range-label"><span>MIN OVERLAP <b>{filters.minOverlap}</b></span><input aria-label="Minimum overlap" type="range" min="50" max="250" step="25" value={filters.minOverlap} onChange={(event) => setFilters({ ...filters, minOverlap: Number(event.target.value) })} /></label>
          <label className="check-label"><input type="checkbox" checked={filters.nearBi} onChange={(event) => setFilters({ ...filters, nearBi: event.target.checked })} /><span>Near-BI only</span></label>
        </section>

        <section className={`matrix-section ${loadingSlice ? "is-loading" : ""}`} id="matrix">
          <div className="section-heading">
            <div><p className="eyebrow">PAIRWISE MATRIX · {eventRef.label_en.toUpperCase()}</p><h2>{metric.label}</h2></div>
            <p>{metric.description} 热力图显示 coverage 最高的 {heatmapModels.length} / {eligibleModels.length} 个模型；共 {visiblePairs.length.toLocaleString()} 个模型对满足筛选条件。</p>
          </div>
          <div className="matrix-layout">
            <div>
              <div className="legend"><span>聚合较不利</span><i className="legend-gradient" /><span>聚合较有利</span></div>
              <Heatmap models={heatmapModels} pairs={heatmapPairs} metric={metric} selectedModel={filters.model} selectedPair={selectedPair} onSelectPair={selectPair} />
            </div>
            <PairInspector pair={selectedPair} models={appData.models} manifest={appData.manifest} />
          </div>
        </section>

        <section className="ranking-section" id="ranking">
          <div className="section-heading">
            <div><p className="eyebrow">AGGREGATION-FRIENDLY ORDER</p><h2>模型对排名</h2></div>
            <button type="button" className="download-button" onClick={() => downloadPairs(visiblePairs, appData, eventData)}>Download current CSV ↓</button>
          </div>
          <PairRanking pairs={visiblePairs} metric={metric} models={appData.models} selectedPair={selectedPair} onSelectPair={selectPair} />
        </section>

        <ModelProfile modelId={profileModel} pairs={visiblePairs} models={appData.models} manifest={appData.manifest} onSelectPair={selectPair} />

        <section className="method-section" id="methods">
          <div className="section-heading">
            <div><p className="eyebrow">THREE COMPLEMENTARY LENSES</p><h2>方法不是同义词</h2></div>
            <p>三项指标回答不同问题。页面不合并它们，也不把事后互补性误写成可部署的聚合收益。</p>
          </div>
          <div className="method-list">
            {appData.manifest.metrics.map((item, index) => (
              <article key={item.id}><span>0{index + 1}</span><h3>{item.label}</h3><p>{item.description}</p><small>{item.direction === "higher" ? "HIGHER IS MORE COMPLEMENTARY" : "LOWER IS MORE COMPLEMENTARY"}</small></article>
            ))}
          </div>
        </section>

        <section className="audit-section" id="audit">
          <div className="section-heading">
            <div><p className="eyebrow">PROVENANCE & QUALITY</p><h2>分类与审计</h2></div>
            <p>Topic 是派生语义层；Dataset / Market 与 official source 始终保留为官方结构层，避免把来源效应误读为主题效应。</p>
          </div>
          <div className="audit-layout">
            <div className="taxonomy-list">
              {appData.taxonomy.categories.map((category) => (
                <div key={category.id}><span>{category.label_zh}</span><p>{category.definition}</p><strong>{category.n_unique_events.toLocaleString()} events</strong></div>
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
