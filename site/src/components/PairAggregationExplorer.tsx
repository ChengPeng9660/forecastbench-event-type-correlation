import { useEffect, useMemo, useState } from "react";
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

const GROUPS: Array<{ id: PairGroupFilter; label: string; short: string }> = [
  { id: "all", label: "All four-family pairs", short: "All pairs" },
  { id: "gpt_gpt", label: "GPT × GPT", short: "GPT × GPT" },
  { id: "claude_claude", label: "Claude × Claude", short: "Claude × Claude" },
  { id: "qwen_qwen", label: "Qwen × Qwen", short: "Qwen × Qwen" },
  { id: "deepseek_deepseek", label: "DeepSeek × DeepSeek", short: "DeepSeek × DeepSeek" },
  { id: "gpt_claude", label: "GPT × Claude", short: "GPT × Claude" },
  { id: "gpt_qwen", label: "GPT × Qwen", short: "GPT × Qwen" },
  { id: "gpt_deepseek", label: "GPT × DeepSeek", short: "GPT × DeepSeek" },
  { id: "claude_qwen", label: "Claude × Qwen", short: "Claude × Qwen" },
  { id: "claude_deepseek", label: "Claude × DeepSeek", short: "Claude × DeepSeek" },
  { id: "qwen_deepseek", label: "Qwen × DeepSeek", short: "Qwen × DeepSeek" },
];

type EvaluationMode = "cross_fit" | "same_sample";

const FAMILY_COLORS: Record<ModelFamily, string> = {
  GPT: "#efab02",
  Claude: "#4f207f",
  Qwen: "#267c79",
  DeepSeek: "#c75b39",
};

const GROUP_FAMILIES: Record<PairGroupId, [ModelFamily, ModelFamily]> = {
  gpt_gpt: ["GPT", "GPT"],
  claude_claude: ["Claude", "Claude"],
  qwen_qwen: ["Qwen", "Qwen"],
  deepseek_deepseek: ["DeepSeek", "DeepSeek"],
  gpt_claude: ["GPT", "Claude"],
  gpt_qwen: ["GPT", "Qwen"],
  gpt_deepseek: ["GPT", "DeepSeek"],
  claude_qwen: ["Claude", "Qwen"],
  claude_deepseek: ["Claude", "DeepSeek"],
  qwen_deepseek: ["Qwen", "DeepSeek"],
};

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

