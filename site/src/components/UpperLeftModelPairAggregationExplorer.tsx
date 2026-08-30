import { useEffect, useMemo, useRef, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { HighLossNotice } from "./HighLossNotice";
import { finiteExtent, linearPosition, linearTicks } from "./FreezeMarketCorrelationExplorer";
import { highLossAxis, isHighLossMetric, type HighLossDiagnostics } from "../lib/highLoss";
import { useHistoryRestore } from "../lib/useHistoryRestore";
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
  highLossDiagnostics?: HighLossDiagnostics;
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
    highLossDiagnostics: row.high_loss_diagnostics,
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
    highLossDiagnostics: row.high_loss_diagnostics,
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
  return metric === "adjusted_pog" || metric === "total_variation" ? value.toFixed(3) : value.toFixed(2);
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
  location,
}: {
  index: string;
  title: string;
  description: string;
  models: UpperLeftPairModel[];
  rows: DisplayRow[];
  data: UpperLeftModelPairAggregationData;
  crossfit: boolean;
  location: { base: string | null; view: string | null; minimumDirections: number };
}) {
  const blockRef = useRef<HTMLElement>(null);
  const [metric, setMetric] = useState<UpperLeftPairDiversityMetricId>("prediction_diversity");
  const [method, setMethod] = useState<UpperLeftPairMethodId>("piecewise_odds");
  const availableModels = useMemo(() => models.filter((model) => rows.some((row) => row.modelA === model.name || row.modelB === model.name)), [models, rows]);
  const defaultFocal = useMemo(() => availableModels.find((model) => rows.some((row) => (
    (row.modelA === model.name || row.modelB === model.name)
    && (!crossfit || (row.evaluationCount ?? 0) >= 10)
  )))?.name ?? availableModels[0]?.name ?? "", [availableModels, rows, crossfit]);
  const [focal, setFocal] = useState(location.base ?? defaultFocal);
  const [minimumDirections, setMinimumDirections] = useState(crossfit ? location.minimumDirections : 1);
  const [selectedPair, setSelectedPair] = useState("");
  const unavailableFocal = focal !== "" && !availableModels.some((model) => model.name === focal);

  useEffect(() => {
    setFocal(location.base ?? defaultFocal);
    setSelectedPair("");
  }, [location, defaultFocal]);

  useEffect(() => {
    setMinimumDirections(crossfit ? location.minimumDirections : 1);
  }, [location, crossfit]);

  useEffect(() => {
    if (window.location.hash !== "#upper-left-pairs" || location.view !== (crossfit ? "crossfit" : "fixed")) return;
    const frame = window.requestAnimationFrame(() => blockRef.current?.scrollIntoView?.({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [location, crossfit]);

  function selectFocal(value: string) {
    setFocal(value);
    setSelectedPair("");
    const params = new URLSearchParams(window.location.search);
    params.set("upper_left_base", value);
    params.set("upper_left_view", crossfit ? "crossfit" : "fixed");
    if (crossfit) params.set("upper_left_min_directions", String(minimumDirections));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }

  function selectMinimumDirections(value: number) {
    setMinimumDirections(value);
    setSelectedPair("");
    const params = new URLSearchParams(window.location.search);
    params.set("upper_left_base", focal);
    params.set("upper_left_view", "crossfit");
    params.set("upper_left_min_directions", String(value));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }

  const candidates = useMemo(() => rows
    .filter((row) => row.method === method)
    .filter((row) => row.modelA === focal || row.modelB === focal)
    .filter((row) => !crossfit || (row.evaluationCount ?? 0) >= minimumDirections), [rows, method, focal, crossfit, minimumDirections]);
  const missingMetricCount = candidates.filter((row) => row.diversity[metric] === null || !Number.isFinite(row.diversity[metric])).length;
  const filtered = useMemo(() => candidates
    .filter((row) => row.diversity[metric] !== null && Number.isFinite(row.diversity[metric]) && Number.isFinite(row.aggregationBi))
    .map((row) => row.modelA === focal ? row : { ...row, modelA: row.modelB, modelB: row.modelA })
    .sort((a, b) => b.deltaBi - a.deltaBi), [candidates, focal, metric]);
  const selected = filtered.find((row) => row.pairId === selectedPair) ?? filtered[0] ?? null;
  const xValues = filtered.map((row) => row.diversity[metric] as number);
  const yValues = filtered.map((row) => row.aggregationBi);
  const marketLine = filtered.length ? filtered.reduce((sum, row) => sum + row.marketBi, 0) / filtered.length : null;
  const rawX = finiteExtent(xValues);
  const xPadding = Math.max((rawX[1] - rawX[0]) * 0.07, 0.005);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : [
    metric === "prediction_diversity" || metric === "adjusted_pog" ? Math.max(0, rawX[0] - xPadding) : rawX[0] - xPadding,
    rawX[1] + xPadding,
  ];
  const highLossScale = isHighLossMetric(metric) ? highLossAxis(xValues, [MARGIN.left, WIDTH - MARGIN.right]) : null;
  const xPosition = (raw: number) => highLossScale?.position(raw) ?? linearPosition(raw, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
  const xTicks = highLossScale?.ticks ?? linearTicks(xDomain, 6);
  const rawY = finiteExtent(yValues);
  const yPadding = Math.max((rawY[1] - rawY[0]) * 0.13, 0.25);
  const yDomain: [number, number] = [rawY[0] - yPadding, rawY[1] + yPadding];
  const positive = filtered.filter((row) => row.beatsMarket).length;
  const meanBi = filtered.length ? filtered.reduce((sum, row) => sum + row.aggregationBi, 0) / filtered.length : null;

  return (
    <article className="upper-left-pair-block" id={`upper-left-${crossfit ? "crossfit" : "fixed"}`} ref={blockRef}>
      <div className="upper-left-block-heading">
        <span>{index}</span>
        <div><p className="eyebrow">{crossfit ? "TRAIN-SELECTED · OOS" : "FIXED CONFIGURATIONS · FULL SAMPLE"}</p><h3>{title}</h3><p>{crossfit ? "Select on the training fold; evaluate on the opposite fold." : "Preselected configurations, evaluated on the full sample."}</p></div>
      </div>

      <div className={`upper-left-controls ${crossfit ? "crossfit" : ""}`}>
        <label><span>FOCAL MODEL</span><select aria-label={`${title} focal model`} value={focal} onChange={(event) => selectFocal(event.target.value)}>{unavailableFocal && <option value={focal}>{focal} · not in this block</option>}{availableModels.map((model) => <option value={model.name} key={model.name}>{model.canonical_model_version} · {model.information_label} · {model.prompt_label}</option>)}</select></label>
        <label><span>AGGREGATION</span><select aria-label={`${title} aggregation method`} value={method} onChange={(event) => { setMethod(event.target.value as UpperLeftPairMethodId); setSelectedPair(""); }}>{data.methods.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <div><span>DIVERSITY · X</span><div className="upper-left-metric-tabs">{(Object.keys(data.metrics) as UpperLeftPairDiversityMetricId[]).map((id) => <button type="button" className={metric === id ? "active" : ""} aria-pressed={metric === id} onClick={() => setMetric(id)} key={id}>{data.metrics[id].label}</button>)}</div></div>
        {crossfit && <label><span>MIN OOS DIRECTIONS</span><select aria-label="Minimum OOS directions" value={minimumDirections} onChange={(event) => selectMinimumDirections(Number(event.target.value))}>{[1, 5, 10, 15, 20].map((value) => <option value={value} key={value}>{value} / 20</option>)}</select></label>}
      </div>

      {location.base && <p className="research-scope upper-left-linked-configuration">Focal exact configuration: <strong>{focal}</strong>. {unavailableFocal ? "This configuration has no published results in this block; no other configuration has been substituted." : "Using the existing pair results and their original evaluation support."} {crossfit && `Minimum: ${minimumDirections} / 20 OOS directions. Each point reports its actual available directions; not every pair appears in all 20.`}</p>}

      <dl className="upper-left-kpis">
        <div><dt>VISIBLE PAIRS</dt><dd>{filtered.length}</dd><small>one fixed focal model</small></div>
        <div><dt>ABOVE PAIR-MATCHED MARKET</dt><dd>{positive}</dd><small>{filtered.length ? `${(100 * positive / filtered.length).toFixed(1)}% of pairs` : "no eligible pairs"}</small></div>
        <div><dt>MEAN AGGREGATION BI</dt><dd>{meanBi?.toFixed(2) ?? "—"}</dd><small>higher is better</small></div>
        <div><dt>PAIR-MATCHED MARKET</dt><dd>{marketLine?.toFixed(2) ?? "—"}</dd><small>mean across visible pair supports</small></div>
        <div><dt>{crossfit ? "MAX OOS DIRECTIONS" : "FIXED MODELS"}</dt><dd>{crossfit ? data.crossfit.maximum_pair_evaluations : data.fixed.models.length}</dd><small>{crossfit ? "10 splits × 2 directions" : "exact configurations"}</small></div>
      </dl>
      <HighLossNotice metric={metric} values={xValues} missingCount={missingMetricCount} totalCount={candidates.length} retainedDirections={crossfit ? filtered.map((row) => row.evaluationCount ?? 0) : undefined} maximumDirections={crossfit ? data.crossfit.maximum_pair_evaluations : undefined} diagnostics={candidates.flatMap((row) => row.highLossDiagnostics ? [row.highLossDiagnostics] : [])} />

      <div className="upper-left-visual-row">
        <div className="upper-left-chart-wrap">
          {filtered.length ? <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="upper-left-chart" role="img" aria-label={`${title}: ${data.metrics[metric].label} versus aggregation BI`}>
            {linearTicks(yDomain, 6).map((tick) => {
              const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              return <g key={`y-${tick}`}><line className="upper-left-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="upper-left-tick" x={MARGIN.left - 12} y={y + 4} textAnchor="end">{tick.toFixed(1)}</text></g>;
            })}
            {xTicks.map((tick) => {
              const x = xPosition(tick);
              return <g key={`x-${tick}`}><line className="upper-left-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="upper-left-tick" x={x} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{formatMetric(metric, tick)}</text></g>;
            })}
            {filtered.map((row) => {
              const xValue = row.diversity[metric] as number;
              const x = xPosition(xValue);
              const y = linearPosition(row.aggregationBi, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              const label = `${row.modelB}\n${row.methodLabel}\n${data.metrics[metric].label}: ${formatMetric(metric, xValue)}\nAggregation BI: ${row.aggregationBi.toFixed(2)}\nMarket BI: ${row.marketBi.toFixed(2)}\nΔBI: ${row.deltaBi >= 0 ? "+" : ""}${row.deltaBi.toFixed(2)}`;
              return <g className={`upper-left-point-hit ${selected?.pairId === row.pairId ? "selected" : ""}`} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} onClick={() => setSelectedPair(row.pairId)} onFocus={() => setSelectedPair(row.pairId)} key={row.pairId}>{row.beatsMarket ? <path className="upper-left-point beats" d={pointPath(true)} /> : <circle className="upper-left-point" r={6.7} />}<circle className="upper-left-hit-target" r={13} /><title>{label}</title></g>;
            })}
            <text className="upper-left-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 16} textAnchor="middle">Lower diversity ← {data.metrics[metric].axis} → Higher diversity{highLossScale ? " · signed-log display; raw ticks" : ""}</text>
            <text className="upper-left-axis-label" transform={`translate(18 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">Aggregation Brier Index ↑</text>
          </svg> : <div className="upper-left-empty">{unavailableFocal ? "The linked exact configuration is not available in this block. Choose a listed configuration to explore other published results." : "No eligible partner for this focal model and metric."}</div>}
        </div>

        <aside className="upper-left-inspector" aria-live="polite">
          <p className="eyebrow">SELECTED PARTNER</p>
          {selected ? <><h4>{selected.modelB.split(" (")[0]}</h4><p>{selected.modelB.includes(" (") ? selected.modelB.split(" (")[1].replace(/\)$/, "") : "Exact configuration"}</p><dl><div><dt>{data.metrics[metric].label}</dt><dd>{formatMetric(metric, selected.diversity[metric] as number)}</dd></div><div><dt>Aggregation BI ↑</dt><dd>{selected.aggregationBi.toFixed(2)}</dd></div><div><dt>Pair-matched market BI ↑</dt><dd>{selected.marketBi.toFixed(2)}</dd></div><div><dt>ΔBI vs market</dt><dd className={selected.beatsMarket ? "positive" : "negative"}>{selected.deltaBi >= 0 ? "+" : ""}{selected.deltaBi.toFixed(2)}</dd></div><div><dt>{crossfit ? "OOS directions" : "Pair cells"}</dt><dd>{crossfit ? `${selected.evaluationCount}/${selected.maximumEvaluations}` : Math.round(selected.support).toLocaleString()}</dd></div>{crossfit && <><div><dt>A→B / B→A</dt><dd>{selected.aToB?.count ?? 0} / {selected.bToA?.count ?? 0}</dd></div><div><dt>Pair-matched win share</dt><dd>{((selected.beatMarketShare ?? 0) * 100).toFixed(1)}%</dd></div></>}</dl></> : <p>No selected pair.</p>}
          {isHighLossMetric(metric) && selected?.highLossDiagnostics && <dl>
            <div><dt>{crossfit ? "Min marginal high-loss counts A / B" : "Marginal high-loss counts A / B"}</dt><dd>{(crossfit ? selected.highLossDiagnostics.min_high_count_a : selected.highLossDiagnostics.high_count_a) ?? "—"} / {(crossfit ? selected.highLossDiagnostics.min_high_count_b : selected.highLossDiagnostics.high_count_b) ?? "—"}</dd></div>
            <div><dt>{crossfit ? "Min joint high-loss count" : "Joint high-loss count"}</dt><dd>{(crossfit ? selected.highLossDiagnostics.min_joint_high_count : selected.highLossDiagnostics.joint_high_count) ?? "—"}</dd></div>
            {crossfit && <div><dt>Defined high-loss directions</dt><dd>{selected.highLossDiagnostics.defined_fold_count ?? "—"} / {selected.highLossDiagnostics.included_fold_count ?? "—"}</dd></div>}
          </dl>}
        </aside>
      </div>

      <div className="upper-left-table-heading"><div><strong>PAIR RESULTS</strong><span><i className="triangle-symbol" /> above pair-matched market <i className="circle-symbol" /> at or below pair-matched market</span></div><button type="button" className="download-button" onClick={() => downloadRows(filtered, metric, `${crossfit ? "crossfit" : "fixed"}_${method}_${metric}.csv`)}>Download filtered CSV ↓</button></div>
      <div className="upper-left-table-wrap"><table className="upper-left-table"><thead><tr><th>Partner</th><th>Diversity</th><th>Aggregation BI ↑</th><th>Pair-matched market BI ↑</th><th>ΔBI</th><th>{crossfit ? "OOS directions (A/B)" : "Pair cells"}</th><th>{crossfit ? "Pair-matched win share" : "Above market"}</th></tr></thead><tbody>{filtered.map((row) => <tr className={selected?.pairId === row.pairId ? "selected" : ""} onClick={() => setSelectedPair(row.pairId)} key={row.pairId}><td><span className={row.beatsMarket ? "row-shape triangle" : "row-shape circle"} /> <strong>{row.modelB.split(" (")[0]}</strong><small>{row.modelB.includes(" (") ? row.modelB.split(" (")[1].replace(/\)$/, "") : ""}</small></td><td>{formatMetric(metric, row.diversity[metric] as number)}</td><td>{row.aggregationBi.toFixed(2)}</td><td>{row.marketBi.toFixed(2)}</td><td className={row.beatsMarket ? "positive" : "negative"}>{row.deltaBi >= 0 ? "+" : ""}{row.deltaBi.toFixed(2)}</td><td>{crossfit ? `${row.evaluationCount}/${row.maximumEvaluations} (${row.aToB?.count ?? 0}/${row.bToA?.count ?? 0})` : Math.round(row.support).toLocaleString()}</td><td>{crossfit ? `${((row.beatMarketShare ?? 0) * 100).toFixed(1)}%` : row.beatsMarket ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
      <ResearchDetails label="Selection & evaluation details"><p>{description}</p></ResearchDetails>
    </article>
  );
}

export function UpperLeftModelPairAggregationExplorer({ data }: { data: UpperLeftModelPairAggregationData }) {
  const readLocation = (params = new URLSearchParams(window.location.search)) => {
    const candidate = Number(params.get("upper_left_min_directions"));
    return { base: params.get("upper_left_base") || null, view: params.get("upper_left_view"), minimumDirections: [1, 5, 10, 15, 20].includes(candidate) ? candidate : 10 };
  };
  const [location, setLocation] = useState(() => readLocation());
  useHistoryRestore((params) => setLocation(readLocation(params)));
  useEffect(() => {
    const restore = () => setLocation(readLocation());
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);
  return (
    <section className="upper-left-pairs-section" id="upper-left-pairs">
      <div className="section-heading upper-left-section-heading"><div><p className="eyebrow">SELECTED MODEL PAIRS</p><h2>Which model pairs beat the market?</h2></div><p>Compare four pools using fixed or train-selected configurations. Market comparisons use each pair's shared Polymarket events.</p></div>
      <PairBlock index="01" title={data.fixed.title} description={data.fixed.description} models={data.fixed.models} rows={data.fixed.rows.map(fixedDisplay)} data={data} crossfit={false} location={location} />
      <PairBlock index="02" title={data.crossfit.title} description={data.crossfit.description} models={data.crossfit.models} rows={data.crossfit.rows.map(crossfitDisplay)} data={data} crossfit location={location} />
      <p className="research-scope">Triangles mark a higher BI than the pair-matched market, not statistical significance. Dataset questions are excluded.</p>
      <ResearchDetails>
        <p><strong>Market reference.</strong> {data.market_reference.interpretation} Each pair includes only valid freeze-time Polymarket targets, and its aggregation and market scores use exactly the same support.</p>
        <p><strong>Two designs.</strong> Block 01 uses the fixed configurations on the full sample. In Block 02, selection and diversity use only the training fold; aggregation BI and market BI use the identical opposite-fold pair support.</p>
      </ResearchDetails>
    </section>
  );
}
