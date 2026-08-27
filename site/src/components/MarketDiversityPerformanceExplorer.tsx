import { useMemo, useState } from "react";
import {
  finiteExtent,
  linearPosition,
  linearTicks,
  pearsonCorrelation,
  spearmanCorrelation,
} from "./FreezeMarketCorrelationExplorer";
import type {
  MarketDiversityPerformanceData,
  MarketDiversityPerformancePoint,
  MarketInformationType,
  MarketPerformanceDiversityMetricId,
  MarketPerformanceOutcomeId,
  MarketPromptType,
} from "../types/data";

const WIDTH = 1080;
const HEIGHT = 500;
const MARGIN = { top: 32, right: 34, bottom: 78, left: 88 };

const METRICS: MarketPerformanceDiversityMetricId[] = [
  "prediction_diversity",
  "adjusted_pog",
  "high_loss_lift",
  "adjusted_loss_corr",
];

const INFORMATION_ORDER: MarketInformationType[] = [
  "none",
  "freeze_values",
  "news",
  "news_freeze",
  "web_search",
  "web_search_freeze",
  "other",
];

const INFORMATION_COLORS: Record<MarketInformationType, string> = {
  none: "#4f207f",
  freeze_values: "#efab02",
  news: "#3379b7",
  news_freeze: "#d86c31",
  web_search: "#278174",
  web_search_freeze: "#8b5fb1",
  other: "#77717a",
};

const PROMPTS: Array<{ id: "all" | MarketPromptType; label: string }> = [
  { id: "all", label: "All prompts" },
  { id: "zero_shot", label: "Zero shot" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "unspecified", label: "Unspecified" },
];

function formatX(metric: MarketPerformanceDiversityMetricId, value: number) {
  return metric === "adjusted_pog" ? value.toFixed(3) : value.toFixed(2);
}

function formatY(outcome: MarketPerformanceOutcomeId, value: number) {
  return outcome === "raw_brier" ? value.toFixed(3) : value.toFixed(1);
}

function weightedMarketBaseline(
  points: MarketDiversityPerformancePoint[],
  outcome: MarketPerformanceOutcomeId,
) {
  const support = points.reduce((sum, point) => sum + point.n_common, 0);
  if (!support) return null;
  return points.reduce(
    (sum, point) => sum + point.matched_market[outcome] * point.n_common,
    0,
  ) / support;
}

function informationLabel(data: MarketDiversityPerformanceData, id: MarketInformationType) {
  return data.points.find((point) => point.information_type === id)?.information_label ?? id;
}

function PointGlyph({
  point,
  selected,
}: {
  point: MarketDiversityPerformancePoint;
  selected: boolean;
}) {
  const color = INFORMATION_COLORS[point.information_type];
  const className = `market-performance-point ${selected ? "selected" : ""}`;
  if (point.prompt_type === "scratchpad") {
    return <rect className={className} x={-6} y={-6} width={12} height={12} rx={1.5} fill={color} transform="rotate(45)" />;
  }
  if (point.prompt_type === "unspecified") {
    return <path className={className} d="M 0 -7 L 7 6 L -7 6 Z" fill={color} />;
  }
  return <circle className={className} r={6.4} fill={color} />;
}