export function PairAggregationExplorer({ data }: { data: PairAggregationData }) {
  const modelOptions = [
    ...data.model_scope.gpt_models,
    ...data.model_scope.claude_models,
    ...data.model_scope.qwen_models,
    ...data.model_scope.deepseek_models,
  ];
  const [focalModel, setFocalModel] = useState(() => {
    if (typeof window === "undefined") return "";
    const candidate = new URLSearchParams(window.location.search).get("gain_model") ?? "";
    return modelOptions.includes(candidate) ? candidate : "";
  });
  const [evaluation, setEvaluation] = useState<EvaluationMode>(() => {
    if (typeof window === "undefined") return "cross_fit";
    return new URLSearchParams(window.location.search).get("gain_eval") === "same_sample" ? "same_sample" : "cross_fit";
  });
  const [group, setGroup] = useState<PairGroupFilter>("all");
  const [nearBiOnly, setNearBiOnly] = useState(true);
  const [method, setMethod] = useState<AggregationMethodId>("ec_w0_56");
  const [metric, setMetric] = useState<MetricId>("adjusted_pog");
  const [selectedKey, setSelectedKey] = useState("");

  const evaluationPoints = useMemo(() => {
    if (evaluation === "cross_fit") {
      return nearBiOnly ? data.cross_fit.near_bi_points : data.cross_fit.eligible_points;
    }
    return data.points.filter((point) => !nearBiOnly || point.near_bi);
  }, [data.cross_fit.eligible_points, data.cross_fit.near_bi_points, data.points, evaluation, nearBiOnly]);
  const focalPoints = useMemo(() => evaluationPoints.filter((point) =>
    !focalModel || point.model_a === focalModel || point.model_b === focalModel
  ), [evaluationPoints, focalModel]);
  const availableGroups = useMemo(() => new Set(GROUPS.filter((item) =>
    focalPoints.some((point) => matchesGroup(point, item.id))
  ).map((item) => item.id)), [focalPoints]);
  const points = useMemo(() => focalPoints.filter((point) => matchesGroup(point, group)), [focalPoints, group]);
  const definedPoints = useMemo(() => points.filter((point) =>
    point.metrics[metric].complementarity !== null && point.gain_fraction_vs_best_single[method] !== null
  ), [method, metric, points]);
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
      (b.gain_fraction_vs_best_single[method] ?? -Infinity) - (a.gain_fraction_vs_best_single[method] ?? -Infinity)
    )[0];

  useEffect(() => {
    if (selected) setSelectedKey(`${selected.model_a}::${selected.model_b}`);
  }, [evaluation, focalModel, group, nearBiOnly, method, metric, selected?.model_a, selected?.model_b]);

  useEffect(() => {
    if (group !== "all" && !availableGroups.has(group)) setGroup("all");
  }, [availableGroups, group]);

  useEffect(() => {
    if (!focalModel || !nearBiOnly || focalPoints.length) return;
    setNearBiOnly(false);
  }, [evaluation, focalModel, focalPoints.length, nearBiOnly]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (focalModel) params.set("gain_model", focalModel);
    else params.delete("gain_model");
    if (evaluation === "same_sample") params.set("gain_eval", evaluation);
    else params.delete("gain_eval");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [evaluation, focalModel]);

  const xValues = definedPoints.map((point) => point.metrics[metric].complementarity as number);
  const yValues = definedPoints.map((point) => point.gain_fraction_vs_best_single[method] as number);
  const xDomain = extent(xValues.length ? xValues : [0, 1]);
  const yDomain = extent(yValues.length ? yValues : [0], true);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = (value: number) => MARGIN.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  const yScale = (value: number) => MARGIN.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;
  const correlation = pearson(xValues, yValues);
  const maxOverlap = Math.max(1, ...definedPoints.map((point) => point.n_overlap));
  const metricMeta = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const groupMeta = GROUPS.find((item) => item.id === group) ?? GROUPS[0];
  const activeSampleLabel = focalSampleLabel(focalModel, group, groupMeta.label);

  function chooseFocalModel(value: string) {
    setFocalModel(value);
    setGroup("all");
    setSelectedKey("");
    if (value && nearBiOnly) {
      const source = evaluation === "cross_fit" ? data.cross_fit.near_bi_points : data.points.filter((point) => point.near_bi);
      if (!source.some((point) => point.model_a === value || point.model_b === value)) setNearBiOnly(false);
    }
  }

  return (
    <section className="pair-aggregation-section" id="gain">
      <div className="section-heading pair-aggregation-heading">
        <div><p className="eyebrow">CROSS-FIT AGGREGATION BENCHMARK</p><h2>Does train-fold dependence predict test-fold gain?</h2></div>
        <p>GPT, Claude, Qwen, and DeepSeek events are split into two disjoint folds. Dependence and Near-BI use one fold; aggregation gain uses the other, then train and test swap.</p>
      </div>

      <div className="aggregation-evaluation-bar">
        <div className="aggregation-evaluation-toggle" role="group" aria-label="Aggregation evaluation design">
          <button type="button" className={evaluation === "cross_fit" ? "active" : ""} onClick={() => { setEvaluation("cross_fit"); setGroup("all"); setSelectedKey(""); }}>Cross-fit OOS</button>
          <button type="button" className={evaluation === "same_sample" ? "active" : ""} onClick={() => { setEvaluation("same_sample"); setGroup("all"); setSelectedKey(""); }}>Same-sample diagnostic</button>
        </div>
        <p>{evaluation === "cross_fit"
          ? `Seed ${data.cross_fit.split.seed} · ${data.cross_fit.audit.fold_a_events.toLocaleString()} / ${data.cross_fit.audit.fold_b_events.toLocaleString()} disjoint events · Near-BI is train-only`
          : "Dependence, Near-BI, and gain use the same outcomes; retained only as a sensitivity view."}</p>
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
              <option value="">All models</option>
              <optgroup label="GPT">
                {data.model_scope.gpt_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Claude">
                {data.model_scope.claude_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="Qwen">
                {data.model_scope.qwen_models.map((model) => <option value={model} key={model}>{model}</option>)}
              </optgroup>
              <optgroup label="DeepSeek">
                {data.model_scope.deepseek_models.map((model) => <option value={model} key={model}>{model}</option>)}
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
          <div><dt>ACTIVE SAMPLE</dt><dd title={activeSampleLabel}>{activeSampleLabel}</dd><small>{evaluation === "cross_fit" ? "Cross-fit OOS · " : "Same-sample · "}{nearBiOnly ? `train BI gap ≤ ${data.near_bi.threshold_bi_points.toFixed(1)}` : "all eligible pairs"}</small></div>
          <div><dt>PAIR COUNT</dt><dd>{points.length}</dd><small>{points.reduce((total, point) => total + point.n_overlap, 0).toLocaleString()} {evaluation === "cross_fit" ? "test" : "same-sample"} pair-event cells</small></div>
          <div><dt>SELECTED METHOD</dt><dd>{data.methods[method].label}</dd><small>{data.methods[method].formula}</small></div>
          <div><dt>WEIGHTED GAIN</dt><dd className={(activeSummary?.support_weighted_gain_fraction ?? 0) >= 0 ? "positive" : "negative"}>{percent(activeSummary?.support_weighted_gain_fraction ?? null)}</dd><small>pair fractions weighted by common support</small></div>
          <div><dt>COMPLEMENTARITY r</dt><dd>{correlation?.toFixed(2) ?? "—"}</dd><small>{evaluation === "cross_fit" ? "train metric versus opposite-fold gain" : "same-sample descriptive association"}</small></div>
        </dl>
      </div>

      <div className="aggregation-metric-tabs" role="tablist" aria-label="Aggregation complementarity metric">
        {METRICS.map((item) => <button type="button" role="tab" aria-selected={metric === item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)} key={item.id}>{item.label}</button>)}
      </div>

      <div className="pair-aggregation-chart-wrap">
        <div className="pair-group-legend">
          {(Object.keys(FAMILY_COLORS) as ModelFamily[]).map((family) => <span key={family}><i style={{ background: FAMILY_COLORS[family] }} /> {family}</span>)}
          <small>Split color = cross-family pair · area = test support</small>
        </div>
        {definedPoints.length ? <svg className="pair-aggregation-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metricMeta.label} versus ${data.methods[method].label} gain for ${activeSampleLabel}`}>
          <defs>
            {(Object.entries(GROUP_FAMILIES) as Array<[PairGroupId, [ModelFamily, ModelFamily]]>).map(([pairGroup, families]) => <linearGradient id={`pair-fill-${pairGroup}`} key={pairGroup}>
              <stop offset="50%" stopColor={FAMILY_COLORS[families[0]]} />
              <stop offset="50%" stopColor={FAMILY_COLORS[families[1]]} />
            </linearGradient>)}
          </defs>
          <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={Math.max(0, yScale(0) - MARGIN.top)} className="gain-positive-zone" />
          <rect x={MARGIN.left} y={yScale(0)} width={plotWidth} height={Math.max(0, MARGIN.top + plotHeight - yScale(0))} className="gain-negative-zone" />
          {ticks(yDomain).map((tick) => <g key={`y-${tick}`}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} className={Math.abs(tick) < 1e-10 ? "gain-zero-line" : "gain-grid-line"} /><text x={MARGIN.left - 14} y={yScale(tick) + 4} textAnchor="end" className="gain-axis-text">{percent(tick)}</text></g>)}
          {ticks(xDomain).map((tick) => <g key={`x-${tick}`}><line x1={xScale(tick)} x2={xScale(tick)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="gain-grid-line vertical" /><text x={xScale(tick)} y={MARGIN.top + plotHeight + 27} textAnchor="middle" className="gain-axis-text">{metricValue(tick, metric)}</text></g>)}
          {definedPoints.map((point) => {
            const key = `${point.model_a}::${point.model_b}`;
            const gain = point.gain_fraction_vs_best_single[method] as number;
            const complementarity = point.metrics[metric].complementarity as number;
            const radius = 4.5 + 7.5 * Math.sqrt(point.n_overlap / maxOverlap);
            const isSelected = key === `${selected?.model_a}::${selected?.model_b}`;
            return <g className={`aggregation-point ${point.pair_group} ${isSelected ? "selected" : ""}`} key={key} role="button" tabIndex={0} aria-label={`${pairLabel(point)}, ${percent(gain)} gain`} onMouseEnter={() => setSelectedKey(key)} onFocus={() => setSelectedKey(key)} onClick={() => setSelectedKey(key)}>
              <circle cx={xScale(complementarity)} cy={yScale(gain)} r={radius} style={{ fill: `url(#pair-fill-${point.pair_group})` }} />
              {isSelected && <text x={xScale(complementarity)} y={yScale(gain) - radius - 8} textAnchor="middle" className="gain-point-label">{shortModel(point.model_a)} × {shortModel(point.model_b)}</text>}
              <title>{`${pairLabel(point)}\n${metricMeta.label}: ${point.metrics[metric].raw?.toFixed(4) ?? "undefined"}\n${data.methods[method].label} gain: ${percent(gain, 2)}\n${evaluation === "cross_fit" ? "Test" : "Common"} targets: ${point.n_overlap.toLocaleString()}\n${evaluation === "cross_fit" ? `Included folds: ${point.cross_fit?.included_fold_count ?? 0}/2` : `Near-BI: ${point.near_bi ? "Yes" : "No"}`}`}</title>
            </g>;
          })}
          <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 20} textAnchor="middle" className="gain-axis-title">{metricMeta.axis} · Lower diversity → Higher diversity</text>
          <text transform={`translate(24 ${MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="gain-axis-title">Gain fraction versus pair Best Single</text>
        </svg> : <div className="aggregation-empty-state"><strong>No eligible partners in this sample.</strong><span>Choose All eligible or another pair group.</span></div>}
      </div>

      {selected && <div className="aggregation-pair-detail">
        <div className="aggregation-pair-title"><span>SELECTED PAIR</span><strong>{pairLabel(selected)}</strong><small>{evaluation === "cross_fit"
          ? `${selected.cross_fit?.included_fold_count ?? 0}/2 train→test folds · ${(selected.cross_fit?.train_target_rows ?? 0).toLocaleString()} train · ${(selected.cross_fit?.test_target_rows ?? 0).toLocaleString()} test · train BI gap ${selected.bi_gap.toFixed(2)}`
          : `${selected.near_bi ? "Near-BI" : "Outside near-BI"} · ${selected.n_overlap.toLocaleString()} common targets · BI gap ${selected.bi_gap.toFixed(2)}`}</small></div>
        <div className="aggregation-pair-methods">
          {PRIMARY_METHODS.map((methodId) => <div className={methodId === method ? "active" : ""} key={methodId}><span>{data.methods[methodId].label}</span><strong className={(selected.gain_fraction_vs_best_single[methodId] ?? 0) >= 0 ? "positive" : "negative"}>{percent(selected.gain_fraction_vs_best_single[methodId])}</strong><small>BI {selected.adjusted_brier[methodId].toFixed(4)}</small></div>)}
        </div>
      </div>}

      <div className="aggregation-caveats">
        <p><strong>Event-disjoint cross-fit.</strong> SHA-256 with seed {data.cross_fit.split.seed} assigns every (source, event_id)—including every date and horizon—to one fold. Dependence and Near-BI use only the training fold; gain uses only the opposite test fold, then A/B swap.</p>
        <p><strong>Best Single is a test benchmark, not an algorithm.</strong> It selects the lower adjusted-Brier constituent after observing that test fold, so its gain is zero by definition. EC, Simple Mean, Log-odds Mean, and Piecewise Odds never use test outcomes to form predictions.</p>
      </div>
    </section>
  );
}
