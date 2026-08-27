import { useMemo, useState } from "react";
import { finiteExtent, linearPosition, linearTicks } from "./FreezeMarketCorrelationExplorer";
import type {
  UpperLeftCrossfitPairRow,
  UpperLeftFixedPairRow,
  UpperLeftModelPairAggregationData,
  UpperLeftPairDiversityMetricId,
  UpperLeftPairMethodId,
  UpperLeftPairModel,
} from "../types/data";

const WIDTH = 980;
const HEIGHT = 470;
const MARGIN = { top: 34, right: 34, bottom: 74, left: 74 };

interface DisplayRow {
  pairId: string;
  modelA: string;
  modelB: string;
  method: UpperLeftPairMethodId;
  methodLabel: string;
  diversity: Record<UpperLeftPairDiversityMetricId, number | null>;
  aggregationBi: number;
  marketBi: number;
  deltaBi: number;
  beatsMarket: boolean;
  support: number;
  evaluationCount: number | null;
  maximumEvaluations: number | null;
  beatMarketShare: number | null;
  aggregationSd: number | null;
  aToB: UpperLeftCrossfitPairRow["a_to_b"] | null;
  bToA: UpperLeftCrossfitPairRow["b_to_a"] | null;
}

function fixedDisplay(row: UpperLeftFixedPairRow): DisplayRow {
  return {
    pairId: row.pair_id,
    modelA: row.model_a,
    modelB: row.model_b,
    method: row.method,
    methodLabel: row.method_label,
    diversity: row.diversity,
    aggregationBi: row.aggregation_bi,
    marketBi: row.market_bi,
    deltaBi: row.aggregation_minus_market_bi,
    beatsMarket: row.beats_market,
    support: row.n_pair,
    evaluationCount: null,
    maximumEvaluations: null,
    beatMarketShare: null,
    aggregationSd: null,
    aToB: null,
    bToA: null,
  };
}

function crossfitDisplay(row: UpperLeftCrossfitPairRow): DisplayRow {
  return {
    pairId: row.pair_id,
    modelA: row.model_a,
    modelB: row.model_b,
    method: row.method,
    methodLabel: row.method_label,
    diversity: row.mean_train_diversity,
    aggregationBi: row.aggregation_bi,
    marketBi: row.market_bi,
    deltaBi: row.aggregation_minus_market_bi,
    beatsMarket: row.beats_market,
    support: row.mean_n_test,
    evaluationCount: row.evaluation_count,
    maximumEvaluations: row.maximum_evaluations,
    beatMarketShare: row.beat_market_share,
    aggregationSd: row.aggregation_bi_sd,
    aToB: row.a_to_b,
    bToA: row.b_to_a,
  };
}

function formatMetric(metric: UpperLeftPairDiversityMetricId, value: number) {
  return metric === "adjusted_pog" ? value.toFixed(3) : value.toFixed(2);
}

