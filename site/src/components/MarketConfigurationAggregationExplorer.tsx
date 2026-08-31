import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { HighLossNotice } from "./HighLossNotice";
import { MarketWinBadge, MarketWinToggle } from "./MarketWinHighlight";
import { finiteExtent, linearPosition, linearTicks, pearsonCorrelation, spearmanCorrelation, FREEZE_PROVIDER_COLORS } from "./FreezeMarketCorrelationExplorer";
import { highLossAssociationReason, highLossAxis, isHighLossMetric, rawPearson, rawSpearman } from "../lib/highLoss";
import { loadConfigurationPairManifest, loadConfigurationPairShard } from "../lib/configurationPairAggregation";
import type { ConfigurationIdentity, ConfigurationPairManifest, ConfigurationPairOutcome, ConfigurationPairSample, ConfigurationPairShard } from "../types/configurationPairAggregation";
import type { FreezeAggregationMethodId, FreezeFoldView, MarketInformationType, MarketPerformanceDiversityMetricId, MarketPromptType } from "../types/data";

const WIDTH = 980;
const HEIGHT = 470;
const MARGIN = { top: 30, right: 30, bottom: 76, left: 80 };
const FOLDS: Array<{ id: FreezeFoldView; label: string }> = [{ id: "combined", label: "Combined" }, { id: "a_to_b", label: "A→B" }, { id: "b_to_a", label: "B→A" }];
const OUTCOMES: Array<{ id: ConfigurationPairOutcome; label: string }> = [
  { id: "brier_index", label: "Aggregation BI ↑" }, { id: "raw_brier", label: "Raw Brier ↓" },
  { id: "gain_vs_base", label: "Gain vs base" }, { id: "gain_vs_market", label: "Gain vs market" },
];
const PROVIDER_COLORS: Record<string, string> = { ...FREEZE_PROVIDER_COLORS, Meta: "#1f6ea8", Mistral: "#cf703d", "Mistral AI": "#cf703d", "Z.ai": "#9671b8", xAI: "#586a76" };
export const configurationProviderColor = (provider: string) => PROVIDER_COLORS[provider] ?? "#78717d";
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const outcomeLabel = (value: number | null, outcome: ConfigurationPairOutcome) => outcome.startsWith("gain_") ? percent(value) : number(value, outcome === "raw_brier" ? 3 : 2);

type Loaded = { base: string; status: "loading" | "error"; error?: string } | { base: string; status: "ready"; manifest: ConfigurationPairManifest; shard: ConfigurationPairShard };

