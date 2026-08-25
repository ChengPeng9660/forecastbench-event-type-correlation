import { useEffect, useMemo, useState } from "react";
import type {
  AggregationMethodId,
  MetricId,
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

const GROUPS: Array<{ id: PairGroupFilter; label: string; short: string }> = [
  { id: "all", label: "All GPT / Claude pairs", short: "All pairs" },
  { id: "gpt_gpt", label: "GPT × GPT", short: "GPT × GPT" },
  { id: "claude_claude", label: "Claude × Claude", short: "Claude × Claude" },
  { id: "gpt_claude", label: "GPT × Claude", short: "GPT × Claude" },
];

const METRICS: Array<{ id: MetricId; label: string; axis: string }> = [
  { id: "adjusted_pog", label: "Adjusted POG", axis: "Adjusted pairwise oracle gain" },
  { id: "high_loss_lift", label: "High-loss lift", axis: "Complementarity orientation · 1 − lift" },
  { id: "adjusted_loss_corr", label: "Loss correlation", axis: "Complementarity orientation · − correlation" },
];

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pearson(x: number[], y: number[]) {
  if (x.length < 2 || x.length !== y.length) return null;
  const xMean = mean(x);
  const yMean = mean(y);
  const numerator = x.reduce((total, value, index) => total + (value - xMean) * (y[index] - yMean), 0);
  const xScale = Math.sqrt(x.reduce((total, value) => total + (value - xMean) ** 2, 0));
  const yScale = Math.sqrt(y.reduce((total, value) => total + (value - yMean) ** 2, 0));
  return xScale && yScale ? numerator / (xScale * yScale) : null;
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
  return metric === "adjusted_pog" ? value.toFixed(3) : value.toFixed(2);
}

function shortModel(model: string) {
  return model.replace(/-20\d{2}.*/, "");
}

function pairLabel(point: PairAggregationPoint) {
  return `${point.model_a} × ${point.model_b}`;
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
  if (group === "gpt_gpt") return `${focalModel} × GPT partners`;
  if (group === "claude_claude") return `${focalModel} × Claude partners`;
  if (group === "gpt_claude") {
    return `${focalModel} × ${focalModel.startsWith("GPT") ? "Claude" : "GPT"} partners`;
  }
  return `${focalModel} × all eligible partners`;
}

export function PairAggregationExplorer({ data }: { data: PairAggregationData }) {
  const modelOptions = [...data.model_scope.gpt_models, ...data.model_scope.claude_models];
  const [group, setGroup] = useState<PairGroupFilter>("gpt_claude");
  const [nearBiOnly, setNearBiOnly] = useState(true);
  const [method, setMethod] = useState<AggregationMethodId>("ec_w0_56");
  const [metric, setMetric] = useState<MetricId>("adjusted_pog");
  const [selectedKey, setSelectedKey] = useState("");
  const [focalModel, setFocalModel] = useState(() => {
    if (typeof window === "undefined") return "";
    const candidate = new URLSearchParams(window.location.search).get("gain_model") ?? "";
    return modelOptions.includes(candidate) ? candidate : "";
  });

  const focalPoints = useMemo(() => data.points.filter((point) =>
    !focalModel || point.model_a === focalModel || point.model_b === focalModel
  ), [data.points, focalModel]);
  const samplePoints = useMemo(() => focalPoints.filter((point) => !nearBiOnly || point.near_bi), [focalPoints, nearBiOnly]);
  const availableGroups = useMemo(() => new Set(samplePoints.map((point) => point.pair_group)), [samplePoints]);
  const points = useMemo(() => samplePoints.filter((point) => group === "all" || point.pair_group === group), [group, samplePoints]);
  const sample = nearBiOnly ? "near_bi" : "eligible";
  const summaries = useMemo(() => PRIMARY_METHODS.map((methodId) =>
    summarizeAggregationPoints(points, methodId, group, sample)
  ), [group, points, sample]);
  const rankedMethods = [...summaries].filter((row) => row.method !== "best_single").sort((a, b) =>
    (b.support_weighted_gain_fraction ?? -Infinity) - (a.support_weighted_gain_fraction ?? -Infinity)
  );
  const activeSummary = summaries.find((row) => row.method === method);
  const selected = points.find((point) => `${point.model_a}::${point.model_b}` === selectedKey)
    ?? [...points].sort((a, b) =>
      (b.gain_fraction_vs_best_single[method] ?? -Infinity) - (a.gain_fraction_vs_best_single[method] ?? -Infinity)
    )[0];

  useEffect(() => {
    if (selected) setSelectedKey(`${selected.model_a}::${selected.model_b}`);
  }, [focalModel, group, nearBiOnly, method, selected?.model_a, selected?.model_b]);

  useEffect(() => {
    if (group !== "all" && !availableGroups.has(group as PairGroupId)) setGroup("all");
  }, [availableGroups, group]);

  useEffect(() => {
    if (!focalModel || !nearBiOnly || focalPoints.some((point) => point.near_bi)) return;
    setNearBiOnly(false);
  }, [focalModel, focalPoints, nearBiOnly]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (focalModel) params.set("gain_model", focalModel);
    else params.delete("gain_model");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [focalModel]);

  const xValues = points.map((point) => point.metrics[metric].complementarity);
  const yValues = points.map((point) => point.gain_fraction_vs_best_single[method] ?? 0);
  const xDomain = extent(xValues.length ? xValues : [0, 1]);
  const yDomain = extent(yValues.length ? yValues : [0], true);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = (value: number) => MARGIN.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  const yScale = (value: number) => MARGIN.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;
  const correlation = pearson(xValues, yValues);
  const maxOverlap = Math.max(1, ...points.map((point) => point.n_overlap));
  const metricMeta = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const groupMeta = GROUPS.find((item) => item.id === group) ?? GROUPS[0];
  const activeSampleLabel = focalSampleLabel(focalModel, group, groupMeta.label);

  function chooseFocalModel(value: string) {
    setFocalModel(value);
    setGroup("all");
    setSelectedKey("");
    if (value && nearBiOnly) {
      const related = data.points.filter((point) => point.model_a === value || point.model_b === value);
      if (!related.some((point) => point.near_bi)) setNearBiOnly(false);
    }
  }

  return (
    <section className="pair-aggregation-section" id="gain">
      <div className="section-heading pair-aggregation-heading">
        <div><p className="eyebrow">ALL-PAIR AGGREGATION BENCHMARK</p><h2>Can a pool beat its best constituent?</h2></div>
        <p>Select one exact model version to compare its aggregation result with every eligible GPT or Claude partner. Every method uses identical pair-common targets; positive gain means lower adjusted Brier than the hindsight-better single model.</p>
      </div>

      <div className="pair-aggregation-controls">
        <div className="pair-group-tabs" role="tablist" aria-label="Model pair group">
          {GROUPS.map((item) => {
            const disabled = item.id !== "all" && !availableGroups.has(item.id as PairGroupId);
            return <button type="button" role="tab" aria-selected={group === item.id} className={group === item.id ? "active" : ""} disabled={disabled} onClick={() => setGroup(item.id)} key={item.id}>{item.short}</button>;
          })}
        </div>
        <div className="aggregation-filter-cluster">
          <label className="aggregation-focal-select">
            <span>FOCAL MODEL</span>
            <select aria-label="Aggregation focal model" value={focalModel} onChange={(event) => chooseFocalModel(event.target.value)}>
              <option value="">All models</option>
              <optgroup label="GPT">
                {data.model_scope.gpt_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Claude">
                {data.model_scope.claude_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
            </select>
          </label>
          <div className="gain-sample-toggle" role="group" aria-label="Aggregation sample">
            <button type="button" className={!nearBiOnly ? "active" : ""} onClick={() => setNearBiOnly(false)}>All eligible</button>
            <button type="button" className={nearBiOnly ? "active" : ""} onClick={() => setNearBiOnly(true)}>Near-BI only</button>
          </div>
        </div>
      </div>

      <div className="aggregation-overview">
        <div className="aggregation-method-table" role="table" aria-label="Aggregation method comparison">
          <div className="aggregation-method-head" role="row"><span>METHOD</span><span>WEIGHTED GAIN</span><span>POSITIVE PAIRS</span><span>MACRO GAIN</span></div>
          {summaries.map((row) => {
            const isBaseline = row.method === "best_single";
            const rank = rankedMethods.findIndex((item) => item.method === row.method) + 1;
            return <button type="button" role="row" className={`aggregation-method-row ${method === row.method ? "active" : ""}`} onClick={() => setMethod(row.method)} key={row.method}>
              <span><i>{isBaseline ? "B" : String(rank).padStart(2, "0")}</i><strong>{data.methods[row.method].label}</strong><small>{isBaseline ? "Hindsight benchmark" : data.methods[row.method].outcome_blind ? "Outcome-blind pool" : "Benchmark"}</small></span>
              <strong className={(row.support_weighted_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(row.support_weighted_gain_fraction)}</strong>
              <strong>{isBaseline ? "—" : `${row.positive_pairs}/${row.pair_count}`}</strong>
              <strong className={(row.macro_mean_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(row.macro_mean_gain_fraction)}</strong>
            </button>;
          })}
        </div>

        <dl className="aggregation-selection-summary">
          <div><dt>ACTIVE SAMPLE</dt><dd title={activeSampleLabel}>{activeSampleLabel}</dd><small>{nearBiOnly ? `Near-BI · gap ≤ ${data.near_bi.threshold_bi_points.toFixed(1)}` : "All eligible pairs"}</small></div>
          <div><dt>PAIR COUNT</dt><dd>{points.length}</dd><small>{points.reduce((total, point) => total + point.n_overlap, 0).toLocaleString()} duplicated pair-event cells</small></div>
          <div><dt>SELECTED METHOD</dt><dd>{data.methods[method].label}</dd><small>{data.methods[method].formula}</small></div>
          <div><dt>WEIGHTED GAIN</dt><dd className={(activeSummary?.support_weighted_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(activeSummary?.support_weighted_gain_fraction ?? null)}</dd><small>pair fractions weighted by common support</small></div>
          <div><dt>COMPLEMENTARITY r</dt><dd>{correlation?.toFixed(2) ?? "—"}</dd><small>{metricMeta.label} versus selected-method gain</small></div>
        </dl>
      </div>

      <div className="aggregation-metric-tabs" role="tablist" aria-label="Aggregation complementarity metric">
        {METRICS.map((item) => <button type="button" role="tab" aria-selected={metric === item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)} key={item.id}>{item.label}</button>)}
      </div>

      <div className="pair-aggregation-chart-wrap">
        <div className="pair-group-legend"><span><i className="gpt" /> GPT × GPT</span><span><i className="claude" /> Claude × Claude</span><span><i className="cross" /> GPT × Claude</span><small>Circle area reflects common-event support</small></div>
        {points.length ? <svg className="pair-aggregation-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metricMeta.label} versus ${data.methods[method].label} gain for ${activeSampleLabel}`}>
          <defs><linearGradient id="cross-pair-fill"><stop offset="50%" stopColor="#efab02" /><stop offset="50%" stopColor="#4f207f" /></linearGradient></defs>
          <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={Math.max(0, yScale(0) - MARGIN.top)} className="gain-positive-zone" />
          <rect x={MARGIN.left} y={yScale(0)} width={plotWidth} height={Math.max(0, MARGIN.top + plotHeight - yScale(0))} className="gain-negative-zone" />
          {ticks(yDomain).map((tick) => <g key={`y-${tick}`}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} className={Math.abs(tick) < 1e-10 ? "gain-zero-line" : "gain-grid-line"} /><text x={MARGIN.left - 14} y={yScale(tick) + 4} textAnchor="end" className="gain-axis-text">{percent(tick)}</text></g>)}
          {ticks(xDomain).map((tick) => <g key={`x-${tick}`}><line x1={xScale(tick)} x2={xScale(tick)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="gain-grid-line vertical" /><text x={xScale(tick)} y={MARGIN.top + plotHeight + 27} textAnchor="middle" className="gain-axis-text">{metricValue(tick, metric)}</text></g>)}
          {points.map((point) => {
            const key = `${point.model_a}::${point.model_b}`;
            const gain = point.gain_fraction_vs_best_single[method] ?? 0;
            const radius = 4.5 + 7.5 * Math.sqrt(point.n_overlap / maxOverlap);
            const isSelected = key === `${selected?.model_a}::${selected?.model_b}`;
            return <g className={`aggregation-point ${point.pair_group} ${isSelected ? "selected" : ""}`} key={key} role="button" tabIndex={0} aria-label={`${pairLabel(point)}, ${percent(gain)} gain`} onMouseEnter={() => setSelectedKey(key)} onFocus={() => setSelectedKey(key)} onClick={() => setSelectedKey(key)}>
              <circle cx={xScale(point.metrics[metric].complementarity)} cy={yScale(gain)} r={radius} />
              {isSelected && <text x={xScale(point.metrics[metric].complementarity)} y={yScale(gain) - radius - 8} textAnchor="middle" className="gain-point-label">{shortModel(point.model_a)} × {shortModel(point.model_b)}</text>}
              <title>{`${pairLabel(point)}\n${metricMeta.label}: ${point.metrics[metric].raw.toFixed(4)}\n${data.methods[method].label} gain: ${percent(gain, 2)}\nCommon targets: ${point.n_overlap.toLocaleString()}\nNear-BI: ${point.near_bi ? "Yes" : "No"}`}</title>
            </g>;
          })}
          <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 20} textAnchor="middle" className="gain-axis-title">{metricMeta.axis} · toward lower model dependence →</text>
          <text transform={`translate(24 ${MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="gain-axis-title">Gain fraction versus pair Best Single</text>
        </svg> : <div className="aggregation-empty-state"><strong>No eligible partners in this sample.</strong><span>Choose All eligible or another pair group.</span></div>}
      </div>

      {selected && <div className="aggregation-pair-detail">
        <div className="aggregation-pair-title"><span>SELECTED PAIR</span><strong>{pairLabel(selected)}</strong><small>{selected.near_bi ? "Near-BI" : "Outside near-BI"} · {selected.n_overlap.toLocaleString()} common targets · BI gap {selected.bi_gap.toFixed(2)}</small></div>
        <div className="aggregation-pair-methods">
          {PRIMARY_METHODS.map((methodId) => <div className={methodId === method ? "active" : ""} key={methodId}><span>{data.methods[methodId].label}</span><strong className={(selected.gain_fraction_vs_best_single[methodId] ?? 0) >= 0 ? "positive" : "negative"}>{percent(selected.gain_fraction_vs_best_single[methodId])}</strong><small>BI {selected.adjusted_brier[methodId].toFixed(4)}</small></div>)}
        </div>
      </div>}

      <div className="aggregation-caveats">
        <p><strong>Best Single is a benchmark, not an algorithm.</strong> It selects the lower adjusted-Brier constituent after observing all pair-common outcomes, so its gain is defined as zero. EC, Simple Mean, Log-odds Mean, and Piecewise Odds never use outcomes to form the current forecast.</p>
        <p><strong>Past-only diagnostic.</strong> A round-ordered selector is retained in the downloadable artifact, but the merged panel lacks actual resolution timestamps. It therefore uses only earlier forecast dates and is not claimed as resolution-aware OOS evidence.</p>
      </div>
    </section>
  );
}
