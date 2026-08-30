import { useEffect, useMemo, useState } from "react";
import { decodeGlobalPairMatrix, loadGlobalPairMatrix } from "../lib/data";
import { formatMetric, MODEL_DEPENDENCE_DIRECTION } from "../lib/metrics";
import type {
  GlobalBaselineData,
  GlobalBaselineScopeId,
  GlobalPairMatrixCompact,
  GlobalPairMatrixRow,
  MetricDefinition,
  MetricId,
  Model,
  PairMetrics,
} from "../types/data";
import { Heatmap } from "./Heatmap";

interface GlobalPairMatrixProps {
  data: GlobalBaselineData;
  models: Model[];
  heatmapModelIds: string[];
  scope: GlobalBaselineScopeId;
  metricId: MetricId;
  nearBi: boolean;
  provider: string;
  selectedModel: string;
  minOverlap: number;
  onProviderChange: (provider: string) => void;
  onModelChange: (modelId: string) => void;
  onMinOverlapChange: (value: number) => void;
}

function metricDefinition(data: GlobalBaselineData, metricId: MetricId): MetricDefinition {
  const reference = data.manifest.metrics.find((item) => item.id === metricId) ?? data.manifest.metrics[0];
  return {
    id: metricId,
    label: reference?.label ?? metricId,
    short_label: reference?.label ?? metricId,
    direction: MODEL_DEPENDENCE_DIRECTION[metricId],
    format: metricId === "high_loss_lift" ? ".2f" : ".3f",
    description: "Global target-level pair dependence.",
  };
}

function toPairs(payload: GlobalPairMatrixCompact, rows: GlobalPairMatrixRow[]): PairMetrics[] {
  return rows.map((row) => ({
    a: row.model_a_id,
    b: row.model_b_id,
    n_overlap: row.n_overlap,
    n_dates: row.n_dates,
    metrics: {
      adjusted_pog: { value: row.adjusted_pog, se: null, ci95: null, reason: row.pog_reason },
      high_loss_lift: { value: row.high_loss_lift, se: null, ci95: null, reason: row.lift_reason },
      adjusted_loss_corr: { value: row.adjusted_loss_corr, se: null, ci95: null, reason: row.corr_reason },
      total_variation: { value: row.total_variation, se: null, ci95: null, reason: row.tv_reason },
    },
    diagnostics: { mean_bi_gap: null, near_bi: row.near_bi },
    row_id: `${payload.global_scope}::${row.model_a_id}::${row.model_b_id}`,
  }));
}

