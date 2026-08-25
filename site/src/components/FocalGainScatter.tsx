import { useEffect, useMemo, useState } from "react";
import type { FocalGainData, FocalGainPoint, MetricId } from "../types/data";

const WIDTH = 920;
const HEIGHT = 500;
const MARGIN = { top: 26, right: 28, bottom: 82, left: 86 };

const METRICS: Array<{ id: MetricId; label: string; axis: string; raw: string }> = [
  { id: "adjusted_pog", label: "Adjusted POG", axis: "Adjusted pairwise oracle gain", raw: "Adjusted POG" },
  { id: "high_loss_lift", label: "High-loss lift", axis: "Complementarity orientation · 1 − lift", raw: "Raw high-loss lift" },
  { id: "adjusted_loss_corr", label: "Loss correlation", axis: "Complementarity orientation · − correlation", raw: "Raw loss correlation" },
];

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageRanks(values: number[]) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length).fill(0);
  let start = 0;
  while (start < indexed.length) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const rank = (start + end - 1) / 2 + 1;
    for (let cursor = start; cursor < end; cursor += 1) ranks[indexed[cursor].index] = rank;
    start = end;
  }
  return ranks;
}

export function pearson(x: number[], y: number[]) {
  if (x.length < 2 || x.length !== y.length) return null;
  const xMean = mean(x);
  const yMean = mean(y);
  const numerator = x.reduce((total, value, index) => total + (value - xMean) * (y[index] - yMean), 0);
  const xScale = Math.sqrt(x.reduce((total, value) => total + (value - xMean) ** 2, 0));
  const yScale = Math.sqrt(y.reduce((total, value) => total + (value - yMean) ** 2, 0));
  return xScale && yScale ? numerator / (xScale * yScale) : null;
}

export function spearman(x: number[], y: number[]) {
  return pearson(averageRanks(x), averageRanks(y));
}

