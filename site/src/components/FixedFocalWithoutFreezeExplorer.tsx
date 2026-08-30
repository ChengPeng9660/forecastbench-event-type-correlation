import { useEffect, useMemo, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { useHistoryRestore } from "../lib/useHistoryRestore";
import type {
  FixedFocalAggregationView,
  FixedFocalWithoutFreezeData,
  FixedFocalWithoutFreezePoint,
  FreezeAggregationMethodId,
  FreezeDiversityMetricId,
  FreezeFoldView,
  ModelFamily,
} from "../types/data";
import {
  finiteExtent,
  FREEZE_AGGREGATION_METHODS,
  FREEZE_DIVERSITY_METRICS,
  FREEZE_PROVIDER_COLORS,
  linearPosition,
  linearTicks,
  pearsonCorrelation,
  scatterMetricLabel,
  spearmanCorrelation,
} from "./FreezeMarketCorrelationExplorer";

type FixedFocalOutcome = "gain_vs_base" | "aggregation_bi";
type PartnerFamily = "all" | ModelFamily;

const WIDTH = 980;
const HEIGHT = 440;
const MARGIN = { top: 25, right: 30, bottom: 68, left: 76 };
const FOLD_VIEWS: Array<{ id: FreezeFoldView; label: string }> = [
  { id: "combined", label: "Combined" },
  { id: "a_to_b", label: "A→B" },
  { id: "b_to_a", label: "B→A" },
];
const PARTNER_FAMILIES: Array<{ id: PartnerFamily; label: string }> = [
  { id: "all", label: "All partners" },
  { id: "GPT", label: "GPT" },
  { id: "Claude", label: "Claude" },
  { id: "Gemini", label: "Gemini" },
  { id: "Qwen", label: "Qwen" },
  { id: "DeepSeek", label: "DeepSeek" },
  { id: "Kimi", label: "Kimi" },
];

const signedPercent = (value: number | null, digits = 1) => (
  value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`
);

export function fixedFocalPointView(
  point: FixedFocalWithoutFreezePoint,
  foldView: FreezeFoldView,
): FixedFocalAggregationView {
  return foldView === "combined" ? point.combined : point.directions[foldView];
}

export function fixedFocalOutcomeValue(
  point: FixedFocalWithoutFreezePoint,
  foldView: FreezeFoldView,
  method: FreezeAggregationMethodId,
  outcome: FixedFocalOutcome,
) {
  const score = fixedFocalPointView(point, foldView).aggregation[method];
  return outcome === "gain_vs_base" ? score.gain_vs_base : score.brier_index;
}

export function summarizeFixedFocalPoints(
  points: FixedFocalWithoutFreezePoint[],
  foldView: FreezeFoldView,
  method: FreezeAggregationMethodId,
) {
  const rows = points.map((point) => fixedFocalPointView(point, foldView).aggregation[method]);
  const support = rows.reduce((sum, row) => sum + row.test_target_cells, 0);
  const weighted = (field: "brier_index" | "gain_vs_base" | "gain_vs_partner" | "gain_vs_best_single") => (
    support
      ? rows.reduce((sum, row) => sum + row[field] * row.test_target_cells, 0) / support
      : null
  );
  return {
    method,
    pairCount: rows.length,
    support,
    weightedBi: weighted("brier_index"),
    gainVsBase: weighted("gain_vs_base"),
    gainVsPartner: weighted("gain_vs_partner"),
    gainVsBestSingle: weighted("gain_vs_best_single"),
    positiveVsBase: rows.filter((row) => row.gain_vs_base > 0).length,
  };
}

export function FixedFocalWithoutFreezeExplorer({ data }: { data: FixedFocalWithoutFreezeData }) {
  const baseModels = useMemo(
    () => [...new Set(data.points.map((point) => point.base_model))].sort((a, b) => a.localeCompare(b)),
    [data.points],
  );
  const defaultBase = baseModels.includes("GPT-5-2025-08-07") ? "GPT-5-2025-08-07" : baseModels[0];
  const [baseModel, setBaseModel] = useState(() => {
    if (typeof window === "undefined") return defaultBase;
    const candidate = new URLSearchParams(window.location.search).get("nofreeze_base") ?? "";
    return baseModels.includes(candidate) ? candidate : defaultBase;
  });
  const [partnerFamily, setPartnerFamily] = useState<PartnerFamily>("all");
  const [foldView, setFoldView] = useState<FreezeFoldView>("combined");
  const [method, setMethod] = useState<FreezeAggregationMethodId>("cf_directional");
  const [metric, setMetric] = useState<FreezeDiversityMetricId>("adjusted_pog");
  const [outcome, setOutcome] = useState<FixedFocalOutcome>("gain_vs_base");
  const [nearBiOnly, setNearBiOnly] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState("");
  useHistoryRestore((params) => {
    const candidate = params.get("nofreeze_base") ?? "";
    setBaseModel(baseModels.includes(candidate) ? candidate : defaultBase);
  });

  const focalPoints = useMemo(
    () => data.points.filter((point) => point.base_model === baseModel),
    [baseModel, data.points],
  );
  const availableFamilies = useMemo(
    () => new Set(focalPoints.map((point) => point.partner_family)),
    [focalPoints],
  );
  const filtered = useMemo(
    () => focalPoints.filter((point) => partnerFamily === "all" || point.partner_family === partnerFamily),
    [focalPoints, partnerFamily],
  );
  const sampled = useMemo(
    () => filtered.filter((point) => !nearBiOnly || fixedFocalPointView(point, foldView).near_bi),
    [filtered, foldView, nearBiOnly],
  );
  const methodSummaries = useMemo(
    () => FREEZE_AGGREGATION_METHODS.map(
      (methodId) => summarizeFixedFocalPoints(sampled, foldView, methodId),
    ),
    [sampled, foldView],
  );
  const activeSummary = methodSummaries.find((row) => row.method === method);
  const bestDeployable = [...methodSummaries]
    .filter((row) => row.method !== "best_single" && row.weightedBi !== null)
    .sort((left, right) => (right.weightedBi as number) - (left.weightedBi as number))[0];
  const points = useMemo(
    () => sampled.filter((point) => {
      const view = fixedFocalPointView(point, foldView);
      const x = view.train_diversity[metric];
      return x !== null
        && Number.isFinite(x)
        && Number.isFinite(fixedFocalOutcomeValue(point, foldView, method, outcome));
    }),
    [sampled, foldView, method, metric, outcome],
  );
  const xs = points.map((point) => fixedFocalPointView(point, foldView).train_diversity[metric] as number);
  const ys = points.map((point) => fixedFocalOutcomeValue(point, foldView, method, outcome));
  const pearson = pearsonCorrelation(xs, ys);
  const spearman = spearmanCorrelation(xs, ys);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : finiteExtent(xs);
  const yDomain = finiteExtent(ys, outcome === "gain_vs_base");
  const xTicks = linearTicks(xDomain);
  const yTicks = linearTicks(yDomain);
  const selected = points.find((point) => point.partner_model === selectedPartner) ?? points[0];
  const selectedView = selected ? fixedFocalPointView(selected, foldView) : null;
  const selectedScore = selectedView?.aggregation[method];
  const missing = sampled.filter((point) => {
    const view = fixedFocalPointView(point, foldView);
    return view.train_diversity[metric] === null;
  }).length;

  useEffect(() => {
    if (!availableFamilies.has(partnerFamily as ModelFamily) && partnerFamily !== "all") setPartnerFamily("all");
  }, [availableFamilies, partnerFamily]);

  useEffect(() => {
    if (!points.some((point) => point.partner_model === selectedPartner)) {
      setSelectedPartner(points[0]?.partner_model ?? "");
    }
  }, [points, selectedPartner]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("nofreeze_base", baseModel);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [baseModel]);

  return (
    <section className="fixed-focal-no-freeze-section" id="fixed-focal-no-freeze">
      <div className="section-heading freeze-correlation-heading">
        <div><p className="eyebrow">MODELS WITHOUT FREEZE VALUES</p><h2>Which partner improves a fixed focal model?</h2></div>
        <p>Keep one model fixed and compare its eligible partners on shared events, without freeze-value information.</p>
      </div>

      <div className="fixed-focal-toolbar">
        <label><span>BASE MODEL</span><select aria-label="Without-freeze base model" value={baseModel} onChange={(event) => { setBaseModel(event.target.value); setPartnerFamily("all"); setSelectedPartner(""); }}>{baseModels.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
        <div className="freeze-provider-tabs" role="group" aria-label="Filter without-freeze partners by family">
          {PARTNER_FAMILIES.filter((item) => item.id === "all" || availableFamilies.has(item.id as ModelFamily)).map((item) => <button className={partnerFamily === item.id ? "active" : ""} type="button" aria-pressed={partnerFamily === item.id} onClick={() => setPartnerFamily(item.id)} key={item.id}>{item.label}</button>)}
        </div>
      </div>

      <div className="freeze-aggregation-overview fixed-focal-overview">
        <div className="freeze-aggregation-table fixed-focal-method-table" role="table" aria-label="Fixed focal without-freeze aggregation method comparison">
          <div className="freeze-aggregation-head" role="row"><span>METHOD</span><span>BI ↑</span><span>GAIN VS BASE</span><span>GAIN VS PARTNER</span><span>GAIN VS BEST</span><span>POSITIVE VS BASE</span></div>
          {methodSummaries.map((row, index) => {
            const metadata = data.evaluation.methods[row.method];
            const benchmark = row.method === "best_single";
            return <button className={`freeze-aggregation-row ${benchmark ? "benchmark" : ""} ${method === row.method ? "active" : ""}`} role="row" type="button" aria-label={`Use ${metadata.label} for fixed focal analysis`} aria-pressed={method === row.method} onClick={() => setMethod(row.method)} key={row.method}>
              <span><i>{benchmark ? "B" : String(index + 1).padStart(2, "0")}</i><strong>{metadata.label}</strong><small>{metadata.role}</small></span>
              <strong>{row.weightedBi?.toFixed(2) ?? "—"}</strong>
              <strong className={(row.gainVsBase ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsBase)}</strong>
              <strong className={(row.gainVsPartner ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsPartner)}</strong>
              <strong className={(row.gainVsBestSingle ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsBestSingle)}</strong>
              <strong>{row.positiveVsBase}/{row.pairCount}</strong>
            </button>;
          })}
        </div>
        <dl className="freeze-aggregation-summary">
          <div><dt>FOCAL PARTNERS</dt><dd>{sampled.length}</dd><small>{nearBiOnly ? "training-fold Near-BI only" : partnerFamily === "all" ? "all eligible families" : `${partnerFamily} partners`}</small></div>
          <div><dt>OOS TARGET CELLS</dt><dd>{(activeSummary?.support ?? 0).toLocaleString()}</dd><small>{foldView === "combined" ? "10 repeats · both directions" : `10 repeated ${foldView === "a_to_b" ? "A→B" : "B→A"}`}</small></div>
          <div><dt>BEST DEPLOYABLE BI ↑</dt><dd>{bestDeployable?.weightedBi?.toFixed(2) ?? "—"}</dd><small>{bestDeployable ? data.evaluation.methods[bestDeployable.method].label : "no eligible partners"}</small></div>
          <div><dt>GAIN VS BASE</dt><dd className={(bestDeployable?.gainVsBase ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(bestDeployable?.gainVsBase ?? null)}</dd><small>fixed focal denominator</small></div>
        </dl>
      </div>

      <div className="freeze-diversity-explorer">
        <div className="freeze-diversity-heading">
          <div><p className="eyebrow">FIXED FOCAL MODEL</p><h4>Diversity versus aggregation outcome</h4></div>
          <p>Training diversity versus opposite-fold performance; gain is relative to the selected base.</p>
        </div>

        <div className="freeze-diversity-controls">
          <div className="freeze-diversity-control-group"><span>DIRECTION</span><div className="freeze-diversity-tabs" role="group" aria-label="Select fixed focal cross-fit direction">{FOLD_VIEWS.map((view) => <button className={foldView === view.id ? "active" : ""} type="button" aria-pressed={foldView === view.id} onClick={() => setFoldView(view.id)} key={view.id}>{view.label}</button>)}</div></div>
          <div className="freeze-diversity-control-group"><span>DIVERSITY</span><div className="freeze-diversity-tabs" role="group" aria-label="Select fixed focal diversity metric">{FREEZE_DIVERSITY_METRICS.map((metricId) => <button className={metric === metricId ? "active" : ""} type="button" aria-pressed={metric === metricId} onClick={() => setMetric(metricId)} key={metricId}>{data.evaluation.diversity_metrics[metricId].label}</button>)}</div></div>
          <div className="freeze-diversity-control-group"><span>Y AXIS</span><div className="freeze-diversity-tabs" role="group" aria-label="Select fixed focal aggregation outcome"><button className={outcome === "gain_vs_base" ? "active" : ""} type="button" aria-pressed={outcome === "gain_vs_base"} onClick={() => setOutcome("gain_vs_base")}>Fraction Gain vs Base</button><button className={outcome === "aggregation_bi" ? "active" : ""} type="button" aria-pressed={outcome === "aggregation_bi"} onClick={() => setOutcome("aggregation_bi")}>Aggregation BI</button></div></div>
          <div className="freeze-diversity-control-group"><span>SAMPLE</span><div className="freeze-diversity-tabs" role="group" aria-label="Filter fixed focal pairs by BI similarity"><button className={!nearBiOnly ? "active" : ""} type="button" aria-pressed={!nearBiOnly} onClick={() => setNearBiOnly(false)}>All eligible</button><button className={nearBiOnly ? "active" : ""} type="button" aria-pressed={nearBiOnly} onClick={() => setNearBiOnly(true)}>Near-BI</button></div></div>
        </div>

        <div className="freeze-diversity-kpis" aria-label="Fixed focal diversity summary">
          <div><span>METHOD</span><strong>{data.evaluation.methods[method].label}</strong><small>{method === "best_single" ? "hindsight reference" : "deployable aggregation"}</small></div>
          <div><span>PARTNER POINTS</span><strong>{points.length}</strong><small>{missing ? `${missing} undefined omitted` : "all selected pairs defined"}</small></div>
          <div><span>PEARSON r</span><strong>{pearson === null ? "—" : pearson.toFixed(2)}</strong><small>unweighted across partners</small></div>
          <div><span>SPEARMAN ρ</span><strong>{spearman === null ? "—" : spearman.toFixed(2)}</strong><small>partner rank association</small></div>
          <div><span>WEIGHTED GAIN</span><strong className={(activeSummary?.gainVsBase ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(activeSummary?.gainVsBase ?? null)}</strong><small>vs selected fixed base</small></div>
        </div>

        <div className="freeze-diversity-layout">
          <div className="freeze-diversity-chart-wrap">
            {points.length >= 2 ? <svg className="freeze-diversity-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${data.evaluation.diversity_metrics[metric].label} versus ${outcome === "gain_vs_base" ? "fraction gain versus fixed focal base" : "aggregation Brier Index"}`}>
              {yTicks.map((tick) => { const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]); return <g key={`y-${tick}`}><line className="freeze-diversity-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="freeze-diversity-tick" x={MARGIN.left - 12} y={y + 4} textAnchor="end">{outcome === "gain_vs_base" ? signedPercent(tick) : tick.toFixed(1)}</text></g>; })}
              {xTicks.map((tick) => { const x = linearPosition(tick, xDomain, [MARGIN.left, WIDTH - MARGIN.right]); return <g key={`x-${tick}`}><line className="freeze-diversity-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="freeze-diversity-tick" x={x} y={HEIGHT - MARGIN.bottom + 22} textAnchor="middle">{scatterMetricLabel(metric, tick)}</text></g>; })}
              {outcome === "gain_vs_base" && yDomain[0] <= 0 && yDomain[1] >= 0 && <line className="freeze-diversity-zero-line" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={linearPosition(0, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])} y2={linearPosition(0, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])} />}
              {points.map((point) => {
                const view = fixedFocalPointView(point, foldView);
                const xValue = view.train_diversity[metric] as number;
                const yValue = fixedFocalOutcomeValue(point, foldView, method, outcome);
                const x = linearPosition(xValue, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
                const y = linearPosition(yValue, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
                const color = FREEZE_PROVIDER_COLORS[point.partner_provider] ?? "#665f6d";
                const active = selected?.partner_model === point.partner_model;
                const label = `${point.partner_model}: diversity ${scatterMetricLabel(metric, xValue)}, ${outcome === "gain_vs_base" ? `gain ${signedPercent(yValue)}` : `BI ${yValue.toFixed(2)}`}`;
                return <g className={`freeze-diversity-point ${active ? "selected" : ""}`} role="button" tabIndex={0} aria-label={label} onClick={() => setSelectedPartner(point.partner_model)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPartner(point.partner_model); }} transform={`translate(${x} ${y})`} key={point.partner_model}><circle r={6.5} fill={color} /><title>{label}</title></g>;
              })}
              <text className="freeze-diversity-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 14} textAnchor="middle">Lower diversity ← {data.evaluation.diversity_metrics[metric].axis} → Higher diversity</text>
              <text className="freeze-diversity-axis-label" transform={`translate(19 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{outcome === "gain_vs_base" ? "Fraction gain vs selected fixed base" : "Aggregation Brier Index (higher is better)"}</text>
            </svg> : <div className="freeze-diversity-empty">Not enough defined partners under the active filters.</div>}
          </div>

          {selected && selectedView && selectedScore && <aside className="freeze-diversity-inspector" aria-live="polite">
            <p className="eyebrow">SELECTED PARTNER</p><h5>{selected.partner_model}</h5><p>{selected.partner_provider} · fixed base {selected.base_model}</p>
            <dl>
              <div><dt>{data.evaluation.diversity_metrics[metric].label}</dt><dd>{scatterMetricLabel(metric, selectedView.train_diversity[metric] as number)}</dd></div>
              <div><dt>Fraction gain vs base</dt><dd className={selectedScore.gain_vs_base >= 0 ? "positive" : "negative"}>{signedPercent(selectedScore.gain_vs_base)}</dd></div>
              <div><dt>Aggregation BI ↑</dt><dd>{selectedScore.brier_index.toFixed(2)}</dd></div>
              <div><dt>Gain vs best single</dt><dd className={selectedScore.gain_vs_best_single >= 0 ? "positive" : "negative"}>{signedPercent(selectedScore.gain_vs_best_single)}</dd></div>
              <div><dt>Base BI ↑</dt><dd>{selectedView.base_brier_index.toFixed(2)}</dd></div>
              <div><dt>Partner BI ↑</dt><dd>{selectedView.partner_brier_index.toFixed(2)}</dd></div>
              <div><dt>Train BI gap</dt><dd>{selectedView.train_bi_gap.toFixed(2)}</dd></div>
              <div><dt>Near-BI</dt><dd>{selectedView.near_bi ? "Yes" : "No"}</dd></div>
              <div><dt>OOS target cells</dt><dd>{selectedScore.test_target_cells.toLocaleString()}</dd></div>
            </dl>
          </aside>}
        </div>

        <div className="freeze-diversity-legend">{PARTNER_FAMILIES.filter((item) => item.id !== "all" && availableFamilies.has(item.id as ModelFamily)).map((item) => { const provider = focalPoints.find((point) => point.partner_family === item.id)?.partner_provider ?? ""; return <span key={item.id}><i style={{ backgroundColor: FREEZE_PROVIDER_COLORS[provider] ?? "#665f6d" }} /> {item.label}</span>; })}</div>
      </div>

      <p className="research-scope">Positive gain beats the fixed base. Gain vs Best compares against the hindsight-better constituent.</p>
      <ResearchDetails>
        <p><strong>Evaluation.</strong> Each point changes only the partner, while the base remains constant within every displayed correlation. A→B uses A-fold diversity and B-fold gain; B→A swaps the roles; Combined pools both. Near-BI is defined only from the named training fold.</p>
        <p><strong>Weights and reference.</strong> Directional CF is fitted around the selected base using training outcomes only and never changes the denominator. Best Single is a hindsight benchmark, not a deployable method.</p>
        <p><strong>Audit.</strong> {data.audit.model_count} canonical models, {data.audit.unordered_pair_count} eligible unordered pairs, and {data.audit.ordered_pair_count} fixed-base observations. All source configurations exclude ForecastBench freeze values.</p>
      </ResearchDetails>
    </section>
  );
}
