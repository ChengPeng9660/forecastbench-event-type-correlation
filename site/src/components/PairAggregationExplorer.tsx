import { useEffect, useMemo, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { useHistoryRestore } from "../lib/useHistoryRestore";
import { highLossAssociationReason, highLossAxis, isHighLossMetric, rawPearson } from "../lib/highLoss";
import { HighLossNotice } from "./HighLossNotice";
import type {
  AggregationMethodId,
  MetricId,
  ModelFamily,
  PairAggregationData,
  PairAggregationPoint,
  PairAggregationSummary,
  PairGroupId,
  PairGroupFilter,
} from "../types/data";

const WIDTH = 980;
const HEIGHT = 480;
const MARGIN = { top: 24, right: 32, bottom: 76, left: 86 };

const PRIMARY_METHODS: AggregationMethodId[] = [
  "ec_w0_56",
  "simple_mean",
  "log_odds_mean",
  "piecewise_odds",
  "best_single",
];

const ALL_METHODS: AggregationMethodId[] = [...PRIMARY_METHODS, "past_only_best_single"];

const GROUPS: Array<{ id: PairGroupFilter; label: string; short: string }> = [
  { id: "all", label: "All six-family pairs", short: "All pairs" },
  { id: "gpt_gpt", label: "GPT × GPT", short: "GPT × GPT" },
  { id: "claude_claude", label: "Claude × Claude", short: "Claude × Claude" },
  { id: "gemini_gemini", label: "Gemini × Gemini", short: "Gemini × Gemini" },
  { id: "qwen_qwen", label: "Qwen × Qwen", short: "Qwen × Qwen" },
  { id: "deepseek_deepseek", label: "DeepSeek × DeepSeek", short: "DeepSeek × DeepSeek" },
  { id: "kimi_kimi", label: "Kimi × Kimi", short: "Kimi × Kimi" },
  { id: "gpt_claude", label: "GPT × Claude", short: "GPT × Claude" },
  { id: "gpt_gemini", label: "GPT × Gemini", short: "GPT × Gemini" },
  { id: "gpt_qwen", label: "GPT × Qwen", short: "GPT × Qwen" },
  { id: "gpt_deepseek", label: "GPT × DeepSeek", short: "GPT × DeepSeek" },
  { id: "gpt_kimi", label: "GPT × Kimi", short: "GPT × Kimi" },
  { id: "claude_gemini", label: "Claude × Gemini", short: "Claude × Gemini" },
  { id: "claude_qwen", label: "Claude × Qwen", short: "Claude × Qwen" },
  { id: "claude_deepseek", label: "Claude × DeepSeek", short: "Claude × DeepSeek" },
  { id: "claude_kimi", label: "Claude × Kimi", short: "Claude × Kimi" },
  { id: "gemini_qwen", label: "Gemini × Qwen", short: "Gemini × Qwen" },
  { id: "gemini_deepseek", label: "Gemini × DeepSeek", short: "Gemini × DeepSeek" },
  { id: "gemini_kimi", label: "Gemini × Kimi", short: "Gemini × Kimi" },
  { id: "qwen_deepseek", label: "Qwen × DeepSeek", short: "Qwen × DeepSeek" },
  { id: "qwen_kimi", label: "Qwen × Kimi", short: "Qwen × Kimi" },
  { id: "deepseek_kimi", label: "DeepSeek × Kimi", short: "DeepSeek × Kimi" },
];

export type CrossFitFoldView = "combined" | "a_to_b" | "b_to_a";

const FOLD_VIEWS: Array<{ id: CrossFitFoldView; label: string; detail: string }> = [
  { id: "combined", label: "Combined", detail: "A→B and B→A averaged across 10 splits" },
  { id: "a_to_b", label: "A→B", detail: "Ten A-train → B-test evaluations averaged" },
  { id: "b_to_a", label: "B→A", detail: "Ten B-train → A-test evaluations averaged" },
];

const FAMILY_COLORS: Record<ModelFamily, string> = {
  GPT: "#efab02",
  Claude: "#4f207f",
  Gemini: "#4285f4",
  Qwen: "#267c79",
  DeepSeek: "#c75b39",
  Kimi: "#1f2937",
};

const METRICS: Array<{ id: MetricId; label: string; axis: string }> = [
  { id: "adjusted_pog", label: "Adjusted POG", axis: "Adjusted pairwise oracle gain" },
  { id: "high_loss_lift", label: "High-loss lift", axis: "Complementarity orientation · 1 − lift" },
  { id: "adjusted_loss_corr", label: "Loss correlation", axis: "Complementarity orientation · − correlation" },
  { id: "total_variation", label: "Total variation (TV)", axis: "Mean absolute probability difference · TV" },
];

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pearson(x: number[], y: number[]) {
  return rawPearson(x, y);
}

function extent(values: number[], includeZero = false): [number, number] {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (includeZero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const span = high - low || Math.max(Math.abs(high), 0.01);
  return [low - span * 0.08, high + span * 0.08];
}

function ticks([low, high]: [number, number]) {
  return Array.from({ length: 5 }, (_, index) => low + ((high - low) * index) / 4);
}

function percent(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function metricValue(value: number, metric: MetricId) {
  return metric === "adjusted_pog" || metric === "total_variation" ? value.toFixed(3) : value.toFixed(2);
}

function shortModel(model: string) {
  return model.replace(/-20\d{2}.*/, "");
}

function pairLabel(point: PairAggregationPoint, focalModel: string) {
  const partner = point.model_a === focalModel ? point.model_b : point.model_a;
  return `${focalModel} × ${partner}`;
}

export function withGainFractionVsFocal(point: PairAggregationPoint, focalModel: string) {
  const focalSide = point.model_a === focalModel
    ? "model_a"
    : point.model_b === focalModel ? "model_b" : null;
  if (!focalSide) return null;
  const focalBrier = point.adjusted_brier[focalSide];
  const gains = Object.fromEntries(ALL_METHODS.map((method) => [
    method,
    Number.isFinite(focalBrier) && focalBrier > 0
      ? (focalBrier - point.adjusted_brier[method]) / focalBrier
      : null,
  ])) as Record<AggregationMethodId, number | null>;
  return { ...point, gain_fraction_vs_best_single: gains };
}

function matchesGroup(point: PairAggregationPoint, group: PairGroupFilter) {
  if (group === "all") return true;
  return point.pair_group === group;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return ordered[lower + 1] === undefined
    ? ordered[lower]
    : ordered[lower] + fraction * (ordered[lower + 1] - ordered[lower]);
}

export function summarizeAggregationPoints(
  points: PairAggregationPoint[],
  method: AggregationMethodId,
  pairGroup: PairGroupFilter,
  sample: "eligible" | "near_bi",
): PairAggregationSummary {
  const defined = points.flatMap((point) => {
    const gain = point.gain_fraction_vs_best_single[method];
    return gain === null ? [] : [{ gain, weight: point.n_overlap }];
  });
  const gains = defined.map((item) => item.gain);
  const totalWeight = defined.reduce((total, item) => total + item.weight, 0);
  const positivePairs = gains.filter((gain) => gain > 0).length;
  return {
    pair_group: pairGroup,
    sample,
    method,
    pair_count: defined.length,
    pair_event_cells: totalWeight,
    positive_pairs: positivePairs,
    positive_pair_share: defined.length ? positivePairs / defined.length : null,
    macro_mean_gain_fraction: defined.length ? mean(gains) : null,
    support_weighted_gain_fraction: totalWeight
      ? defined.reduce((total, item) => total + item.gain * item.weight, 0) / totalWeight
      : null,
    median_gain_fraction: quantile(gains, 0.5),
    p10_gain_fraction: quantile(gains, 0.1),
    p90_gain_fraction: quantile(gains, 0.9),
  };
}

function focalSampleLabel(focalModel: string, group: PairGroupFilter, fallback: string) {
  if (!focalModel) return fallback;
  return group === "all" ? `${focalModel} × all eligible partners` : `${focalModel} · ${fallback}`;
}

export function selectCrossFitPoints(
  data: PairAggregationData,
  foldView: CrossFitFoldView,
  nearBiOnly: boolean,
) {
  if (foldView === "combined") {
    return nearBiOnly ? data.cross_fit.near_bi_points : data.cross_fit.eligible_points;
  }
  const direction = data.cross_fit.directional_points[foldView];
  return nearBiOnly ? direction.near_bi_points : direction.eligible_points;
}

interface PairAggregationExplorerProps {
  data: PairAggregationData;
  active?: boolean;
  nearBiOnly: boolean;
  onNearBiOnlyChange: (value: boolean) => void;
}

export function PairAggregationExplorer({ data, nearBiOnly, onNearBiOnlyChange, active = true }: PairAggregationExplorerProps) {
  const modelOptions = [
    ...data.model_scope.gpt_models,
    ...data.model_scope.claude_models,
    ...data.model_scope.gemini_models,
    ...data.model_scope.qwen_models,
    ...data.model_scope.deepseek_models,
    ...data.model_scope.kimi_models,
  ];
  const defaultFocalModel = modelOptions.includes("GPT-5-2025-08-07")
    ? "GPT-5-2025-08-07"
    : modelOptions[0];
  const [focalModel, setFocalModel] = useState(() => {
    if (typeof window === "undefined") return defaultFocalModel;
    const candidate = new URLSearchParams(window.location.search).get("gain_model") ?? "";
    return modelOptions.includes(candidate) ? candidate : defaultFocalModel;
  });
  const [foldView, setFoldView] = useState<CrossFitFoldView>(() => {
    if (typeof window === "undefined") return "combined";
    const candidate = new URLSearchParams(window.location.search).get("gain_fold");
    return candidate === "a_to_b" || candidate === "b_to_a" ? candidate : "combined";
  });
  const [group, setGroup] = useState<PairGroupFilter>("all");
  const [method, setMethod] = useState<AggregationMethodId>("ec_w0_56");
  const [metric, setMetric] = useState<MetricId>("adjusted_pog");
  const [selectedKey, setSelectedKey] = useState("");
  useHistoryRestore((params) => {
    const candidate = params.get("gain_model") ?? "";
    const direction = params.get("gain_fold");
    const nextFocal = modelOptions.includes(candidate) ? candidate : defaultFocalModel;
    const nextFold = direction === "a_to_b" || direction === "b_to_a" ? direction : "combined";
    setFocalModel(nextFocal);
    setFoldView(nextFold);
    if (nextFocal !== focalModel || nextFold !== foldView) {
      setGroup("all");
      setSelectedKey("");
    }
    if (params.has("gain_eval")) {
      params.delete("gain_eval");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  });

  const evaluationPoints = useMemo(
    () => selectCrossFitPoints(data, foldView, nearBiOnly),
    [data, foldView, nearBiOnly],
  );
  const focalPoints = useMemo(() => evaluationPoints.flatMap((point) => {
    const focalPoint = withGainFractionVsFocal(point, focalModel);
    return focalPoint ? [focalPoint] : [];
  }), [evaluationPoints, focalModel]);
  const availableGroups = useMemo(() => new Set(GROUPS.filter((item) =>
    focalPoints.some((point) => matchesGroup(point, item.id))
  ).map((item) => item.id)), [focalPoints]);
  const points = useMemo(() => focalPoints.filter((point) => matchesGroup(point, group)), [focalPoints, group]);
  const definedPoints = useMemo(() => points.filter((point) =>
    Number.isFinite(point.metrics[metric].complementarity) && Number.isFinite(point.brier_index[method])
  ), [method, metric, points]);
  // Marker orientation follows the selected focal model, not canonical pair order.
  const pairFamilies = new Map<PairGroupId, readonly [ModelFamily, ModelFamily]>(
    definedPoints.map((point) => [point.pair_group, point.model_a === focalModel
      ? [point.family_a, point.family_b]
      : [point.family_b, point.family_a]]),
  );
  const sample = nearBiOnly ? "near_bi" : "eligible";
  const summaries = useMemo(() => PRIMARY_METHODS.map((methodId) =>
    summarizeAggregationPoints(points, methodId, group, sample)
  ), [group, points, sample]);
  const rankedMethods = [...summaries].filter((row) => row.method !== "best_single").sort((a, b) =>
    (b.support_weighted_gain_fraction ?? -Infinity) - (a.support_weighted_gain_fraction ?? -Infinity)
  );
  const activeSummary = summaries.find((row) => row.method === method);
  const selected = definedPoints.find((point) => `${point.model_a}::${point.model_b}` === selectedKey)
    ?? [...definedPoints].sort((a, b) =>
      b.brier_index[method] - a.brier_index[method]
    )[0];

  useEffect(() => {
    if (selected) setSelectedKey(`${selected.model_a}::${selected.model_b}`);
  }, [focalModel, foldView, group, nearBiOnly, method, metric, selected?.model_a, selected?.model_b]);

  useEffect(() => {
    if (group !== "all" && !availableGroups.has(group)) setGroup("all");
  }, [availableGroups, group]);

  useEffect(() => {
    if (!active || !focalModel || !nearBiOnly || focalPoints.length) return;
    onNearBiOnlyChange(false);
  }, [active, focalModel, focalPoints.length, nearBiOnly, onNearBiOnlyChange]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (focalModel) params.set("gain_model", focalModel);
    else params.delete("gain_model");
    params.delete("gain_eval");
    if (foldView !== "combined") params.set("gain_fold", foldView);
    else params.delete("gain_fold");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [focalModel, foldView]);

  const xValues = definedPoints.map((point) => point.metrics[metric].complementarity as number);
  const yValues = definedPoints.map((point) => point.brier_index[method]);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : extent(xValues.length ? xValues : [0, 1]);
  const yDomain = extent(yValues.length ? yValues : [0]);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const lossAxis = isHighLossMetric(metric) ? highLossAxis(xValues, [MARGIN.left, WIDTH - MARGIN.right]) : null;
  const xScale = lossAxis?.position ?? ((value: number) => MARGIN.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth);
  const yScale = (value: number) => MARGIN.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;
  const maximumDirections = data.cross_fit.split.repetitions * (foldView === "combined" ? 2 : 1);
  const retainedDirections = definedPoints.every((point) => point.cross_fit !== undefined)
    ? definedPoints.map((point) => point.cross_fit!.included_fold_count) : undefined;
  const associationReason = isHighLossMetric(metric)
    ? highLossAssociationReason(xValues, yValues, retainedDirections, maximumDirections) : null;
  const correlation = associationReason ? null : pearson(xValues, yValues);
  const maxOverlap = Math.max(1, ...definedPoints.map((point) => point.n_overlap));
  const metricMeta = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const groupMeta = GROUPS.find((item) => item.id === group) ?? GROUPS[0];
  const activeSampleLabel = focalSampleLabel(focalModel, group, groupMeta.label);
  const foldViewMeta = FOLD_VIEWS.find((item) => item.id === foldView) ?? FOLD_VIEWS[0];

  function chooseFocalModel(value: string) {
    setFocalModel(value);
    setGroup("all");
    setSelectedKey("");
    if (value && nearBiOnly) {
      const source = selectCrossFitPoints(data, foldView, true);
      if (!source.some((point) => point.model_a === value || point.model_b === value)) onNearBiOnlyChange(false);
    }
  }

  return (
    <section className="pair-aggregation-section" id="gain">
      <div className="section-heading pair-aggregation-heading">
        <div><p className="eyebrow">MODEL × MODEL</p><h2>Diversity and aggregation performance</h2></div>
        <p>Fix a model, compare its partners, and evaluate aggregation across 10 repeated event-disjoint splits.</p>
      </div>

      <div className="aggregation-evaluation-bar">
        <strong>Cross-fit OOS</strong>
        <p>{data.cross_fit.split.repetitions} repeated splits · {data.cross_fit.audit.unique_events.toLocaleString()} events · train-only Near-BI</p>
      </div>

      <div className="aggregation-fold-bar">
        <span>FOLD VIEW</span>
        <div className="aggregation-fold-toggle" role="group" aria-label="Cross-fit fold view">
          {FOLD_VIEWS.map((item) => <button type="button" className={foldView === item.id ? "active" : ""} onClick={() => { setFoldView(item.id); setSelectedKey(""); }} key={item.id}>{item.label}</button>)}
        </div>
        <small>{foldViewMeta.detail}</small>
      </div>

      <div className="pair-aggregation-controls">
        <div className="pair-group-tabs" role="tablist" aria-label="Model pair group">
          {GROUPS.map((item) => {
            const disabled = item.id !== "all" && !availableGroups.has(item.id);
            return <button type="button" role="tab" aria-selected={group === item.id} className={group === item.id ? "active" : ""} disabled={disabled} onClick={() => setGroup(item.id)} key={item.id}>{item.short}</button>;
          })}
        </div>
        <div className="aggregation-filter-cluster">
          <label className="aggregation-focal-select">
            <span>FOCAL MODEL</span>
            <select aria-label="Aggregation focal model" value={focalModel} onChange={(event) => chooseFocalModel(event.target.value)}>
              <optgroup label="GPT">
                {data.model_scope.gpt_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Claude">
                {data.model_scope.claude_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Gemini">
                {data.model_scope.gemini_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Qwen">
                {data.model_scope.qwen_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="DeepSeek">
                {data.model_scope.deepseek_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Kimi">
                {data.model_scope.kimi_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
            </select>
          </label>
          <div className="gain-sample-toggle" role="group" aria-label="Aggregation sample">
            <button type="button" className={!nearBiOnly ? "active" : ""} onClick={() => onNearBiOnlyChange(false)}>All eligible</button>
            <button type="button" className={nearBiOnly ? "active" : ""} onClick={() => onNearBiOnlyChange(true)}>Near-BI only</button>
          </div>
        </div>
      </div>

      <div className="research-chart-controls">
        <label className="research-method-select">
          <span>AGGREGATION</span>
          <select aria-label="Aggregation method" value={method} onChange={(event) => setMethod(event.target.value as AggregationMethodId)}>
            {summaries.map((row) => <option value={row.method} key={row.method}>{data.methods[row.method].label}{row.method === "best_single" ? " (hindsight)" : ""}</option>)}
          </select>
        </label>
        <div className="aggregation-metric-tabs" role="tablist" aria-label="Aggregation complementarity metric">
          {METRICS.map((item) => <button type="button" role="tab" aria-selected={metric === item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)} key={item.id}>{item.label}</button>)}
        </div>
      </div>

      <HighLossNotice metric={metric} values={xValues} missingCount={points.filter((point) => !Number.isFinite(point.metrics[metric].complementarity)).length} totalCount={points.length} retainedDirections={retainedDirections} maximumDirections={maximumDirections} associationReason={associationReason} diagnostics={points.flatMap((point) => point.high_loss_diagnostics ? [point.high_loss_diagnostics] : [])} />

      <div className="pair-aggregation-chart-wrap">
        <div className="pair-group-legend">
          {(Object.keys(FAMILY_COLORS) as ModelFamily[]).map((family) => <span key={family}><i style={{ background: FAMILY_COLORS[family] }} /> {family}</span>)}
          <small>Left = selected model · right = partner · area = test support</small>
        </div>
        {definedPoints.length ? <svg className="pair-aggregation-chart" data-x-scale={lossAxis ? "signed-log" : "linear"} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metricMeta.label} versus ${data.methods[method].label} Brier Index for ${activeSampleLabel}, ${foldViewMeta.label}`}>
          <defs>
            {[...pairFamilies].map(([pairGroup, families]) => <linearGradient id={`pair-fill-${pairGroup}`} key={pairGroup} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="50%" stopColor={FAMILY_COLORS[families[0]]} />
              <stop offset="50%" stopColor={FAMILY_COLORS[families[1]]} />
            </linearGradient>)}
          </defs>
          {ticks(yDomain).map((tick) => <g key={`y-${tick}`}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} className="gain-grid-line" /><text x={MARGIN.left - 14} y={yScale(tick) + 4} textAnchor="end" className="gain-axis-text">{tick.toFixed(2)}</text></g>)}
          {(lossAxis?.ticks ?? ticks(xDomain)).map((tick) => <g key={`x-${tick}`}><line x1={xScale(tick)} x2={xScale(tick)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="gain-grid-line vertical" /><text x={xScale(tick)} y={MARGIN.top + plotHeight + 27} textAnchor="middle" className="gain-axis-text">{metricValue(tick, metric)}</text></g>)}
          {definedPoints.map((point) => {
            const key = `${point.model_a}::${point.model_b}`;
            const aggregationBi = point.brier_index[method];
            const complementarity = point.metrics[metric].complementarity as number;
            const radius = 4.5 + 7.5 * Math.sqrt(point.n_overlap / maxOverlap);
            const isSelected = key === `${selected?.model_a}::${selected?.model_b}`;
            return <g className={`aggregation-point ${point.pair_group} ${isSelected ? "selected" : ""}`} key={key} role="button" tabIndex={0} aria-label={`${pairLabel(point, focalModel)}, aggregation BI ${aggregationBi.toFixed(2)}`} onMouseEnter={() => setSelectedKey(key)} onFocus={() => setSelectedKey(key)} onClick={() => setSelectedKey(key)}>
              <circle cx={xScale(complementarity)} cy={yScale(aggregationBi)} r={radius} style={{ fill: `url(#pair-fill-${point.pair_group})` }} />
              {isSelected && <text x={xScale(complementarity)} y={yScale(aggregationBi) - radius - 8} textAnchor="middle" className="gain-point-label">{shortModel(focalModel)} × {shortModel(point.model_a === focalModel ? point.model_b : point.model_a)}</text>}
              <title>{`${pairLabel(point, focalModel)}\nFixed focal: ${focalModel}\n${metricMeta.label}: ${point.metrics[metric].raw?.toFixed(4) ?? "undefined"}\n${data.methods[method].label} aggregation Brier Index: ${aggregationBi.toFixed(2)}\nRepeated test targets: ${point.n_overlap.toLocaleString()}\nIncluded train→test evaluations: ${point.cross_fit?.included_fold_count ?? 0}/${foldView === "combined" ? data.cross_fit.split.repetitions * 2 : data.cross_fit.split.repetitions}`}</title>
            </g>;
          })}
          <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 20} textAnchor="middle" className="gain-axis-title">{metricMeta.axis} · Lower diversity → Higher diversity</text>
          <text transform={`translate(24 ${MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="gain-axis-title">Aggregation Brier Index (higher is better)</text>
        </svg> : <div className="aggregation-empty-state"><strong>{points.length ? "No defined chart coordinates for the selected partners." : "No eligible partners in this sample."}</strong><span>{points.length ? "Their scores remain available; choose another diversity metric or outcome." : "Choose All eligible or another pair group."}</span></div>}
      </div>

      <div className="aggregation-overview">
        <div className="aggregation-method-table" role="table" aria-label="Aggregation method comparison">
          <div className="aggregation-method-head" role="row"><span>METHOD</span><span>GAIN VS FOCAL</span><span>POSITIVE PAIRS</span><span>MACRO GAIN</span></div>
          {summaries.map((row) => {
            const isBaseline = row.method === "best_single";
            const rank = rankedMethods.findIndex((item) => item.method === row.method) + 1;
            return <button type="button" role="row" className={`aggregation-method-row ${method === row.method ? "active" : ""}`} onClick={() => setMethod(row.method)} key={row.method}>
              <span><i>{isBaseline ? "B" : String(rank).padStart(2, "0")}</i><strong>{data.methods[row.method].label}</strong><small>{isBaseline ? "Hindsight benchmark" : data.methods[row.method].outcome_blind ? "Outcome-blind pool" : "Benchmark"}</small></span>
              <strong className={(row.support_weighted_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(row.support_weighted_gain_fraction)}</strong>
              <strong>{`${row.positive_pairs}/${row.pair_count}`}</strong>
              <strong className={(row.macro_mean_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(row.macro_mean_gain_fraction)}</strong>
            </button>;
          })}
        </div>

        <dl className="aggregation-selection-summary">
          <div><dt>ACTIVE SAMPLE</dt><dd title={activeSampleLabel}>{activeSampleLabel}</dd><small>{foldViewMeta.label} · Cross-fit OOS · {nearBiOnly ? `train BI gap ≤ ${data.near_bi.threshold_bi_points.toFixed(1)}` : "all eligible pairs"}</small></div>
          <div><dt>PAIR COUNT</dt><dd>{points.length}</dd><small>{points.reduce((total, point) => total + point.n_overlap, 0).toLocaleString()} test pair-event cells</small></div>
          <div><dt>SELECTED METHOD</dt><dd>{data.methods[method].label}</dd><small>{data.methods[method].formula}</small></div>
          <div><dt>WEIGHTED GAIN VS FOCAL</dt><dd className={(activeSummary?.support_weighted_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(activeSummary?.support_weighted_gain_fraction ?? null)}</dd><small>fractional Brier reduction from the fixed focal model</small></div>
          <div><dt>DIVERSITY–BI r</dt><dd>{correlation?.toFixed(2) ?? "—"}</dd><small>train diversity versus opposite-fold Brier Index; positive is favorable</small></div>
        </dl>
      </div>

      <ResearchDetails>
        <p><strong>Evaluation.</strong> GPT, Claude, Gemini, Qwen, DeepSeek, and Kimi use {data.cross_fit.split.repetitions} reproducible random event-level splits, with seeds {data.cross_fit.split.seeds[0]}–{data.cross_fit.split.seeds.at(-1)}. A→B and B→A keep training diversity separate from opposite-fold performance; Combined averages both directions. Near-BI is evaluated on the selected view's training fold only.</p>
        <p><strong>Scores.</strong> Higher Brier Index is better. Gain is the fractional adjusted-Brier reduction from the fixed focal model on identical support. Best Single is a hindsight benchmark, not a deployable rule.</p>
        <p><strong>Interpretation.</strong> TV is the mean absolute probability difference on training questions, bounded from 0 to 1. Higher TV means greater prediction diversity. Displayed correlations are descriptive associations, not evidence that diversity causes better aggregation.</p>
      </ResearchDetails>
    </section>
  );
}