function extent(values: number[], includeZero = false): [number, number] {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (includeZero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const span = high - low || Math.max(Math.abs(high), 1);
  return [low - span * 0.09, high + span * 0.09];
}

function ticks([low, high]: [number, number], count = 5) {
  return Array.from({ length: count }, (_, index) => low + ((high - low) * index) / (count - 1));
}

function formatMetric(value: number, metric: MetricId) {
  return metric === "adjusted_pog" ? value.toFixed(3) : value.toFixed(2);
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function linearFit(x: number[], y: number[]) {
  const xMean = mean(x);
  const yMean = mean(y);
  const denominator = x.reduce((total, value) => total + (value - xMean) ** 2, 0);
  if (!denominator) return null;
  const slope = x.reduce((total, value, index) => total + (value - xMean) * (y[index] - yMean), 0) / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

export function FocalGainScatter({ data }: { data: FocalGainData }) {
  const [metric, setMetric] = useState<MetricId>("adjusted_pog");
  const [nearBiOnly, setNearBiOnly] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState("");

  const points = useMemo(
    () => data.points.filter((point) => !nearBiOnly || point.near_bi),
    [data.points, nearBiOnly],
  );
  const selected = points.find((point) => point.partner === selectedPartner)
    ?? [...points].sort((a, b) => b.gain_fraction - a.gain_fraction)[0];

  useEffect(() => {
    if (selected) setSelectedPartner(selected.partner);
  }, [nearBiOnly, metric, selected?.partner]);

  const xValues = points.map((point) => point.metrics[metric].complementarity);
  const yValues = points.map((point) => point.gain_fraction);
  const xDomain = extent(xValues);
  const yDomain = extent(yValues, true);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = (value: number) => MARGIN.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  const yScale = (value: number) => MARGIN.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;
  const fit = linearFit(xValues, yValues);
  const rankCorrelation = spearman(xValues, yValues);
  const linearCorrelation = pearson(xValues, yValues);
  const positive = points.filter((point) => point.gain_fraction > 0).length;
  const meanGain = mean(yValues);
  const metricMeta = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const maxOverlap = Math.max(...points.map((point) => point.n_overlap));

  return (
    <section className="focal-gain-section" id="gain">
      <div className="section-heading focal-gain-heading">
        <div><p className="eyebrow">FOCAL-MODEL AGGREGATION GAIN</p><h2>Does complementarity predict EC gain?</h2></div>
        <p>Fix {data.focal_model}; vary only its GPT or Claude partner. Every point uses the post-merge model-version panel and identical pair-common events.</p>
      </div>

      <div className="focal-gain-controls">
        <div className="gain-metric-tabs" role="tablist" aria-label="Complementarity metric">
          {METRICS.map((item) => <button type="button" role="tab" aria-selected={metric === item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)} key={item.id}>{item.label}</button>)}
        </div>
        <div className="gain-sample-toggle" role="group" aria-label="Near-BI filter">
          <button type="button" className={!nearBiOnly ? "active" : ""} onClick={() => setNearBiOnly(false)}>All eligible pairs</button>
          <button type="button" className={nearBiOnly ? "active" : ""} onClick={() => setNearBiOnly(true)}>Near-BI only</button>
        </div>
      </div>

      <dl className="focal-gain-summary">
        <div><dt>PARTNERS</dt><dd>{points.length}</dd><small>{nearBiOnly ? `BI gap ≤ ${data.near_bi.threshold_bi_points.toFixed(1)}` : "GPT + Claude"}</small></div>
        <div><dt>POSITIVE EC GAIN</dt><dd>{positive}/{points.length}</dd><small>{((positive / points.length) * 100).toFixed(0)}% of pairs</small></div>
        <div><dt>MEAN GAIN FRACTION</dt><dd className={meanGain >= 0 ? "positive" : "negative"}>{formatPercent(meanGain)}</dd><small>vs fixed focal model</small></div>
        <div><dt>SPEARMAN ρ</dt><dd>{rankCorrelation?.toFixed(2) ?? "—"}</dd><small>complementarity vs gain</small></div>
        <div><dt>PEARSON r</dt><dd>{linearCorrelation?.toFixed(2) ?? "—"}</dd><small>descriptive, not causal</small></div>
      </dl>

      <div className="focal-gain-chart-wrap">
        <div className="gain-provider-legend"><span><i className="gpt" /> GPT partner</span><span><i className="claude" /> Claude partner</span><small>Circle area reflects common-event support</small></div>
        <svg className="focal-gain-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metricMeta.label} complementarity versus EC aggregation gain for ${data.focal_model}`}>
          <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={Math.max(0, yScale(0) - MARGIN.top)} className="gain-positive-zone" />
          <rect x={MARGIN.left} y={yScale(0)} width={plotWidth} height={Math.max(0, MARGIN.top + plotHeight - yScale(0))} className="gain-negative-zone" />
          {ticks(yDomain).map((tick) => <g key={`y-${tick}`}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} className={Math.abs(tick) < 1e-10 ? "gain-zero-line" : "gain-grid-line"} /><text x={MARGIN.left - 14} y={yScale(tick) + 4} textAnchor="end" className="gain-axis-text">{formatPercent(tick)}</text></g>)}
          {ticks(xDomain).map((tick) => <g key={`x-${tick}`}><line x1={xScale(tick)} x2={xScale(tick)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} className="gain-grid-line vertical" /><text x={xScale(tick)} y={MARGIN.top + plotHeight + 27} textAnchor="middle" className="gain-axis-text">{formatMetric(tick, metric)}</text></g>)}
          {fit && <line x1={xScale(xDomain[0])} y1={yScale(fit.intercept + fit.slope * xDomain[0])} x2={xScale(xDomain[1])} y2={yScale(fit.intercept + fit.slope * xDomain[1])} className="gain-fit-line" />}
          {points.map((point) => {
            const isSelected = point.partner === selected?.partner;
            const radius = 5 + 8 * Math.sqrt(point.n_overlap / maxOverlap);
            return <g key={point.partner} className={`gain-point ${point.partner_family.toLowerCase()} ${isSelected ? "selected" : ""}`} onMouseEnter={() => setSelectedPartner(point.partner)} onFocus={() => setSelectedPartner(point.partner)} onClick={() => setSelectedPartner(point.partner)} tabIndex={0} role="button" aria-label={`${point.partner}, ${formatPercent(point.gain_fraction)} gain`}>
              <circle cx={xScale(point.metrics[metric].complementarity)} cy={yScale(point.gain_fraction)} r={radius} />
              {isSelected && <text x={xScale(point.metrics[metric].complementarity)} y={yScale(point.gain_fraction) - radius - 9} textAnchor="middle" className="gain-point-label">{point.partner.replace(/-20\d{2}.*/, "")}</text>}
              <title>{`${point.partner}\n${metricMeta.raw}: ${point.metrics[metric].raw.toFixed(4)}\nEC gain: ${formatPercent(point.gain_fraction)}\nCommon events: ${point.n_overlap.toLocaleString()}\nNear-BI: ${point.near_bi ? "Yes" : "No"}`}</title>
            </g>;
          })}
          <text x={MARGIN.left + plotWidth / 2} y={HEIGHT - 23} textAnchor="middle" className="gain-axis-title">{metricMeta.axis} · toward lower model dependence →</text>
          <text transform={`translate(24 ${MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="gain-axis-title">EC adjusted-Brier gain fraction vs fixed focal model</text>
        </svg>
      </div>

      {selected && <div className="focal-gain-detail" aria-live="polite">
        <div><span>SELECTED PARTNER</span><strong>{selected.partner}</strong><small>{selected.partner_family} · {selected.near_bi ? "Near-BI" : "Outside near-BI"}</small></div>
        <div><span>{metricMeta.raw.toUpperCase()}</span><strong>{formatMetric(selected.metrics[metric].raw, metric)}</strong><small>oriented x = {formatMetric(selected.metrics[metric].complementarity, metric)}</small></div>
        <div><span>EC GAIN FRACTION</span><strong className={selected.gain_fraction >= 0 ? "positive" : "negative"}>{formatPercent(selected.gain_fraction)}</strong><small>adjusted Brier {selected.focal_adjusted_brier.toFixed(4)} → {selected.aggregate_adjusted_brier.toFixed(4)}</small></div>
        <div><span>COMMON SUPPORT</span><strong>{selected.n_overlap.toLocaleString()}</strong><small>{selected.n_dates} dates · BI gap {selected.bi_gap.toFixed(2)}</small></div>
      </div>}

      <p className="focal-gain-footnote"><strong>Estimand.</strong> {data.outcome.formula}. EC is fixed ex ante at w = {data.aggregation.weight.toFixed(2)}. Near-BI is evaluated on pair-common support; the fixed focal model—not the hindsight-better constituent—is always the denominator. This is a descriptive in-sample relationship, not an OOS selection claim.</p>
    </section>
  );
}
