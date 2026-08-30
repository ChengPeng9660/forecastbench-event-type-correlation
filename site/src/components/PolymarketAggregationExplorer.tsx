import { useEffect, useMemo, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import type {
  AggregationMethodId,
  MetricId,
  ModelFamily,
  PolymarketAggregationData,
  PolymarketAggregationPoint,
  PolymarketPairGroup,
} from "../types/data";

const WIDTH = 980;
const HEIGHT = 480;
const MARGIN = { top: 24, right: 32, bottom: 76, left: 86 };

const METHODS: AggregationMethodId[] = [
  "ec_w0_56",
  "simple_mean",
  "log_odds_mean",
  "piecewise_odds",
  "best_single",
];

const GROUPS: Array<{ id: PolymarketPairGroup; label: string }> = [
  { id: "all", label: "All models" },
  { id: "gpt", label: "GPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "qwen", label: "Qwen" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "kimi", label: "Kimi" },
];

const METRICS: Array<{ id: MetricId; label: string; axis: string }> = [
  { id: "adjusted_pog", label: "Adjusted POG", axis: "Adjusted pairwise oracle gain" },
  { id: "high_loss_lift", label: "High-loss lift", axis: "Complementarity orientation · 1 − lift" },
  { id: "adjusted_loss_corr", label: "Loss correlation", axis: "Complementarity orientation · − correlation" },
  { id: "total_variation", label: "Total variation (TV)", axis: "Mean absolute probability difference · TV" },
];

export type PolymarketOutcomeId = "aggregation_bi" | "gain_vs_polymarket" | "gain_vs_model";

const OUTCOMES: Array<{ id: PolymarketOutcomeId; label: string; axis: string; correlation: string }> = [
  {
    id: "aggregation_bi",
    label: "Aggregation BI",
    axis: "Aggregation Brier Index (higher is better)",
    correlation: "BI",
  },
  {
    id: "gain_vs_polymarket",
    label: "Gain vs Polymarket",
    axis: "Gain vs Polymarket (fractional adjusted-Brier reduction)",
    correlation: "GAIN",
  },
  {
    id: "gain_vs_model",
    label: "Gain vs Model",
    axis: "Gain vs Model (fractional adjusted-Brier reduction)",
    correlation: "GAIN",
  },
];

export type PolymarketFoldView = "combined" | "a_to_b" | "b_to_a";

const FOLD_VIEWS: Array<{ id: PolymarketFoldView; label: string; detail: string }> = [
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
  return metric === "adjusted_pog" || metric === "total_variation" ? value.toFixed(3) : value.toFixed(2);
}

function shortModel(model: string) {
  return model.replace(/-20\d{2}.*/, "");
}

export function polymarketOutcomeValue(
  point: PolymarketAggregationPoint,
  method: AggregationMethodId,
  outcome: PolymarketOutcomeId,
) {
  if (outcome === "gain_vs_polymarket") return point.gain_fraction_vs_polymarket[method];
  if (outcome === "gain_vs_model") return point.gain_fraction_vs_model[method];
  return point.brier_index[method];
}

export function selectPolymarketPoints(
  data: PolymarketAggregationData,
  foldView: PolymarketFoldView,
  nearBiOnly: boolean,
) {
  if (foldView === "combined") {
    return nearBiOnly ? data.cross_fit.near_bi_points : data.cross_fit.eligible_points;
  }
  const directional = data.cross_fit.directional_points[foldView];
  return nearBiOnly ? directional.near_bi_points : directional.eligible_points;
}

interface MethodSummary {
  method: AggregationMethodId;
  pairCount: number;
  support: number;
  weightedBi: number | null;
  gainVsPolymarket: number | null;
  gainVsModel: number | null;
  positiveVsPolymarket: number;
}

export function summarizePolymarketPoints(
  points: PolymarketAggregationPoint[],
  method: AggregationMethodId,
): MethodSummary {
  const valid = points.filter((point) =>
    Number.isFinite(point.brier_index[method])
    && point.gain_fraction_vs_polymarket[method] !== null
    && point.gain_fraction_vs_model[method] !== null
  );
  const support = valid.reduce((total, point) => total + point.n_overlap, 0);
  const weighted = (value: (point: PolymarketAggregationPoint) => number | null) => {
    if (!support) return null;
    return valid.reduce((total, point) => total + (value(point) as number) * point.n_overlap, 0) / support;
  };
  return {
    method,
    pairCount: valid.length,
    support,
    weightedBi: weighted((point) => point.brier_index[method]),
    gainVsPolymarket: weighted((point) => point.gain_fraction_vs_polymarket[method]),
    gainVsModel: weighted((point) => point.gain_fraction_vs_model[method]),
    positiveVsPolymarket: valid.filter((point) => (point.gain_fraction_vs_polymarket[method] as number) > 0).length,
  };
}

interface PolymarketAggregationExplorerProps {
  data: PolymarketAggregationData;
}

export function PolymarketAggregationExplorer({ data }: PolymarketAggregationExplorerProps) {
  const [foldView, setFoldView] = useState<PolymarketFoldView>("combined");
  const [group, setGroup] = useState<PolymarketPairGroup>("all");
  const [model, setModel] = useState("");
  const [method, setMethod] = useState<AggregationMethodId>("ec_w0_56");
  const [metric, setMetric] = useState<MetricId>("adjusted_pog");
  const [outcome, setOutcome] = useState<PolymarketOutcomeId>("aggregation_bi");
  const [nearBiOnly, setNearBiOnly] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  const nearBiCount = data.cross_fit.audit.near_bi_pairs_any_train_fold;

  const sourcePoints = useMemo(
    () => selectPolymarketPoints(data, foldView, nearBiOnly),
    [data, foldView, nearBiOnly],
  );
  const points = useMemo(() => sourcePoints.filter((point) =>
    (group === "all" || point.pair_group === group)
    && (!model || point.model_b === model)
  ), [group, model, sourcePoints]);
  const definedPoints = useMemo(() => points.filter((point) =>
    point.metrics[metric].complementarity !== null
    && Number.isFinite(polymarketOutcomeValue(point, method, outcome))
  ), [method, metric, outcome, points]);
  const summaries = useMemo(
    () => METHODS.map((methodId) => summarizePolymarketPoints(points, methodId)),
    [points],
  );
  const activeSummary = summaries.find((row) => row.method === method);
  const activeSelectedModel = definedPoints.some((point) => point.model_b === selectedModel)
    ? selectedModel
    : [...definedPoints].sort((a, b) =>
      (polymarketOutcomeValue(b, method, outcome) as number)
      - (polymarketOutcomeValue(a, method, outcome) as number)
    )[0]?.model_b ?? "";
  const selected = definedPoints.find((point) => point.model_b === activeSelectedModel);

  useEffect(() => {
    if (selected) setSelectedModel(selected.model_b);
  }, [foldView, group, model, nearBiOnly, method, metric, outcome, selected?.model_b]);

  useEffect(() => {
    if (group === "all") return;
    if (!sourcePoints.some((point) => point.pair_group === group)) setGroup("all");
  }, [group, sourcePoints]);

  useEffect(() => {
    if (!nearBiCount && nearBiOnly) setNearBiOnly(false);
  }, [nearBiCount, nearBiOnly]);

  const xValues = definedPoints.map((point) => point.metrics[metric].complementarity as number);
  const yValues = definedPoints.map((point) => polymarketOutcomeValue(point, method, outcome) as number);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : extent(xValues.length ? xValues : [0, 1]);
  const yDomain = extent(yValues.length ? yValues : [0, 1], outcome !== "aggregation_bi");
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = (value: number) => MARGIN.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  const yScale = (value: number) => MARGIN.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;
  const correlation = pearson(xValues, yValues);
  const maxOverlap = Math.max(1, ...definedPoints.map((point) => point.n_overlap));
  const metricMeta = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const outcomeMeta = OUTCOMES.find((item) => item.id === outcome) ?? OUTCOMES[0];
  const foldMeta = FOLD_VIEWS.find((item) => item.id === foldView) ?? FOLD_VIEWS[0];
  const matchAudit = data.provenance.match_audit;
  const familyModels: Array<[ModelFamily, string[]]> = [
    ["GPT", data.model_scope.gpt_models],
    ["Claude", data.model_scope.claude_models],
    ["Gemini", data.model_scope.gemini_models],
    ["Qwen", data.model_scope.qwen_models],
    ["DeepSeek", data.model_scope.deepseek_models],
    ["Kimi", data.model_scope.kimi_models],
  ];

  return (
    <section className="polymarket-aggregation-section" id="polymarket-aggregation">
      <div className="section-heading polymarket-aggregation-heading">
        <div><p className="eyebrow">POLYMARKET × MODEL</p><h2>Can an LLM improve the market snapshot?</h2></div>
        <p>Pair a model with the freeze-time market forecast on shared, non-imputed Polymarket events. Dataset questions are excluded.</p>
      </div>

      <div className="aggregation-evaluation-bar">
        <strong>Cross-fit OOS</strong>
        <p>{data.cross_fit.split.repetitions} repeated splits · train diversity → test performance</p>
      </div>

      <div className="aggregation-fold-bar">
        <span>FOLD VIEW</span>
        <div className="aggregation-fold-toggle" role="group" aria-label="Polymarket cross-fit fold view">
          {FOLD_VIEWS.map((item) => <button type="button" className={foldView === item.id ? "active" : ""} onClick={() => { setFoldView(item.id); setSelectedModel(""); }} key={item.id}>{item.label}</button>)}
        </div>
        <small>{foldMeta.detail}</small>
      </div>

      <div className="polymarket-controls">
        <div className="pair-group-tabs" role="tablist" aria-label="Polymarket paired model family">
          {GROUPS.map((item) => <button type="button" role="tab" aria-selected={group === item.id} className={group === item.id ? "active" : ""} onClick={() => { setGroup(item.id); setModel(""); setSelectedModel(""); }} key={item.id}>{item.label}</button>)}
        </div>
        <div className="aggregation-filter-cluster">
          <label className="aggregation-focal-select">
            <span>PAIRED MODEL</span>
            <select aria-label="Polymarket paired model" value={model} onChange={(event) => { setModel(event.target.value); setGroup("all"); setSelectedModel(""); }}>
              <option value="">All paired models</option>
              {familyModels.map(([family, models]) => <optgroup label={family} key={family}>{models.map((item) => <option value={item} key={item}>{item}</option>)}</optgroup>)}
            </select>
          </label>
          <div className="gain-sample-toggle" role="group" aria-label="Polymarket aggregation sample">
            <button type="button" className={!nearBiOnly ? "active" : ""} onClick={() => setNearBiOnly(false)}>All eligible</button>
            <button type="button" disabled={!nearBiCount} className={nearBiOnly ? "active" : ""} onClick={() => setNearBiOnly(true)}>Near-BI ({nearBiCount})</button>
          </div>
        </div>
      </div>

      {!nearBiCount && <p className="polymarket-near-bi-note"><strong>No Near-BI pairs.</strong> No training fold is within {data.near_bi.threshold_bi_points.toFixed(1)} BI points of Polymarket Freeze on common support.</p>}

      <div className="polymarket-chart-controls">
        <label className="research-method-select">
          <span>AGGREGATION</span>
          <select aria-label="Polymarket aggregation method" value={method} onChange={(event) => setMethod(event.target.value as AggregationMethodId)}>
            {summaries.map((row) => <option value={row.method} key={row.method}>{data.methods[row.method].label}{row.method === "best_single" ? " (hindsight)" : ""}</option>)}
          </select>
        </label>
        <div className="aggregation-metric-tabs" role="tablist" aria-label="Polymarket complementarity metric">
          {METRICS.map((item) => <button type="button" role="tab" aria-selected={metric === item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)} key={item.id}>{item.label}</button>)}
        </div>
        <div className="polymarket-y-axis-toggle" role="group" aria-label="Polymarket chart outcome">
          <span>Y AXIS</span>
          <div>{OUTCOMES.map((item) => <button type="button" className={outcome === item.id ? "active" : ""} aria-pressed={outcome === item.id} onClick={() => { setOutcome(item.id); setSelectedModel(""); }} key={item.id}>{item.label}</button>)}</div>
        </div>
      </div>

      <div className="pair-aggregation-chart-wrap polymarket-chart-wrap">
        <div className="pair-group-legend">
          <span><i className="polymarket-baseline-key" /> Polymarket Freeze baseline</span>
          {(Object.keys(FAMILY_COLORS) as ModelFamily[]).map((family) => <span key={family}><i style={{ background: FAMILY_COLORS[family] }} /> {family}</span>)}
          <small>Gold ring = market baseline · area = test support</small>
        </div>
        {definedPoints.length ? <svg className="pair-aggregation-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metricMeta.label} versus ${data.methods[method].label} ${outcomeMeta.label} for Polymarket Freeze pairs`}>
          {ticks(yDomain).map((tick) => <g key={`y-${tick}`}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} className="gain-grid-line" /><text x={MARGIN.left - 14} y={yScale(tick) + 4} textAnchor="end" className="gain-axis-text">{outcome === "aggregation_bi" ? tick.toFixed(2) : `${(tick * 100).toFixed(0)}%`}</text></g>)}
          {outcome !== "aggregation_bi" && yDomain[0] <= 0 && yDomain[1] >= 0 && <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(0)} y2={yScale(0)} className="gain-zero-line" />}
          {ticks(xDomain).map((tick) => <g key={`x-${tick}`}><line x1={xScale(tick)} x2={xScale(tick)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="gain-grid-line vertical" /><text x={xScale(tick)} y={MARGIN.top + plotHeight + 27} textAnchor="middle" className="gain-axis-text">{metricValue(tick, metric)}</text></g>)}
          {definedPoints.map((point) => {
            const complementarity = point.metrics[metric].complementarity as number;
            const aggregationBi = point.brier_index[method];
            const outcomeValue = polymarketOutcomeValue(point, method, outcome) as number;
            const radius = 4.5 + 7.5 * Math.sqrt(point.n_overlap / maxOverlap);
            const isSelected = point.model_b === activeSelectedModel;
            return <g className={`polymarket-point ${isSelected ? "selected" : ""}`} role="button" tabIndex={0} aria-label={`Polymarket Freeze × ${point.model_b}, ${outcomeMeta.label} ${outcome === "aggregation_bi" ? outcomeValue.toFixed(2) : percent(outcomeValue)}`} onMouseEnter={() => setSelectedModel(point.model_b)} onFocus={() => setSelectedModel(point.model_b)} onClick={() => setSelectedModel(point.model_b)} key={point.model_b}>
              <circle cx={xScale(complementarity)} cy={yScale(outcomeValue)} r={radius} fill={FAMILY_COLORS[point.family_b]} />
              {isSelected && <text x={xScale(complementarity)} y={yScale(outcomeValue) - radius - 8} textAnchor="middle" className="gain-point-label">{shortModel(point.model_b)}</text>}
              <title>{`${data.baseline.label} × ${point.model_b}\n${metricMeta.label}: ${point.metrics[metric].raw?.toFixed(4) ?? "undefined"}\n${data.methods[method].label} BI: ${aggregationBi.toFixed(2)}\nGain vs Polymarket: ${percent(point.gain_fraction_vs_polymarket[method])}\nGain vs model: ${percent(point.gain_fraction_vs_model[method])}\nTest support: ${point.n_overlap.toLocaleString()}`}</title>
            </g>;
          })}
          <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 20} textAnchor="middle" className="gain-axis-title">{metricMeta.axis} · Lower diversity → Higher diversity</text>
          <text transform={`translate(24 ${MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="gain-axis-title">{outcomeMeta.axis}</text>
        </svg> : <div className="aggregation-empty-state"><strong>No eligible Polymarket–model pairs in this view.</strong><span>Return to All eligible or choose another model family.</span></div>}
      </div>

      <div className="polymarket-overview">
        <div className="polymarket-method-table" role="table" aria-label="Polymarket aggregation method comparison">
          <div className="polymarket-method-head" role="row"><span>METHOD</span><span>BI ↑</span><span>GAIN VS PM</span><span>GAIN VS MODEL</span><span>POSITIVE VS PM</span></div>
          {summaries.map((row, index) => <button type="button" role="row" className={`polymarket-method-row ${method === row.method ? "active" : ""}`} onClick={() => setMethod(row.method)} key={row.method}>
            <span><i>{row.method === "best_single" ? "B" : String(index + 1).padStart(2, "0")}</i><strong>{data.methods[row.method].label}</strong><small>{row.method === "best_single" ? "Hindsight benchmark" : "Outcome-blind pool"}</small></span>
            <strong>{row.weightedBi?.toFixed(2) ?? "—"}</strong>
            <strong className={(row.gainVsPolymarket ?? 0) >= 0 ? "positive" : "negative"}>{percent(row.gainVsPolymarket)}</strong>
            <strong className={(row.gainVsModel ?? 0) >= 0 ? "positive" : "negative"}>{percent(row.gainVsModel)}</strong>
            <strong>{row.positiveVsPolymarket}/{row.pairCount}</strong>
          </button>)}
        </div>

        <dl className="polymarket-selection-summary">
          <div><dt>MODEL PAIRS</dt><dd>{points.length}</dd><small>{group === "all" ? "all six model families" : `${GROUPS.find((item) => item.id === group)?.label} models`} · {foldMeta.label}</small></div>
          <div><dt>WEIGHTED BI ↑</dt><dd>{activeSummary?.weightedBi?.toFixed(2) ?? "—"}</dd><small>absolute aggregation Brier Index</small></div>
          <div><dt>GAIN VS POLYMARKET</dt><dd className={(activeSummary?.gainVsPolymarket ?? 0) >= 0 ? "positive" : "negative"}>{percent(activeSummary?.gainVsPolymarket ?? null)}</dd><small>fractional adjusted-Brier reduction</small></div>
          <div><dt>GAIN VS MODEL</dt><dd className={(activeSummary?.gainVsModel ?? 0) >= 0 ? "positive" : "negative"}>{percent(activeSummary?.gainVsModel ?? null)}</dd><small>same pool, model as denominator</small></div>
          <div><dt>DIVERSITY–{outcomeMeta.correlation} r</dt><dd>{correlation?.toFixed(2) ?? "—"}</dd><small>train diversity vs opposite-fold {outcomeMeta.label.toLowerCase()}</small></div>
        </dl>
      </div>

      <ResearchDetails>
        <p><strong>Market snapshot.</strong> The baseline is ForecastBench's <code>freeze_datetime_value</code>, audited as <code>market_prob</code>. Only non-imputed <code>source=Polymarket</code> targets with a valid freeze-time probability are used. Every score comparison uses identical model–market support.</p>
        <div className="polymarket-provenance-ribbon">
          <div><span>MATCHED ROUNDS</span><strong>{matchAudit.matched_freeze_values.toLocaleString()}</strong><small>{matchAudit.missing_freeze_values} missing · {matchAudit.unique_market_ids.toLocaleString()} unique markets</small></div>
          <div><span>FREEZE LEAD</span><strong>{data.provenance.snapshot_audit.freeze_to_due_lag_days.median.toFixed(0)} days</strong><small>{data.provenance.snapshot_audit.freeze_to_due_lag_days.minimum}–{data.provenance.snapshot_audit.freeze_to_due_lag_days.maximum} days before due date</small></div>
          <div><span>REPEATED OOS</span><strong>{data.cross_fit.split.repetitions} × 2 folds</strong><small>event-disjoint · both directions</small></div>
        </div>
        <p><strong>Evaluation.</strong> Every recurring date for a market remains in one fold. Diversity and Near-BI use the training fold; performance uses the opposite fold. Combined averages A→B and B→A.</p>
        <p><strong>Total variation.</strong> TV is the mean absolute probability difference between the model and market on training questions. It ranges from 0 to 1; higher values mean greater prediction diversity.</p>
        <p><strong>Interpretation.</strong> Higher BI is better; positive gain means lower adjusted Brier than the named denominator. Best Single is a hindsight benchmark. Correlations describe associations, not causal effects.</p>
      </ResearchDetails>
    </section>
  );
}
