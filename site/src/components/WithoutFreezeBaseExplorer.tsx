import { useEffect, useMemo, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { highLossAssociationReason, highLossAxis, isHighLossMetric } from "../lib/highLoss";
import { HighLossNotice } from "./HighLossNotice";
import type {
  FixedBaseAggregationData,
  FixedBaseAggregationPoint,
  FixedBaseAggregationView,
  FreezeAggregationMethodId,
  FreezeDiversityMetricId,
  FreezeFoldView,
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

type FixedBaseOutcome = "gain_vs_base" | "aggregation_bi";

const WIDTH = 980;
const HEIGHT = 430;
const MARGIN = { top: 25, right: 30, bottom: 68, left: 76 };
const FOLD_VIEWS: Array<{ id: FreezeFoldView; label: string }> = [
  { id: "combined", label: "Combined" },
  { id: "a_to_b", label: "A→B" },
  { id: "b_to_a", label: "B→A" },
];

const signedPercent = (value: number | null, digits = 1) => (
  value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`
);

export function fixedBasePointView(
  point: FixedBaseAggregationPoint,
  foldView: FreezeFoldView,
): FixedBaseAggregationView {
  return foldView === "combined" ? point.combined : point.directions[foldView];
}

export function fixedBaseOutcomeValue(
  point: FixedBaseAggregationPoint,
  foldView: FreezeFoldView,
  method: FreezeAggregationMethodId,
  outcome: FixedBaseOutcome,
) {
  const score = fixedBasePointView(point, foldView).aggregation[method];
  return outcome === "gain_vs_base" ? score.gain_vs_base : score.brier_index;
}

export function summarizeFixedBasePoints(
  points: FixedBaseAggregationPoint[],
  foldView: FreezeFoldView,
  method: FreezeAggregationMethodId,
) {
  const rows = points.map((point) => fixedBasePointView(point, foldView).aggregation[method]);
  const support = rows.reduce((sum, row) => sum + row.test_target_cells, 0);
  const weighted = (field: "brier_index" | "gain_vs_base" | "gain_vs_partner") => (
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
    positiveVsBase: rows.filter((row) => row.gain_vs_base > 0).length,
  };
}

export function WithoutFreezeBaseExplorer({ data }: { data: FixedBaseAggregationData }) {
  const [provider, setProvider] = useState("all");
  const [prompt, setPrompt] = useState<"all" | FixedBaseAggregationPoint["prompt_type"]>("all");
  const [foldView, setFoldView] = useState<FreezeFoldView>("combined");
  const [method, setMethod] = useState<FreezeAggregationMethodId>("cf_directional");
  const [metric, setMetric] = useState<FreezeDiversityMetricId>("adjusted_pog");
  const [outcome, setOutcome] = useState<FixedBaseOutcome>("gain_vs_base");
  const [nearBiOnly, setNearBiOnly] = useState(false);
  const [selectedConfiguration, setSelectedConfiguration] = useState(
    data.points[0]?.partner_configuration ?? "",
  );

  const providers = useMemo(
    () => [...new Set(data.points.map((point) => point.provider))],
    [data.points],
  );
  const filtered = useMemo(
    () => data.points.filter((point) => (
      (provider === "all" || point.provider === provider)
      && (prompt === "all" || point.prompt_type === prompt)
    )),
    [data.points, prompt, provider],
  );
  const methodSummaries = useMemo(
    () => FREEZE_AGGREGATION_METHODS.map(
      (methodId) => summarizeFixedBasePoints(filtered, foldView, methodId),
    ),
    [filtered, foldView],
  );
  const activeSummary = methodSummaries.find((row) => row.method === method);
  const bestDeployable = [...methodSummaries]
    .filter((row) => row.method !== "best_single" && row.weightedBi !== null)
    .sort((left, right) => (right.weightedBi as number) - (left.weightedBi as number))[0];
  const points = useMemo(
    () => filtered.filter((point) => {
      const view = fixedBasePointView(point, foldView);
      const x = view.train_diversity[metric];
      return (!nearBiOnly || view.near_bi)
        && x !== null
        && Number.isFinite(x)
        && Number.isFinite(fixedBaseOutcomeValue(point, foldView, method, outcome));
    }),
    [filtered, foldView, method, metric, nearBiOnly, outcome],
  );
  const xs = points.map(
    (point) => fixedBasePointView(point, foldView).train_diversity[metric] as number,
  );
  const ys = points.map((point) => fixedBaseOutcomeValue(point, foldView, method, outcome));
  const associationReason = isHighLossMetric(metric) ? highLossAssociationReason(xs, ys) : null;
  const pearson = associationReason ? null : pearsonCorrelation(xs, ys);
  const spearman = associationReason ? null : spearmanCorrelation(xs, ys);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : finiteExtent(xs);
  const yDomain = finiteExtent(ys, outcome === "gain_vs_base");
  const lossAxis = isHighLossMetric(metric) ? highLossAxis(xs, [MARGIN.left, WIDTH - MARGIN.right]) : null;
  const xPosition = lossAxis?.position ?? ((value: number) => linearPosition(value, xDomain, [MARGIN.left, WIDTH - MARGIN.right]));
  const xTicks = lossAxis?.ticks ?? linearTicks(xDomain);
  const yTicks = linearTicks(yDomain);
  const selected = points.find(
    (point) => point.partner_configuration === selectedConfiguration,
  ) ?? points[0];
  const selectedView = selected ? fixedBasePointView(selected, foldView) : null;
  const selectedScore = selectedView?.aggregation[method];
  const missing = filtered.filter((point) => {
    const view = fixedBasePointView(point, foldView);
    return (!nearBiOnly || view.near_bi) && !Number.isFinite(view.train_diversity[metric]);
  }).length;

  useEffect(() => {
    if (!points.some((point) => point.partner_configuration === selectedConfiguration)) {
      setSelectedConfiguration(points[0]?.partner_configuration ?? "");
    }
  }, [points, selectedConfiguration]);

  return (
    <section className="without-freeze-base-section" id="without-freeze-base">
      <div className="section-heading freeze-correlation-heading">
        <div>
          <p className="eyebrow">SAME MODEL · DIFFERENT INFORMATION</p>
          <h2>Does market exposure create useful aggregation diversity?</h2>
        </div>
        <p>Pair a model without freeze values with its market-exposed version on shared Polymarket events. Dataset questions are excluded.</p>
      </div>

      <div className="freeze-correlation-toolbar">
        <div className="freeze-provider-tabs" role="group" aria-label="Filter exposure pairs by provider">
          <button className={provider === "all" ? "active" : ""} type="button" onClick={() => setProvider("all")}>All providers</button>
          {providers.map((item) => <button className={provider === item ? "active" : ""} type="button" onClick={() => setProvider(item)} key={item}>{item}</button>)}
        </div>
        <div className="freeze-provider-tabs" role="group" aria-label="Filter exposure pairs by prompt">
          <button className={prompt === "all" ? "active" : ""} type="button" onClick={() => setPrompt("all")}>All prompts</button>
          <button className={prompt === "zero_shot" ? "active" : ""} type="button" onClick={() => setPrompt("zero_shot")}>Zero shot</button>
          <button className={prompt === "scratchpad" ? "active" : ""} type="button" onClick={() => setPrompt("scratchpad")}>Scratchpad</button>
        </div>
      </div>

      <div className="freeze-aggregation-overview exposure-base-overview">
        <div className="freeze-aggregation-table" role="table" aria-label="Without-freeze base aggregation method comparison">
          <div className="freeze-aggregation-head" role="row"><span>METHOD</span><span>BI ↑</span><span>GAIN VS BASE</span><span>GAIN VS PARTNER</span><span>POSITIVE VS BASE</span></div>
          {methodSummaries.map((row, index) => {
            const metadata = data.evaluation.methods[row.method];
            const benchmark = row.method === "best_single";
            return <button className={`freeze-aggregation-row ${benchmark ? "benchmark" : ""} ${method === row.method ? "active" : ""}`} role="row" type="button" aria-label={`Use ${metadata.label} for without-freeze base analysis`} aria-pressed={method === row.method} onClick={() => setMethod(row.method)} key={row.method}>
              <span><i>{benchmark ? "B" : String(index + 1).padStart(2, "0")}</i><strong>{metadata.label}</strong><small>{metadata.role}</small></span>
              <strong>{row.weightedBi?.toFixed(2) ?? "—"}</strong>
              <strong className={(row.gainVsBase ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsBase)}</strong>
              <strong className={(row.gainVsPartner ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsPartner)}</strong>
              <strong>{row.positiveVsBase}/{row.pairCount}</strong>
            </button>;
          })}
        </div>
        <dl className="freeze-aggregation-summary">
          <div><dt>EXACT PAIRS</dt><dd>{filtered.length}</dd><small>{new Set(filtered.map((point) => point.model)).size} same-version models</small></div>
          <div><dt>OOS TARGET CELLS</dt><dd>{(activeSummary?.support ?? 0).toLocaleString()}</dd><small>{foldView === "combined" ? "10 repeats · both directions" : `10 repeated ${foldView === "a_to_b" ? "A→B" : "B→A"}`}</small></div>
          <div><dt>BEST DEPLOYABLE BI ↑</dt><dd>{bestDeployable?.weightedBi?.toFixed(2) ?? "—"}</dd><small>{bestDeployable ? data.evaluation.methods[bestDeployable.method].label : "no eligible pairs"}</small></div>
          <div><dt>GAIN VS BASE</dt><dd className={(bestDeployable?.gainVsBase ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(bestDeployable?.gainVsBase ?? null)}</dd><small>fixed without-freeze denominator</small></div>
        </dl>
      </div>

      <div className="freeze-diversity-explorer exposure-diversity-explorer">
        <div className="freeze-diversity-heading">
          <div><p className="eyebrow">FIXED SAME-VERSION BASE</p><h4>Diversity versus aggregation outcome</h4></div>
          <p>Repeated cross-fit OOS, with gain always measured against the without-freeze base.</p>
        </div>

        <div className="freeze-diversity-controls">
          <div className="freeze-diversity-control-group"><span>DIRECTION</span><div className="freeze-diversity-tabs" role="group" aria-label="Select exposure cross-fit direction">{FOLD_VIEWS.map((view) => <button className={foldView === view.id ? "active" : ""} type="button" aria-pressed={foldView === view.id} onClick={() => setFoldView(view.id)} key={view.id}>{view.label}</button>)}</div></div>
          <div className="freeze-diversity-control-group"><span>DIVERSITY</span><div className="freeze-diversity-tabs" role="group" aria-label="Select exposure diversity metric">{FREEZE_DIVERSITY_METRICS.map((metricId) => <button className={metric === metricId ? "active" : ""} type="button" aria-pressed={metric === metricId} onClick={() => setMetric(metricId)} key={metricId}>{data.evaluation.diversity_metrics[metricId].label}</button>)}</div></div>
          <div className="freeze-diversity-control-group"><span>Y AXIS</span><div className="freeze-diversity-tabs" role="group" aria-label="Select exposure aggregation outcome"><button className={outcome === "gain_vs_base" ? "active" : ""} type="button" aria-pressed={outcome === "gain_vs_base"} onClick={() => setOutcome("gain_vs_base")}>Fraction Gain vs Base</button><button className={outcome === "aggregation_bi" ? "active" : ""} type="button" aria-pressed={outcome === "aggregation_bi"} onClick={() => setOutcome("aggregation_bi")}>Aggregation BI</button></div></div>
          <div className="freeze-diversity-control-group"><span>SAMPLE</span><div className="freeze-diversity-tabs" role="group" aria-label="Filter exposure pairs by BI similarity"><button className={!nearBiOnly ? "active" : ""} type="button" aria-pressed={!nearBiOnly} onClick={() => setNearBiOnly(false)}>All eligible</button><button className={nearBiOnly ? "active" : ""} type="button" aria-pressed={nearBiOnly} onClick={() => setNearBiOnly(true)}>Near-BI</button></div></div>
        </div>

        <div className="freeze-diversity-kpis" aria-label="Without-freeze base diversity summary">
          <div><span>METHOD</span><strong>{data.evaluation.methods[method].label}</strong><small>{method === "best_single" ? "hindsight reference" : "deployable aggregation"}</small></div>
          <div><span>PAIR POINTS</span><strong>{points.length}</strong><small>{missing ? `${missing} undefined omitted` : "all selected pairs defined"}</small></div>
          <div><span>PEARSON r</span><strong>{pearson === null ? "—" : pearson.toFixed(2)}</strong><small>unweighted across pairs</small></div>
          <div><span>SPEARMAN ρ</span><strong>{spearman === null ? "—" : spearman.toFixed(2)}</strong><small>rank association</small></div>
          <div><span>WEIGHTED GAIN</span><strong className={(activeSummary?.gainVsBase ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(activeSummary?.gainVsBase ?? null)}</strong><small>vs fixed without-freeze base</small></div>
        </div>

        <HighLossNotice metric={metric} values={xs} missingCount={missing} totalCount={filtered.filter((point) => !nearBiOnly || fixedBasePointView(point, foldView).near_bi).length} associationReason={associationReason} diagnostics={filtered.flatMap((point) => {
          const view = fixedBasePointView(point, foldView);
          return (!nearBiOnly || view.near_bi) && view.high_loss_diagnostics ? [view.high_loss_diagnostics] : [];
        })} />

        <div className="freeze-diversity-layout">
          <div className="freeze-diversity-chart-wrap">
            {points.length >= 1 ? <svg className="freeze-diversity-chart" data-x-scale={lossAxis ? "signed-log" : "linear"} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${data.evaluation.diversity_metrics[metric].label} versus ${outcome === "gain_vs_base" ? "fraction gain versus without-freeze base" : "aggregation Brier Index"}`}>
              {yTicks.map((tick) => { const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]); return <g key={`y-${tick}`}><line className="freeze-diversity-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="freeze-diversity-tick" x={MARGIN.left - 12} y={y + 4} textAnchor="end">{outcome === "gain_vs_base" ? signedPercent(tick) : tick.toFixed(1)}</text></g>; })}
              {xTicks.map((tick) => { const x = xPosition(tick); return <g key={`x-${tick}`}><line className="freeze-diversity-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="freeze-diversity-tick" x={x} y={HEIGHT - MARGIN.bottom + 22} textAnchor="middle">{scatterMetricLabel(metric, tick)}</text></g>; })}
              {outcome === "gain_vs_base" && yDomain[0] <= 0 && yDomain[1] >= 0 && <line className="freeze-diversity-zero-line" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={linearPosition(0, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])} y2={linearPosition(0, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])} />}
              {points.map((point) => {
                const view = fixedBasePointView(point, foldView);
                const xValue = view.train_diversity[metric] as number;
                const yValue = fixedBaseOutcomeValue(point, foldView, method, outcome);
                const x = xPosition(xValue);
                const y = linearPosition(yValue, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
                const color = FREEZE_PROVIDER_COLORS[point.provider] ?? "#665f6d";
                const active = selected?.partner_configuration === point.partner_configuration;
                const label = `${point.model}, ${point.prompt_label}: diversity ${scatterMetricLabel(metric, xValue)}, ${outcome === "gain_vs_base" ? `gain ${signedPercent(yValue)}` : `BI ${yValue.toFixed(2)}`}`;
                return <g className={`freeze-diversity-point ${active ? "selected" : ""}`} role="button" tabIndex={0} aria-label={label} onClick={() => setSelectedConfiguration(point.partner_configuration)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedConfiguration(point.partner_configuration); }} transform={`translate(${x} ${y})`} key={point.partner_configuration}>{point.prompt_type === "scratchpad" ? <rect x={-6} y={-6} width={12} height={12} rx={1.5} fill={color} transform="rotate(45)" /> : <circle r={6.5} fill={color} />}<title>{label}</title></g>;
              })}
              <text className="freeze-diversity-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 14} textAnchor="middle">Lower diversity ← {data.evaluation.diversity_metrics[metric].axis} → Higher diversity</text>
              <text className="freeze-diversity-axis-label" transform={`translate(19 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{outcome === "gain_vs_base" ? "Fraction gain vs fixed without-freeze base" : "Aggregation Brier Index (higher is better)"}</text>
            </svg> : <div className="freeze-diversity-empty">Not enough defined pairs under the active filters.</div>}
          </div>

          {selected && selectedView && selectedScore && <aside className="freeze-diversity-inspector" aria-live="polite">
            <p className="eyebrow">SELECTED SAME-VERSION PAIR</p><h5>{selected.model}</h5><p>{selected.prompt_label} · with-freeze partner</p>
            <dl>
              <div><dt>{data.evaluation.diversity_metrics[metric].label}</dt><dd>{scatterMetricLabel(metric, selectedView.train_diversity[metric] as number)}</dd></div>
              <div><dt>Fraction gain vs base</dt><dd className={selectedScore.gain_vs_base >= 0 ? "positive" : "negative"}>{signedPercent(selectedScore.gain_vs_base)}</dd></div>
              <div><dt>Aggregation BI ↑</dt><dd>{selectedScore.brier_index.toFixed(2)}</dd></div>
              <div><dt>Base BI ↑</dt><dd>{selectedView.base_brier_index.toFixed(2)}</dd></div>
              <div><dt>Partner BI ↑</dt><dd>{selectedView.partner_brier_index.toFixed(2)}</dd></div>
              <div><dt>Train BI gap</dt><dd>{selectedView.train_bi_gap.toFixed(2)}</dd></div>
              <div><dt>Near-BI</dt><dd>{selectedView.near_bi ? "Yes" : "No"}</dd></div>
              <div><dt>OOS target cells</dt><dd>{selectedScore.test_target_cells.toLocaleString()}</dd></div>
            </dl>
          </aside>}
        </div>

        <div className="freeze-diversity-legend"><span><i className="zero-shot" /> Zero shot</span><span><i className="scratchpad" /> Scratchpad</span>{providers.map((item) => <span key={item}><i style={{ backgroundColor: FREEZE_PROVIDER_COLORS[item] ?? "#665f6d" }} /> {item}</span>)}</div>
      </div>

      <p className="research-scope">Gain includes differences in partner quality; it does not isolate the effect of aggregation. Best Single is a hindsight benchmark.</p>
      <p className="freeze-aggregation-caveat">Three configurations fail the repeated minimum-fold-overlap requirement and remain listed in the data audit.</p>
      <ResearchDetails>
        <p><strong>Configuration scope.</strong> The base is each canonical model version without freeze values. Its partner is the same version under an exact zero-shot or scratchpad with-freeze prompt. All comparisons use identical audited, non-imputed Polymarket events with a valid freeze-time probability.</p>
        <p><strong>Evaluation.</strong> A→B uses A-fold diversity and B-fold gain; B→A swaps the roles. Combined pools both directions. Diversity and Directional CF weights use training outcomes only; BI and gain use the opposite test fold. The denominator remains the without-freeze base.</p>
        <p><strong>Interpretation.</strong> Positive gain means improvement over that fixed base. Because the with-freeze partner is usually much stronger, base-relative gain includes both partner-quality uplift and aggregation mechanics. Gain vs Partner tests whether pooling also beats the exposed partner. Correlations are exploratory pair-level associations.</p>
      </ResearchDetails>
    </section>
  );
}