function downloadRows(rows: DisplayRow[], metric: UpperLeftPairDiversityMetricId, filename: string) {
  const header = [
    "focal_model", "partner_model", "method", "diversity_metric", "diversity",
    "aggregation_bi", "market_bi", "aggregation_minus_market_bi", "beats_market",
    "pair_support", "evaluation_count", "maximum_evaluations", "beat_market_share",
  ];
  const values = rows.map((row) => [
    row.modelA, row.modelB, row.method, metric, row.diversity[metric] ?? "",
    row.aggregationBi, row.marketBi, row.deltaBi, row.beatsMarket,
    row.support, row.evaluationCount ?? "", row.maximumEvaluations ?? "", row.beatMarketShare ?? "",
  ]);
  const csv = [header, ...values]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function pointPath(beatsMarket: boolean) {
  return beatsMarket ? "M 0 -8 L 8 7 L -8 7 Z" : "";
}

function PairBlock({
  index,
  title,
  description,
  models,
  rows,
  data,
  crossfit,
}: {
  index: string;
  title: string;
  description: string;
  models: UpperLeftPairModel[];
  rows: DisplayRow[];
  data: UpperLeftModelPairAggregationData;
  crossfit: boolean;
}) {
  const [metric, setMetric] = useState<UpperLeftPairDiversityMetricId>("prediction_diversity");
  const [method, setMethod] = useState<UpperLeftPairMethodId>("piecewise_odds");
  const availableModels = useMemo(() => models.filter((model) => rows.some((row) => row.modelA === model.name || row.modelB === model.name)), [models, rows]);
  const defaultFocal = useMemo(() => availableModels.find((model) => rows.some((row) => (
    (row.modelA === model.name || row.modelB === model.name)
    && (!crossfit || (row.evaluationCount ?? 0) >= 10)
  )))?.name ?? availableModels[0]?.name ?? "", [availableModels, rows, crossfit]);
  const [focal, setFocal] = useState(defaultFocal);
  const [minimumDirections, setMinimumDirections] = useState(crossfit ? 10 : 1);
  const [selectedPair, setSelectedPair] = useState("");

  const filtered = useMemo(() => rows
    .filter((row) => row.method === method)
    .filter((row) => row.modelA === focal || row.modelB === focal)
    .filter((row) => !crossfit || (row.evaluationCount ?? 0) >= minimumDirections)
    .filter((row) => row.diversity[metric] !== null)
    .map((row) => row.modelA === focal ? row : { ...row, modelA: row.modelB, modelB: row.modelA })
    .sort((a, b) => b.deltaBi - a.deltaBi), [rows, method, focal, metric, crossfit, minimumDirections]);
  const selected = filtered.find((row) => row.pairId === selectedPair) ?? filtered[0] ?? null;
  const xValues = filtered.map((row) => row.diversity[metric] as number);
  const yValues = filtered.map((row) => row.aggregationBi);
  const marketLine = filtered.length ? filtered.reduce((sum, row) => sum + row.marketBi, 0) / filtered.length : null;
  const rawX = finiteExtent(xValues);
  const xPadding = Math.max((rawX[1] - rawX[0]) * 0.07, 0.005);
  const xDomain: [number, number] = [
    metric === "prediction_diversity" || metric === "adjusted_pog" ? Math.max(0, rawX[0] - xPadding) : rawX[0] - xPadding,
    rawX[1] + xPadding,
  ];
  const rawY = finiteExtent(yValues);
  const yPadding = Math.max((rawY[1] - rawY[0]) * 0.13, 0.25);
  const yDomain: [number, number] = [rawY[0] - yPadding, rawY[1] + yPadding];
  const positive = filtered.filter((row) => row.beatsMarket).length;
  const meanBi = filtered.length ? filtered.reduce((sum, row) => sum + row.aggregationBi, 0) / filtered.length : null;

  return (
    <article className="upper-left-pair-block">
      <div className="upper-left-block-heading">
        <span>{index}</span>
        <div><p className="eyebrow">{crossfit ? "TRAIN-SELECTED · OOS" : "FIXED CONFIGURATIONS · FULL SAMPLE"}</p><h3>{title}</h3><p>{description}</p></div>
      </div>

      <div className={`upper-left-controls ${crossfit ? "crossfit" : ""}`}>
        <label><span>FOCAL MODEL</span><select aria-label={`${title} focal model`} value={focal} onChange={(event) => { setFocal(event.target.value); setSelectedPair(""); }}>{availableModels.map((model) => <option value={model.name} key={model.name}>{model.canonical_model_version} · {model.prompt_label}</option>)}</select></label>
        <label><span>AGGREGATION</span><select aria-label={`${title} aggregation method`} value={method} onChange={(event) => { setMethod(event.target.value as UpperLeftPairMethodId); setSelectedPair(""); }}>{data.methods.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <div><span>DIVERSITY · X</span><div className="upper-left-metric-tabs">{(Object.keys(data.metrics) as UpperLeftPairDiversityMetricId[]).map((id) => <button type="button" className={metric === id ? "active" : ""} aria-pressed={metric === id} onClick={() => setMetric(id)} key={id}>{data.metrics[id].label}</button>)}</div></div>
        {crossfit && <label><span>MIN OOS DIRECTIONS</span><select aria-label="Minimum OOS directions" value={minimumDirections} onChange={(event) => { setMinimumDirections(Number(event.target.value)); setSelectedPair(""); }}>{[1, 5, 10, 15, 20].map((value) => <option value={value} key={value}>{value} / 20</option>)}</select></label>}
      </div>

      <dl className="upper-left-kpis">
        <div><dt>VISIBLE PAIRS</dt><dd>{filtered.length}</dd><small>one fixed focal model</small></div>
        <div><dt>ABOVE PAIR-MATCHED MARKET</dt><dd>{positive}</dd><small>{filtered.length ? `${(100 * positive / filtered.length).toFixed(1)}% of pairs` : "no eligible pairs"}</small></div>
        <div><dt>MEAN AGGREGATION BI</dt><dd>{meanBi?.toFixed(2) ?? "—"}</dd><small>higher is better</small></div>
        <div><dt>PAIR-MATCHED MARKET</dt><dd>{marketLine?.toFixed(2) ?? "—"}</dd><small>mean across visible pair supports</small></div>
        <div><dt>{crossfit ? "MAX OOS DIRECTIONS" : "FIXED MODELS"}</dt><dd>{crossfit ? data.crossfit.maximum_pair_evaluations : data.fixed.models.length}</dd><small>{crossfit ? "10 splits × 2 directions" : "exact configurations"}</small></div>
      </dl>

      <div className="upper-left-visual-row">
        <div className="upper-left-chart-wrap">
          {filtered.length ? <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="upper-left-chart" role="img" aria-label={`${title}: ${data.metrics[metric].label} versus aggregation BI`}>
            {linearTicks(yDomain, 6).map((tick) => {
              const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              return <g key={`y-${tick}`}><line className="upper-left-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="upper-left-tick" x={MARGIN.left - 12} y={y + 4} textAnchor="end">{tick.toFixed(1)}</text></g>;
            })}
            {linearTicks(xDomain, 6).map((tick) => {
              const x = linearPosition(tick, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
              return <g key={`x-${tick}`}><line className="upper-left-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="upper-left-tick" x={x} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{formatMetric(metric, tick)}</text></g>;
            })}
            {filtered.map((row) => {
              const xValue = row.diversity[metric] as number;
              const x = linearPosition(xValue, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
              const y = linearPosition(row.aggregationBi, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              const label = `${row.modelB}\n${row.methodLabel}\n${data.metrics[metric].label}: ${formatMetric(metric, xValue)}\nAggregation BI: ${row.aggregationBi.toFixed(2)}\nMarket BI: ${row.marketBi.toFixed(2)}\nΔBI: ${row.deltaBi >= 0 ? "+" : ""}${row.deltaBi.toFixed(2)}`;
              return <g className={`upper-left-point-hit ${selected?.pairId === row.pairId ? "selected" : ""}`} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} onClick={() => setSelectedPair(row.pairId)} onFocus={() => setSelectedPair(row.pairId)} key={row.pairId}>{row.beatsMarket ? <path className="upper-left-point beats" d={pointPath(true)} /> : <circle className="upper-left-point" r={6.7} />}<circle className="upper-left-hit-target" r={13} /><title>{label}</title></g>;
            })}
            <text className="upper-left-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 16} textAnchor="middle">Lower diversity ← {data.metrics[metric].axis} → Higher diversity</text>
            <text className="upper-left-axis-label" transform={`translate(18 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">Aggregation Brier Index ↑</text>
          </svg> : <div className="upper-left-empty">No eligible partner for this focal model and metric.</div>}
        </div>

        <aside className="upper-left-inspector" aria-live="polite">
          <p className="eyebrow">SELECTED PARTNER</p>
          {selected ? <><h4>{selected.modelB.split(" (")[0]}</h4><p>{selected.modelB.includes(" (") ? selected.modelB.split(" (")[1].replace(/\)$/, "") : "Exact configuration"}</p><dl><div><dt>{data.metrics[metric].label}</dt><dd>{formatMetric(metric, selected.diversity[metric] as number)}</dd></div><div><dt>Aggregation BI ↑</dt><dd>{selected.aggregationBi.toFixed(2)}</dd></div><div><dt>Pair-matched market BI ↑</dt><dd>{selected.marketBi.toFixed(2)}</dd></div><div><dt>ΔBI vs market</dt><dd className={selected.beatsMarket ? "positive" : "negative"}>{selected.deltaBi >= 0 ? "+" : ""}{selected.deltaBi.toFixed(2)}</dd></div><div><dt>{crossfit ? "OOS directions" : "Pair cells"}</dt><dd>{crossfit ? `${selected.evaluationCount}/${selected.maximumEvaluations}` : Math.round(selected.support).toLocaleString()}</dd></div>{crossfit && <><div><dt>A→B / B→A</dt><dd>{selected.aToB?.count ?? 0} / {selected.bToA?.count ?? 0}</dd></div><div><dt>Pair-matched win share</dt><dd>{((selected.beatMarketShare ?? 0) * 100).toFixed(1)}%</dd></div></>}</dl></> : <p>No selected pair.</p>}
        </aside>
      </div>

      <div className="upper-left-table-heading"><div><strong>PAIR RESULTS</strong><span><i className="triangle-symbol" /> above pair-matched market <i className="circle-symbol" /> at or below pair-matched market</span></div><button type="button" className="download-button" onClick={() => downloadRows(filtered, metric, `${crossfit ? "crossfit" : "fixed"}_${method}_${metric}.csv`)}>Download filtered CSV ↓</button></div>
      <div className="upper-left-table-wrap"><table className="upper-left-table"><thead><tr><th>Partner</th><th>Diversity</th><th>Aggregation BI ↑</th><th>Pair-matched market BI ↑</th><th>ΔBI</th><th>{crossfit ? "OOS directions (A/B)" : "Pair cells"}</th><th>{crossfit ? "Pair-matched win share" : "Above market"}</th></tr></thead><tbody>{filtered.map((row) => <tr className={selected?.pairId === row.pairId ? "selected" : ""} onClick={() => setSelectedPair(row.pairId)} key={row.pairId}><td><span className={row.beatsMarket ? "row-shape triangle" : "row-shape circle"} /> <strong>{row.modelB.split(" (")[0]}</strong><small>{row.modelB.includes(" (") ? row.modelB.split(" (")[1].replace(/\)$/, "") : ""}</small></td><td>{formatMetric(metric, row.diversity[metric] as number)}</td><td>{row.aggregationBi.toFixed(2)}</td><td>{row.marketBi.toFixed(2)}</td><td className={row.beatsMarket ? "positive" : "negative"}>{row.deltaBi >= 0 ? "+" : ""}{row.deltaBi.toFixed(2)}</td><td>{crossfit ? `${row.evaluationCount}/${row.maximumEvaluations} (${row.aToB?.count ?? 0}/${row.bToA?.count ?? 0})` : Math.round(row.support).toLocaleString()}</td><td>{crossfit ? `${((row.beatMarketShare ?? 0) * 100).toFixed(1)}%` : row.beatsMarket ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
    </article>
  );
}

export function UpperLeftModelPairAggregationExplorer({ data }: { data: UpperLeftModelPairAggregationData }) {
  return (
    <section className="upper-left-pairs-section" id="upper-left-pairs">
      <div className="section-heading upper-left-section-heading"><div><p className="eyebrow">UPPER-LEFT CONFIGURATIONS · MODEL × MODEL</p><h2>Which model pairs beat the market?</h2></div><p>Fix one focal configuration, vary its model partner, and compare four closed-form pools. The x-axis measures model-to-model diversity; the y-axis is aggregation BI. Every triangle compares aggregation and Polymarket on exactly the same pair support, using only valid freeze-time Polymarket targets; Dataset questions are excluded.</p></div>
      <PairBlock index="01" title={data.fixed.title} description={data.fixed.description} models={data.fixed.models} rows={data.fixed.rows.map(fixedDisplay)} data={data} crossfit={false} />
      <PairBlock index="02" title={data.crossfit.title} description={data.crossfit.description} models={data.crossfit.models} rows={data.crossfit.rows.map(crossfitDisplay)} data={data} crossfit />
      <p className="upper-left-method-note"><strong>Market reference.</strong> {data.market_reference.interpretation} A triangle is a support-matched score comparison, not a statistical-significance claim. In Block 02, selection and diversity use only the training fold; aggregation BI and market BI use the identical opposite-fold pair support.</p>
    </section>
  );
}