export function MarketDiversityPerformanceExplorer({ data }: { data: MarketDiversityPerformanceData }) {
  const [metric, setMetric] = useState<MarketPerformanceDiversityMetricId>("prediction_diversity");
  const [outcome, setOutcome] = useState<MarketPerformanceOutcomeId>("raw_brier");
  const [provider, setProvider] = useState("all");
  const [prompt, setPrompt] = useState<"all" | MarketPromptType>("all");
  const [information, setInformation] = useState<"all" | MarketInformationType>("all");
  const [selectedConfiguration, setSelectedConfiguration] = useState(data.points[0]?.exact_configuration ?? "");

  const providers = useMemo(
    () => [...new Set(data.points.map((point) => point.provider))].sort(),
    [data.points],
  );
  const availableInformation = useMemo(
    () => INFORMATION_ORDER.filter((id) => data.points.some((point) => point.information_type === id)),
    [data.points],
  );
  const filtered = useMemo(() => data.points.filter((point) => (
    (provider === "all" || point.provider === provider)
    && (prompt === "all" || point.prompt_type === prompt)
    && (information === "all" || point.information_type === information)
    && point.diversity[metric] !== null
  )), [data.points, provider, prompt, information, metric]);
  const selected = filtered.find((point) => point.exact_configuration === selectedConfiguration)
    ?? filtered[0]
    ?? null;
  const xValues = filtered.map((point) => point.diversity[metric] as number);
  const yValues = filtered.map((point) => point.model[outcome]);
  const baseline = weightedMarketBaseline(filtered, outcome);
  const rawXDomain = finiteExtent(xValues);
  const xDomain: [number, number] = metric === "prediction_diversity" || metric === "adjusted_pog"
    ? [Math.max(0, rawXDomain[0]), rawXDomain[1]]
    : rawXDomain;
  const rawYDomain = finiteExtent(baseline === null ? yValues : [...yValues, baseline]);
  const yDomain: [number, number] = outcome === "raw_brier"
    ? [Math.max(0, rawYDomain[0]), rawYDomain[1]]
    : rawYDomain;
  const xTicks = linearTicks(xDomain, 6);
  const yTicks = linearTicks(yDomain, 6);
  const pearson = pearsonCorrelation(xValues, yValues);
  const spearman = spearmanCorrelation(xValues, yValues);
  const selectedX = selected?.diversity[metric] ?? null;

  return (
    <section className="market-performance-section" id="market-performance">
      <div className="section-heading market-performance-heading">
        <div>
          <p className="eyebrow">ALL MODEL CONFIGURATIONS × POLYMARKET</p>
          <h2>Does market diversity relate to forecasting performance?</h2>
        </div>
        <p>Every point keeps one exact information condition and prompt. Model scores and market scores use identical non-imputed Polymarket support; the dashed line is the support-weighted matched-market benchmark under the active filters.</p>
      </div>

      <div className="market-performance-controls">
        <label><span>PROVIDER</span><select aria-label="Market performance provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <div><span>PROMPT</span><div className="market-performance-tabs" role="group" aria-label="Market performance prompt filter">{PROMPTS.filter((item) => item.id !== "unspecified" || data.audit.prompt_counts.unspecified).map((item) => <button className={prompt === item.id ? "active" : ""} type="button" aria-pressed={prompt === item.id} onClick={() => setPrompt(item.id)} key={item.id}>{item.label}</button>)}</div></div>
        <div><span>INFORMATION</span><div className="market-performance-tabs scrollable" role="group" aria-label="Market performance information filter"><button className={information === "all" ? "active" : ""} type="button" aria-pressed={information === "all"} onClick={() => setInformation("all")}>All information</button>{availableInformation.map((id) => <button className={information === id ? "active" : ""} type="button" aria-pressed={information === id} onClick={() => setInformation(id)} key={id}>{informationLabel(data, id)}</button>)}</div></div>
      </div>

      <div className="market-performance-axis-controls">
        <div><span>DIVERSITY · X</span><div className="market-performance-tabs">{METRICS.map((id) => <button className={metric === id ? "active" : ""} type="button" onClick={() => setMetric(id)} key={id}>{data.metrics[id].label}</button>)}</div></div>
        <div><span>PERFORMANCE · Y</span><div className="market-performance-tabs"><button className={outcome === "raw_brier" ? "active" : ""} type="button" onClick={() => setOutcome("raw_brier")}>Raw Brier Score ↓</button><button className={outcome === "brier_index" ? "active" : ""} type="button" onClick={() => setOutcome("brier_index")}>Brier Index ↑</button></div></div>
      </div>

      <dl className="market-performance-kpis">
        <div><dt>CONFIGURATIONS</dt><dd>{filtered.length}</dd><small>{new Set(filtered.map((point) => point.canonical_model_version)).size} model versions</small></div>
        <div><dt>MARKET BASELINE</dt><dd>{baseline === null ? "—" : formatY(outcome, baseline)}</dd><small>matched-support weighted line</small></div>
        <div><dt>PEARSON r</dt><dd>{pearson === null ? "—" : pearson.toFixed(2)}</dd><small>{outcome === "raw_brier" ? "positive means worse Brier" : "positive means better BI"}</small></div>
        <div><dt>SPEARMAN ρ</dt><dd>{spearman === null ? "—" : spearman.toFixed(2)}</dd><small>unweighted configuration ranks</small></div>
        <div><dt>COMMON CELLS</dt><dd>{filtered.reduce((sum, point) => sum + point.n_common, 0).toLocaleString()}</dd><small>configuration–market observations</small></div>
      </dl>

      <div className="market-performance-layout">
        <div className="market-performance-chart-wrap">
          {filtered.length >= 2 ? <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="market-performance-chart" role="img" aria-label={`${data.metrics[metric].label} versus ${data.outcomes[outcome].label}`}>
            {yTicks.map((tick) => {
              const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              return <g key={`y-${tick}`}><line className="market-performance-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="market-performance-tick" x={MARGIN.left - 13} y={y + 4} textAnchor="end">{formatY(outcome, tick)}</text></g>;
            })}
            {xTicks.map((tick) => {
              const x = linearPosition(tick, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
              return <g key={`x-${tick}`}><line className="market-performance-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="market-performance-tick" x={x} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{formatX(metric, tick)}</text></g>;
            })}
            {baseline !== null && <g className="market-performance-baseline"><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={linearPosition(baseline, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])} y2={linearPosition(baseline, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])} /><text x={WIDTH - MARGIN.right - 4} y={linearPosition(baseline, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]) - 8} textAnchor="end">Matched Polymarket · {formatY(outcome, baseline)}</text></g>}
            {filtered.map((point) => {
              const xValue = point.diversity[metric] as number;
              const yValue = point.model[outcome];
              const x = linearPosition(xValue, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
              const y = linearPosition(yValue, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              const label = `${point.canonical_model_version}\n${point.information_label} · ${point.prompt_label}\n${data.metrics[metric].label}: ${formatX(metric, xValue)}\nModel ${data.outcomes[outcome].label}: ${formatY(outcome, yValue)}\nMatched market: ${formatY(outcome, point.matched_market[outcome])}\nn = ${point.n_common}`;
              return <g className="market-performance-hit" transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} onClick={() => setSelectedConfiguration(point.exact_configuration)} onFocus={() => setSelectedConfiguration(point.exact_configuration)} key={point.exact_configuration}><PointGlyph point={point} selected={selected?.exact_configuration === point.exact_configuration} /><circle className="market-performance-hit-target" r={12} /><title>{label}</title></g>;
            })}
            <text className="market-performance-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 15} textAnchor="middle">Lower diversity ← {data.metrics[metric].axis} → Higher diversity</text>
            <text className="market-performance-axis-label" transform={`translate(20 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{data.outcomes[outcome].axis}</text>
          </svg> : <div className="market-performance-empty">Not enough configurations under the active filters.</div>}
        </div>

        {selected && <aside className="market-performance-inspector" aria-live="polite">
          <p className="eyebrow">SELECTED CONFIGURATION</p>
          <h3>{selected.canonical_model_version}</h3>
          <p>{selected.information_label} · {selected.prompt_label}</p>
          <dl>
            <div><dt>{data.metrics[metric].label}</dt><dd>{selectedX === null ? "—" : formatX(metric, selectedX)}</dd></div>
            <div><dt>Raw Brier ↓</dt><dd>{selected.model.raw_brier.toFixed(3)}</dd></div>
            <div><dt>Matched market ↓</dt><dd>{selected.matched_market.raw_brier.toFixed(3)}</dd></div>
            <div><dt>Brier Index ↑</dt><dd>{selected.model.brier_index.toFixed(1)}</dd></div>
            <div><dt>Matched market ↑</dt><dd>{selected.matched_market.brier_index.toFixed(1)}</dd></div>
            <div><dt>Prediction r</dt><dd>{selected.prediction_pearson?.toFixed(3) ?? "—"}</dd></div>
            <div><dt>Common targets</dt><dd>{selected.n_common.toLocaleString()}</dd></div>
            <div><dt>Date range</dt><dd>{selected.date_min}<br />{selected.date_max}</dd></div>
          </dl>
          <small>{selected.exact_configuration}</small>
        </aside>}
      </div>

      <div className="market-performance-legend">
        <strong>Information color</strong>{availableInformation.map((id) => <span key={id}><i style={{ background: INFORMATION_COLORS[id] }} />{informationLabel(data, id)}</span>)}
        <strong>Prompt shape</strong><span><i className="shape-circle" />Zero shot</span><span><i className="shape-diamond" />Scratchpad</span>{data.audit.prompt_counts.unspecified ? <span><i className="shape-triangle" />Unspecified</span> : null}
      </div>
      <p className="market-performance-note"><strong>How to read it.</strong> Color distinguishes the information shown to the model; shape distinguishes the prompt. Repeated model names are intentional exact configurations, not duplicate rows. The market line is recomputed after every filter change. Because model coverage differs, the selected-point panel reports its own matched-market score; use that pair-specific value for exact comparisons. Correlations are descriptive and do not establish that diversity causes forecasting quality.</p>
    </section>
  );
}