export function GlobalPairMatrix({
  data,
  models,
  heatmapModelIds,
  scope,
  metricId,
  nearBi,
  provider,
  selectedModel,
  minOverlap,
  onProviderChange,
  onModelChange,
  onMinOverlapChange,
}: GlobalPairMatrixProps) {
  const [payload, setPayload] = useState<GlobalPairMatrixCompact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPair, setSelectedPair] = useState<PairMetrics | null>(null);

  useEffect(() => {
    const path = data.manifest.pair_matrix_files?.[scope];
    if (!path) {
      setPayload(null);
      return;
    }
    let active = true;
    setPayload(null);
    setSelectedPair(null);
    setLoading(true);
    setError("");
    loadGlobalPairMatrix(path, data.manifest.schema_version)
      .then((next) => {
        if (!active) return;
        if (next.global_scope !== scope) throw new Error(`Global pair-matrix scope mismatch (${scope} vs ${next.global_scope})`);
        setPayload(next);
      })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [data.manifest.pair_matrix_files, data.manifest.schema_version, scope]);

  useEffect(() => setSelectedPair(null), [heatmapModelIds, metricId, minOverlap, nearBi, provider, scope, selectedModel]);

  const matrixModelIds = useMemo(() => new Set(payload?.models.map((model) => model.id) ?? []), [payload]);
  const cleanModels = useMemo(() => models
    .filter((model) => matrixModelIds.has(model.id))
    .sort((left, right) => left.release_order - right.release_order || left.name.localeCompare(right.name)), [matrixModelIds, models]);
  const providers = useMemo(() => [...new Set(cleanModels.map((model) => model.provider))].sort(), [cleanModels]);
  const eligibleModels = useMemo(() => cleanModels.filter((model) => provider === "all" || model.provider === provider), [cleanModels, provider]);
  const decodedRows = useMemo(() => payload ? decodeGlobalPairMatrix(payload) : [], [payload]);
  const eligiblePairIds = useMemo(() => new Set(decodedRows
    .filter((row) => row.eligible)
    .map((row) => `${row.model_a_id}::${row.model_b_id}`)), [decodedRows]);
  const allPairs = useMemo(() => payload ? toPairs(payload, decodedRows) : [], [decodedRows, payload]);
  const eligiblePairs = useMemo(() => {
    const eligibleIds = new Set(eligibleModels.map((model) => model.id));
    return allPairs.filter((pair) => {
      return eligiblePairIds.has(`${pair.a}::${pair.b}`)
        && eligibleIds.has(pair.a)
        && eligibleIds.has(pair.b)
        && pair.n_overlap >= minOverlap
        && (!nearBi || pair.diagnostics.near_bi === true)
        && pair.metrics[metricId].value !== null;
    });
  }, [allPairs, eligibleModels, eligiblePairIds, metricId, minOverlap, nearBi]);
  const visiblePairs = useMemo(() => eligiblePairs.filter((pair) =>
    !selectedModel || pair.a === selectedModel || pair.b === selectedModel
  ), [eligiblePairs, selectedModel]);

  const heatmapModels = useMemo(() => {
    if (heatmapModelIds.length) {
      const selectedIds = new Set(heatmapModelIds);
      return eligibleModels.filter((model) => selectedIds.has(model.id));
    }
    const coverage = new Map<string, number>();
    for (const pair of visiblePairs) {
      coverage.set(pair.a, (coverage.get(pair.a) ?? 0) + pair.n_overlap);
      coverage.set(pair.b, (coverage.get(pair.b) ?? 0) + pair.n_overlap);
    }
    const ranked = [...eligibleModels].sort((left, right) => (coverage.get(right.id) ?? 0) - (coverage.get(left.id) ?? 0));
    const chosen = selectedModel
      ? [...(eligibleModels.find((model) => model.id === selectedModel) ? [eligibleModels.find((model) => model.id === selectedModel)!] : []), ...ranked.filter((model) => model.id !== selectedModel).slice(0, 29)]
      : ranked.slice(0, 30);
    return chosen.sort((left, right) => left.release_order - right.release_order || left.name.localeCompare(right.name));
  }, [eligibleModels, heatmapModelIds, selectedModel, visiblePairs]);

  const heatmapPairs = useMemo(() => {
    const ids = new Set(heatmapModels.map((model) => model.id));
    const sourcePairs = heatmapModelIds.length ? eligiblePairs : visiblePairs;
    return sourcePairs.filter((pair) => ids.has(pair.a) && ids.has(pair.b));
  }, [eligiblePairs, heatmapModelIds.length, heatmapModels, visiblePairs]);
  const metric = metricDefinition(data, metricId);
  const modelNames = new Map(cleanModels.map((model) => [model.id, model.name]));

  function changeProvider(next: string) {
    onProviderChange(next);
    if (selectedModel && next !== "all" && cleanModels.find((model) => model.id === selectedModel)?.provider !== next) onModelChange("");
  }

  if (!data.manifest.pair_matrix_files?.[scope]) {
    return <div className="global-matrix-unavailable" role="status"><strong>Global pair matrix not published yet</strong><span>The matrix activates only when its audited compact shard is available. No placeholder values are shown.</span></div>;
  }

  if (loading && !payload) return <div className="global-matrix-unavailable" aria-busy="true"><strong>Loading global pair matrix…</strong><span>Reading the audited {scope === "official_full" ? "official-full" : "seven-topic-union"} shard.</span></div>;
  if (error) return <div className="global-matrix-unavailable" role="status"><strong>Global pair matrix could not be loaded</strong><span>{error}</span></div>;
  if (!payload) return null;

  return (
    <div className="global-pair-matrix" data-testid="global-pair-matrix">
      <div className="global-matrix-filters" aria-label="Global matrix filters">
        <label><span>PROVIDER</span><select aria-label="Global matrix provider" value={provider} onChange={(event) => changeProvider(event.target.value)}><option value="all">All providers</option>{providers.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label><span>FOCAL MODEL</span><select aria-label="Global matrix model" value={selectedModel} onChange={(event) => onModelChange(event.target.value)}><option value="">All models</option>{eligibleModels.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
        <label className="global-matrix-range"><span>MIN OVERLAP <b>{minOverlap}</b></span><input aria-label="Global matrix minimum overlap" type="range" min="50" max="250" step="25" value={minOverlap} onChange={(event) => onMinOverlapChange(Number(event.target.value))} /></label>
      </div>
      <div className="global-matrix-copy"><span>{nearBi ? "Near-BI" : "All eligible"} · {visiblePairs.length.toLocaleString()} defined pairs</span><p>{heatmapModelIds.length ? `The matrix shows ${heatmapModels.length} selected models available under the active global filters` : `The matrix shows the ${heatmapModels.length} highest-coverage models out of ${eligibleModels.length}`}, ordered from earliest to latest release.</p></div>
      <div className="legend"><span>Lower diversity</span><i className="legend-gradient" /><span>Higher diversity</span></div>
      <Heatmap models={heatmapModels} pairs={heatmapPairs} metric={metric} selectedModel={selectedModel} selectedPair={selectedPair} onSelectPair={setSelectedPair} testId="global-pair-heatmap" />
      {selectedPair && <div className="global-matrix-selection" data-testid="global-matrix-selection"><strong>{modelNames.get(selectedPair.a)} <span>×</span> {modelNames.get(selectedPair.b)}</strong><small>{metric.label} {formatMetric(selectedPair.metrics[metricId].value, metricId)} · n={selectedPair.n_overlap.toLocaleString()} · {selectedPair.n_dates} dates</small></div>}
    </div>
  );
}