export function MarketConfigurationAggregationExplorer({ base }: { base: ConfigurationIdentity }) {
  const [loaded, setLoaded] = useState<Loaded>({ base: base.exact_configuration, status: "loading" });
  const cache = useRef<{ manifest?: ConfigurationPairManifest; shards: Map<string, ConfigurationPairShard> }>({ shards: new Map() });
  const request = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [metric, setMetric] = useState<MarketPerformanceDiversityMetricId>("prediction_diversity");
  const [method, setMethod] = useState<FreezeAggregationMethodId>("simple_mean");
  const [outcome, setOutcome] = useState<ConfigurationPairOutcome>("brier_index");
  const [fold, setFold] = useState<FreezeFoldView>("combined");
  const [sample, setSample] = useState<ConfigurationPairSample>("all");
  const [largeSupportOnly, setLargeSupportOnly] = useState(false);
  const [provider, setProvider] = useState("all");
  const [prompt, setPrompt] = useState<"all" | MarketPromptType>("all");
  const [information, setInformation] = useState<"all" | MarketInformationType>("all");
  const [selectedPartner, setSelectedPartner] = useState("");
  const [highlightMarketWins, setHighlightMarketWins] = useState(false);
  const chartId = useId().replaceAll(":", "");

  useEffect(() => {
    const current = ++request.current;
    const controller = new AbortController();
    const exact = base.exact_configuration;
    setLoaded({ base: exact, status: "loading" });
    setSelectedPartner("");
    void (async () => {
      const manifest = cache.current.manifest ?? await loadConfigurationPairManifest(controller.signal);
      if (controller.signal.aborted || current !== request.current) return;
      cache.current.manifest = manifest;
      const entry = manifest.configurations.find((item) => item.exact_configuration === exact);
      if (!entry) throw new Error("This exact configuration is not listed in the aggregation release.");
      const shard = cache.current.shards.get(exact) ?? await loadConfigurationPairShard(entry, manifest, controller.signal);
      if (controller.signal.aborted || current !== request.current) return;
      cache.current.shards.set(exact, shard);
      setLoaded({ base: exact, status: "ready", manifest, shard });
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted && current === request.current) setLoaded({ base: exact, status: "error", error: reason instanceof Error ? reason.message : "Unable to load aggregation results." });
    });
    return () => { controller.abort(); request.current += 1; };
  }, [base.exact_configuration, attempt]);

  const ready = loaded.base === base.exact_configuration && loaded.status === "ready" ? loaded : null;
  const catalog = ready?.manifest.configurations ?? [];
  const providers = useMemo(() => [...new Set(catalog.map((item) => item.provider))].sort(), [catalog]);
  const prompts = useMemo(() => [...new Map(catalog.map((item) => [item.prompt_type, item.prompt_label])).entries()], [catalog]);
  const informationTypes = useMemo(() => [...new Map(catalog.map((item) => [item.information_type, item.information_label])).entries()], [catalog]);
  const candidates = (ready?.shard.partners ?? []).filter((row) => (provider === "all" || row.partner.provider === provider)
    && (prompt === "all" || row.partner.prompt_type === prompt) && (information === "all" || row.partner.information_type === information));
  const inView = candidates.flatMap((row) => {
    const view = row.views[sample][fold];
    if (!view || (largeSupportOnly && (view.min_train_rows < 50 || view.min_test_rows < 50))) return [];
    return [{ row, view, score: view.methods[method] }];
  });
  const points = inView.flatMap((item) => {
    const x = item.view.train_diversity[metric];
    const y = item.score[outcome];
    return finite(x) && finite(y) ? [{ ...item, x, y }] : [];
  });
  const selected = points.find((item) => item.row.partner.exact_configuration === selectedPartner) ?? points[0] ?? null;
  const selectedTestGap = selected && selected.view.base.brier_index !== null && selected.view.partner.brier_index !== null
    ? Math.abs(selected.view.base.brier_index - selected.view.partner.brier_index) : null;
  const selectedHighLoss = selected?.view.high_loss_diagnostics;
  const xs = points.map((item) => item.x);
  const ys = points.map((item) => item.y);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : finiteExtent(xs);
  const highLossScale = isHighLossMetric(metric) ? highLossAxis(xs, [MARGIN.left, WIDTH - MARGIN.right]) : null;
  const xPosition = (raw: number) => highLossScale?.position(raw) ?? linearPosition(raw, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
  const xTicks = highLossScale?.ticks ?? linearTicks(xDomain, 6);
  const yDomain = finiteExtent(ys, outcome.startsWith("gain_"));
  const metricMeta = ready?.manifest.metrics[metric];
  const outcomeMeta = OUTCOMES.find((item) => item.id === outcome)!;
  const maximumDirections = (ready?.manifest.split.repetitions ?? 10) * (fold === "combined" ? 2 : 1);
  const foldCounts = points.map((item) => item.view.fold_count);
  const minorityDirectionCount = foldCounts.filter((count) => count < maximumDirections / 2).length;
  const missingMetricCount = inView.filter((item) => !finite(item.view.train_diversity[metric])).length;
  const missingOutcomeCount = inView.filter((item) => !finite(item.score[outcome])).length;
  const associationReason = isHighLossMetric(metric) ? highLossAssociationReason(xs, ys, foldCounts, maximumDirections) : null;
  const pearson = isHighLossMetric(metric) ? associationReason ? null : rawPearson(xs, ys) : pearsonCorrelation(xs, ys);
  const spearman = isHighLossMetric(metric) ? associationReason ? null : rawSpearman(xs, ys) : spearmanCorrelation(xs, ys);
  const unavailable = candidates.filter((row) => row.status !== "eligible");
  const statusCounts = new Map<string, number>();
  for (const row of unavailable) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  const retry = () => { cache.current = { shards: new Map() }; setAttempt((value) => value + 1); };

  return <section className="configuration-pair-section" id="configuration-pair-aggregation" aria-labelledby="configuration-pair-heading" aria-busy={loaded.base !== base.exact_configuration || loaded.status === "loading"}>
    <div className="configuration-pair-heading">
      <p className="eyebrow">FIXED EXACT CONFIGURATION · CROSS-FIT</p>
      <h3 id="configuration-pair-heading">Aggregation partners for the selected configuration</h3>
      <p className="configuration-pair-base"><strong>{base.exact_configuration}</strong></p>
      <p>The base stays fixed until you activate another point above. Partners retain their exact model version, prompt, and information condition.</p>
    </div>
    {!ready ? loaded.base === base.exact_configuration && loaded.status === "error" ? <div className="configuration-pair-loading" role="alert"><p>{loaded.error}</p><button type="button" className="download-button" onClick={retry}>Retry aggregation results</button></div> : <p className="configuration-pair-loading" role="status">Loading exact-configuration aggregation results…</p> : <>
      <div className="configuration-pair-controls">
        <label><span>PARTNER PROVIDER</span><select aria-label="Aggregation partner provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>PARTNER PROMPT</span><select aria-label="Aggregation partner prompt" value={prompt} onChange={(event) => setPrompt(event.target.value as typeof prompt)}><option value="all">All prompts</option>{prompts.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>PARTNER INFORMATION</span><select aria-label="Aggregation partner information" value={information} onChange={(event) => setInformation(event.target.value as typeof information)}><option value="all">All information</option>{informationTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>AGGREGATION METHOD</span><select aria-label="Exact configuration aggregation method" value={method} onChange={(event) => setMethod(event.target.value as FreezeAggregationMethodId)}>{ready.manifest.method_order.map((id) => <option value={id} key={id}>{ready.manifest.methods[id].label}{id === "best_single" && !ready.manifest.methods[id].label.toLowerCase().includes("hindsight") ? " (hindsight)" : ""}</option>)}</select></label>
      </div>
      <div className="configuration-pair-axis-controls">
        <div><span>TRAIN DIVERSITY · X</span><div className="market-performance-tabs" role="group" aria-label="Exact configuration diversity metric">{ready.manifest.metric_order.map((id) => <button type="button" aria-pressed={metric === id} className={metric === id ? "active" : ""} onClick={() => setMetric(id)} key={id}>{ready.manifest.metrics[id].label}</button>)}</div></div>
        <div><span>TEST PERFORMANCE · Y</span><div className="market-performance-tabs" role="group" aria-label="Exact configuration aggregation outcome">{OUTCOMES.map((item) => <button type="button" aria-pressed={outcome === item.id} className={outcome === item.id ? "active" : ""} onClick={() => setOutcome(item.id)} key={item.id}>{item.label}</button>)}</div></div>
        <div><span>CROSS-FIT VIEW</span><div className="market-performance-tabs" role="group" aria-label="Exact configuration cross-fit view">{FOLDS.map((item) => <button type="button" aria-pressed={fold === item.id} className={fold === item.id ? "active" : ""} onClick={() => setFold(item.id)} key={item.id}>{item.label}</button>)}</div></div>
        <label><span>TRAIN SAMPLE</span><select aria-label="Exact configuration train sample" value={sample} onChange={(event) => setSample(event.target.value as ConfigurationPairSample)}><option value="all">All train pairs</option><option value="near_bi">Near-BI (train gap ≤ {ready.manifest.split.near_bi_gap})</option></select></label>
        <label><span>SUPPORT</span><select aria-label="Exact configuration support" value={largeSupportOnly ? "at_least_50" : "all"} onChange={(event) => setLargeSupportOnly(event.target.value === "at_least_50")}><option value="all">All computed</option><option value="at_least_50">Both halves ≥50</option></select></label>
      </div>
      <MarketWinToggle checked={highlightMarketWins} onChange={setHighlightMarketWins} scope="Exact configuration aggregation" outcome="brier_index" />
      <dl className="market-performance-kpis configuration-pair-kpis">
        <div><dt>VISIBLE PARTNERS</dt><dd>{points.length}</dd><small>{candidates.length} exact candidates under filters</small></div>
        <div><dt>ABOVE MATCHED MARKET</dt><dd>{points.filter((item) => item.score.beats_market).length}</dd><small>point estimates, not significance</small></div>
        <div><dt>{sample === "near_bi" ? "RETAINED DIRECTIONS" : "AVAILABLE DIRECTIONS"}</dt><dd>{foldCounts.length ? `${Math.min(...foldCounts)}–${Math.max(...foldCounts)}` : "—"}</dd><small>per pair, out of {maximumDirections} attempted{sample === "near_bi" ? "; selected by training BI gap" : ""}</small></div>
        <div><dt>PEARSON r</dt><dd>{number(pearson)}</dd><small>unweighted association on raw values</small></div>
        <div><dt>SMALL-SUPPORT PAIRS</dt><dd>{points.filter((item) => item.view.small_support).length}</dd><small>at least one half has fewer than 50</small></div>
      </dl>
      {minorityDirectionCount > 0 && <p className="configuration-pair-small-support" role="status">Limited retained directions: {minorityDirectionCount} displayed pair(s) use fewer than half of the {maximumDirections} attempted directions. {sample === "near_bi" ? "Near-BI selects training directions; it does not guarantee similar test BI." : "Treat these partial-direction estimates as exploratory."}</p>}
      <HighLossNotice metric={metric} values={xs} missingCount={missingMetricCount} totalCount={inView.length} retainedDirections={foldCounts} maximumDirections={maximumDirections} associationReason={associationReason} diagnostics={inView.flatMap((item) => item.view.high_loss_diagnostics ? [item.view.high_loss_diagnostics] : [])} />
      <div className="market-performance-layout configuration-pair-layout">
        <div className="market-performance-chart-wrap">
          {points.length ? <svg className="configuration-pair-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metricMeta?.label} versus ${outcomeMeta.label} for ${base.exact_configuration}`}>
            <defs>{points.map((item, index) => <linearGradient id={`${chartId}-${index}`} key={item.row.partner.exact_configuration} data-base={base.exact_configuration} data-partner={item.row.partner.exact_configuration}><stop offset="0%" stopColor={configurationProviderColor(base.provider)} /><stop offset="50%" stopColor={configurationProviderColor(base.provider)} /><stop offset="50%" stopColor={configurationProviderColor(item.row.partner.provider)} /><stop offset="100%" stopColor={configurationProviderColor(item.row.partner.provider)} /></linearGradient>)}</defs>
            {linearTicks(yDomain, 6).map((tick) => { const y = linearPosition(tick, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]); return <g key={`y-${tick}`}><line className="market-performance-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} /><text className="market-performance-tick" x={MARGIN.left - 10} y={y + 4} textAnchor="end">{outcomeLabel(tick, outcome)}</text></g>; })}
            {xTicks.map((tick) => { const x = xPosition(tick); return <g key={`x-${tick}`}><line className="market-performance-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="market-performance-tick" x={x} y={HEIGHT - MARGIN.bottom + 22} textAnchor="middle">{number(tick, 3)}</text></g>; })}
            {points.map((item, index) => {
              const exact = item.row.partner.exact_configuration;
              const testGap = item.view.base.brier_index === null || item.view.partner.brier_index === null ? null : Math.abs(item.view.base.brier_index - item.view.partner.brier_index);
              const title = `${exact}\n${metricMeta?.label}: ${number(item.x, 3)}\n${outcomeMeta.label}: ${outcomeLabel(item.y, outcome)}\nAggregation BI: ${number(item.score.brier_index)}\nPair-matched market BI: ${number(item.view.market.brier_index)}\nTrain BI gap: ${number(item.view.train_bi_gap)}\nTest BI gap: ${number(testGap)}\n${sample === "near_bi" ? "Retained training-selected" : "Available"} directions: ${item.view.fold_count}/${maximumDirections}\n${item.view.small_support ? "Small support: a training or test half has fewer than 50 targets" : "Every included half has at least 50 targets"}`;
              return <g className={`configuration-pair-point ${selected?.row.partner.exact_configuration === exact ? "selected" : ""}`} data-partner={exact} transform={`translate(${xPosition(item.x)} ${linearPosition(item.y, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top])})`} role="button" tabIndex={0} aria-label={title} onClick={() => setSelectedPartner(exact)} onFocus={() => setSelectedPartner(exact)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedPartner(exact); } }} key={exact}>
                <circle className="configuration-pair-glyph" r={6.7} fill={`url(#${chartId}-${index})`} />
                {highlightMarketWins && item.score.beats_market && <MarketWinBadge />}
                <circle r={13} fill="transparent" /><title>{title}</title>
              </g>;
            })}
            <text className="market-performance-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 17} textAnchor="middle">Lower diversity ← {metricMeta?.axis} → Higher diversity{highLossScale ? " · signed-log display; raw ticks" : ""}</text>
            <text className="market-performance-axis-label" transform={`translate(20 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{outcomeMeta.label}</text>
          </svg> : <div className="configuration-pair-empty" role="status"><strong>No defined pair estimates in this view.</strong><span>{candidates.length === 0 ? "No partner matches the current provider, prompt, and information filters." : inView.length > 0 ? "The selected diversity metric or outcome is undefined for these computed pairs. No scores have been filled in." : sample === "near_bi" ? "No eligible training-selected Near-BI estimates remain for these controls. No all-pair values have been substituted." : largeSupportOnly ? "No estimates meet the requirement that both halves have at least 50 targets." : "The published pair statuses and selected metric/outcome determine availability; missing scores have not been fabricated."}</span></div>}
        </div>
        <aside className="configuration-pair-inspector" aria-live="polite"><p className="eyebrow">SELECTED EXACT PARTNER</p>{selected ? <>
          <h4>{selected.row.partner.canonical_model_version}</h4><p>{selected.row.partner.information_label} · {selected.row.partner.prompt_label}</p>
          <dl><div><dt>{metricMeta?.label}</dt><dd>{number(selected.x, 3)}</dd></div><div><dt>Aggregation BI ↑</dt><dd>{number(selected.score.brier_index)}</dd></div><div><dt>Raw Brier ↓</dt><dd>{number(selected.score.raw_brier, 3)}</dd></div><div><dt>Base BI ↑</dt><dd>{number(selected.view.base.brier_index)}</dd></div><div><dt>Partner BI ↑</dt><dd>{number(selected.view.partner.brier_index)}</dd></div><div><dt>Train BI gap</dt><dd>{number(selected.view.train_bi_gap)}</dd></div><div><dt>Test BI gap</dt><dd>{number(selectedTestGap)}</dd></div><div><dt>Matched market BI ↑</dt><dd>{number(selected.view.market.brier_index)}</dd></div><div><dt>Gain vs base</dt><dd>{percent(selected.score.gain_vs_base)}</dd></div><div><dt>Gain vs market</dt><dd>{percent(selected.score.gain_vs_market)}</dd></div><div><dt>{sample === "near_bi" ? "Retained training directions" : "Available directions"}</dt><dd>{selected.view.fold_count}/{maximumDirections}</dd></div><div><dt>Min train / test rows</dt><dd>{selected.view.min_train_rows} / {selected.view.min_test_rows}</dd></div><div><dt>Repeated test cells</dt><dd>{selected.view.test_target_cells.toLocaleString()}</dd></div></dl>
          {sample === "near_bi" && <p className="research-scope">Near-BI filters the training gap. Test BI gap is the absolute difference between the displayed mean test BIs, not a selection condition.</p>}
          {isHighLossMetric(metric) && selectedHighLoss && <dl>
            <div><dt>Min marginal high-loss counts A / B</dt><dd>{number(selectedHighLoss.min_high_count_a, 0)} / {number(selectedHighLoss.min_high_count_b, 0)}</dd></div>
            <div><dt>Min joint high-loss count</dt><dd>{number(selectedHighLoss.min_joint_high_count, 0)}</dd></div>
            <div><dt>Defined high-loss directions</dt><dd>{number(selectedHighLoss.defined_fold_count, 0)} / {number(selectedHighLoss.included_fold_count, 0)}</dd></div>
          </dl>}
          {selected.view.small_support && <p className="configuration-pair-small-support">Small-support estimate: at least one included half has fewer than 50 targets.</p>}<small>{selected.row.partner.exact_configuration}</small>
        </> : <p>Select a defined pair after adjusting the controls.</p>}</aside>
      </div>
      <div className="configuration-pair-legend"><strong>Left = fixed base · right = partner</strong>{providers.map((name) => <span key={name}><i style={{ background: configurationProviderColor(name) }} />{name}</span>)}</div>
      <p className="research-scope">{!isHighLossMetric(metric) && <>{missingMetricCount} view(s) have an undefined selected diversity metric; {missingOutcomeCount} have an undefined selected outcome. </>}Spearman ρ: {number(spearman)}. Repeated folds are not independent new events.</p>
      <ResearchDetails label="Pair availability & evaluation details">
        <p><strong>Coverage.</strong> {ready.shard.partners.length} other exact configurations were considered. {unavailable.length} under the current partner filters have unavailable pair data{statusCounts.size ? ` (${[...statusCounts].map(([status, total]) => `${status.replaceAll("_", " ")}: ${total}`).join("; ")})` : ""}.</p>
        {unavailable.length > 0 && <ul>{unavailable.map((row) => <li key={row.partner.exact_configuration}><strong>{row.partner.exact_configuration}</strong>: {row.reason ?? row.status.replaceAll("_", " ")} · {row.n_common} shared targets.</li>)}</ul>}
        <p><strong>Evaluation.</strong> Ten event-grouped train/test splits are attempted in both directions. Metrics use training data; all method, base, partner, and market scores share the same pair-specific test support. Near-BI retains individual training directions before pooling, never an averaged-pair gap. The optional support filter requires every included half to have at least 50 targets.</p>
        <p><strong>Methods.</strong> Directional CF fits weights on training data with the selected exact base as its anchor. Best Single is a test-fold hindsight reference, not a deployable method or a per-question oracle. Gains use pooled adjusted losses; undefined denominators stay undefined.</p>
        <p><strong>Interpretation.</strong> All configurations are explored on Polymarket market questions only. Picking a base after viewing the full-sample overview is exploratory post-selection, not untouched prospective validation. Optional purple check marks show aggregation BI above the pair's own matched-test market BI, regardless of the selected y-axis. They are point-estimate comparisons, not significance claims.</p>
      </ResearchDetails>
    </>}
  </section>;
}
