import { useEffect, useState } from "react";
import { globalBaselineAssetUrl } from "../lib/data";
import type {
  GlobalBaselineData,
  GlobalBaselineSampleId,
  GlobalBaselineScopeId,
  MetricId,
  Model,
} from "../types/data";
import { GlobalPairMatrix } from "./GlobalPairMatrix";

interface GlobalBaselineProps {
  data: GlobalBaselineData | null;
  models: Model[];
  heatmapModelIds?: string[];
  loading: boolean;
  error: string;
}

interface Selection {
  scope: GlobalBaselineScopeId;
  metric: MetricId;
  sample: GlobalBaselineSampleId;
  model: string;
  provider: string;
  minOverlap: number;
}

const params = new URLSearchParams(window.location.search);
const querySelection = {
  scope: params.get("global_scope"),
  metric: params.get("global_metric"),
  sample: params.get("global_sample"),
  model: params.get("global_model"),
  provider: params.get("global_provider"),
  minOverlap: params.get("global_min_n"),
};

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function metricValue(value: number | null | undefined, metric: MetricId): string {
  if (!finite(value)) return "—";
  return metric === "high_loss_lift" ? value.toFixed(2) : value.toFixed(3);
}

function setQueryValue(key: string, value: string) {
  const next = new URLSearchParams(window.location.search);
  if (value) next.set(key, value);
  else next.delete(key);
  window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}${window.location.hash}`);
}

function matchesScopeMetricSample(
  row: { global_scope: string; metric_id: string; sample_id: string },
  selection: Selection,
) {
  return row.global_scope === selection.scope
    && row.metric_id === selection.metric
    && row.sample_id === selection.sample;
}

export function GlobalBaseline({ data, models, heatmapModelIds = [], loading, error }: GlobalBaselineProps) {
  const [selection, setSelection] = useState<Selection>({
    scope: "official_full",
    metric: "adjusted_pog",
    sample: "near_bi_both",
    model: "",
    provider: "all",
    minOverlap: 50,
  });

  useEffect(() => {
    if (!data) return;
    const scope = data.manifest.global_scopes.find((item) => item.id === querySelection.scope)?.id
      ?? data.manifest.global_scopes[0]?.id;
    const metric = data.manifest.metrics.find((item) => item.id === querySelection.metric)?.id
      ?? data.manifest.metrics[0]?.id;
    const sample = data.manifest.samples.find((item) => item.id === querySelection.sample)?.id
      ?? data.manifest.samples.find((item) => item.primary)?.id
      ?? data.manifest.samples[0]?.id;
    setSelection((current) => ({
      scope: scope ?? current.scope,
      metric: metric ?? current.metric,
      sample: sample ?? current.sample,
      model: querySelection.model ?? "",
      provider: querySelection.provider ?? "all",
      minOverlap: Math.max(50, Number(querySelection.minOverlap ?? 50) || 50),
    }));
  }, [data]);

  if (loading) {
    return <section className="global-baseline-section" id="global" aria-busy="true"><div className="section-heading"><div><p className="eyebrow">GLOBAL BASELINE</p><h2>Loading global analysis…</h2></div></div></section>;
  }

  if (!data) {
    return (
      <section className="global-baseline-section" id="global">
        <div className="section-heading">
          <div><p className="eyebrow">GLOBAL BASELINE</p><h2>Global model dependence</h2></div>
          <p>Establishes model-pair dependence without splitting the target set by event type.</p>
        </div>
        <div className="cross-type-unavailable" role="status"><strong>{error ? "Global-baseline data could not be loaded" : "Global-baseline dataset not published yet"}</strong><span>{error || "This section activates only when the audited release is available. No placeholder values are shown."}</span></div>
      </section>
    );
  }

  const scope = data.manifest.global_scopes.find((item) => item.id === selection.scope) ?? data.manifest.global_scopes[0];
  const metric = data.manifest.metrics.find((item) => item.id === selection.metric) ?? data.manifest.metrics[0];
  const sample = data.manifest.samples.find((item) => item.id === selection.sample) ?? data.manifest.samples[0];
  const globalSummary = data.summary.global_pair_summary.find((row) => matchesScopeMetricSample(row, selection));

  function update<K extends keyof Selection>(key: K, value: Selection[K]) {
    setSelection((current) => ({ ...current, [key]: value }));
    const queryKey = key === "minOverlap" ? "global_min_n" : `global_${key}`;
    setQueryValue(queryKey, String(value));
  }

  return (
    <section className="global-baseline-section" id="global" data-testid="global-baseline">
      <div className="section-heading">
        <div><p className="eyebrow">GLOBAL BASELINE · NO EVENT-TYPE SPLIT</p><h2>Global model dependence</h2></div>
        <p>Global metrics are recomputed directly from target-level losses, never averaged across event types.</p>
      </div>

      <div className="global-scope-tabs" role="tablist" aria-label="Global baseline scope">
        {data.manifest.global_scopes.map((item) => <button key={item.id} role="tab" aria-selected={item.id === selection.scope} className={item.id === selection.scope ? "active" : ""} onClick={() => update("scope", item.id)}><strong>{item.label}</strong><span>{item.description}</span></button>)}
      </div>

      <div className="global-controls">
        <div className="cross-type-tabs" role="tablist" aria-label="Global baseline metric">
          {data.manifest.metrics.map((item) => <button key={item.id} role="tab" aria-selected={item.id === selection.metric} className={item.id === selection.metric ? "active" : ""} onClick={() => update("metric", item.id)}>{item.label}</button>)}
        </div>
        <div className="sample-toggle" role="group" aria-label="Global baseline sample">
          {data.manifest.samples.map((item) => <button key={item.id} aria-pressed={item.id === selection.sample} className={item.id === selection.sample ? "active" : ""} onClick={() => update("sample", item.id)}>{item.label}</button>)}
        </div>
        <div className="cross-type-downloads">
          <a href={globalBaselineAssetUrl(data.manifest.pair_metrics_gzip)} download>Global pairs ↓</a>
        </div>
      </div>

      <div className="global-summary-line" aria-label="Global pair summary">
        <div><span>Scope</span><strong>{scope?.label ?? selection.scope}</strong></div>
        <div><span>Pair universe</span><strong>{globalSummary?.n_pair_universe.toLocaleString() ?? "—"}</strong></div>
        <div><span>{selection.sample === "near_bi_both" ? "Near-BI global pairs" : sample?.label ?? "Active sample"}</span><strong>{globalSummary?.n_sample_pairs.toLocaleString() ?? "—"}</strong></div>
        <div><span>Defined pairs</span><strong>{globalSummary?.n_defined_pairs.toLocaleString() ?? "—"}</strong></div>
        <div className="global-summary-emphasis"><span>Global median · {metric?.label}</span><strong>{metricValue(globalSummary?.median, selection.metric)}</strong><small>{metricValue(globalSummary?.q25, selection.metric)}–{metricValue(globalSummary?.q75, selection.metric)} IQR</small></div>
      </div>

      <div className="global-matrix-heading">
        <div><p className="eyebrow">GLOBAL PAIRWISE MATRIX · {scope?.label}</p><h3>Model dependence without event-type splits</h3></div>
        <p>Every cell is recomputed from the active global target set. The shared heatmap selector controls the visible models; without a custom selection, the 30 highest-coverage versions are shown.</p>
      </div>
      <GlobalPairMatrix
        data={data}
        models={models}
        heatmapModelIds={heatmapModelIds}
        scope={selection.scope}
        metricId={selection.metric}
        nearBi={selection.sample === "near_bi_both"}
        provider={selection.provider}
        selectedModel={selection.model}
        minOverlap={selection.minOverlap}
        onProviderChange={(provider) => update("provider", provider)}
        onModelChange={(model) => update("model", model)}
        onMinOverlapChange={(value) => update("minOverlap", value)}
      />
    </section>
  );
}
