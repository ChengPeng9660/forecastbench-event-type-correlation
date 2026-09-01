import { useEffect, useMemo, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import { MarketWinBadge, MarketWinToggle, MarketWinVerdict } from "./MarketWinHighlight";
import { MarketConfigurationAggregationExplorer } from "./MarketConfigurationAggregationExplorer";
import { ModelMarketAggregationExplorer } from "./ModelMarketAggregationExplorer";
import { FocalComplementarityExplorer } from "./FocalComplementarityExplorer";
import { FocalWithinTopicComplementarity } from "./FocalWithinTopicComplementarity";
import "../modelMarketAggregation.css";
import { existingAggregationHref, existingLinksForConfiguration } from "../lib/existingAggregationLinks";
import { highLossAssociationReason, highLossAxis, isHighLossMetric, rawPearson, rawSpearman } from "../lib/highLoss";
import { compareMatchedMarket, matchedMarketLabel, matchedMarketWinSummary } from "../lib/matchedMarketComparison";
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
  "total_variation",
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
  return metric === "adjusted_pog" || metric === "total_variation" ? value.toFixed(3) : value.toFixed(2);
}

function formatY(outcome: MarketPerformanceOutcomeId, value: number) {
  return outcome === "raw_brier" ? value.toFixed(3) : value.toFixed(1);
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
  const [highlightMarketWins, setHighlightMarketWins] = useState(false);
  const [provider, setProvider] = useState("all");
  const [prompt, setPrompt] = useState<"all" | MarketPromptType>("all");
  const [information, setInformation] = useState<"all" | MarketInformationType>("all");
  const [selectedConfiguration, setSelectedConfiguration] = useState(data.points[0]?.exact_configuration ?? "");
  const [pinnedBaseConfiguration, setPinnedBaseConfiguration] = useState<string | null>(null);
  const [aggregationScrollRequest, setAggregationScrollRequest] = useState(0);
  const pinnedBase = data.points.find((point) => point.exact_configuration === pinnedBaseConfiguration) ?? null;
  const activateConfiguration = (exact: string) => { setSelectedConfiguration(exact); setPinnedBaseConfiguration(exact); };
  useEffect(() => {
    if (!aggregationScrollRequest) return;
    const frame = window.requestAnimationFrame(() => document.getElementById("configuration-pair-aggregation")?.scrollIntoView?.({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [aggregationScrollRequest]);

  const providers = useMemo(
    () => [...new Set(data.points.map((point) => point.provider))].sort(),
    [data.points],
  );
  const availableInformation = useMemo(
    () => INFORMATION_ORDER.filter((id) => data.points.some((point) => point.information_type === id)),
    [data.points],
  );
  const candidates = useMemo(() => data.points.filter((point) => (
    (provider === "all" || point.provider === provider)
    && (prompt === "all" || point.prompt_type === prompt)
    && (information === "all" || point.information_type === information)
  )), [data.points, provider, prompt, information]);
  const filtered = useMemo(() => candidates.filter((point) => point.diversity[metric] !== null
    && (!isHighLossMetric(metric) || point.diversity[metric] !== 1)
    && Number.isFinite(point.diversity[metric]) && Number.isFinite(point.model[outcome])), [candidates, metric, outcome]);
  const selected = data.points.find((point) => point.exact_configuration === selectedConfiguration) ?? null;
  const selectedUnavailableNotice = selected && !candidates.includes(selected)
    ? "The selected exact configuration is outside the current provider, prompt, or information filters. Its selection is preserved; no other configuration is highlighted."
    : selected && isHighLossMetric(metric) && selected.diversity[metric] === 1
      ? "High-loss diversity = 1 is hidden in this chart. The selected exact configuration remains linked to model + market aggregation below."
      : selected && !filtered.includes(selected)
        ? "The selected exact configuration has an undefined diversity or performance value in this overview and is not plotted. Its selection remains linked to model + market aggregation below."
        : selected && filtered.length < 2
          ? "The overview needs at least two configurations with defined chart values. The selected exact configuration is preserved."
          : null;
  const xValues = filtered.map((point) => point.diversity[metric] as number);
  const yValues = filtered.map((point) => point.model[outcome]);
  const marketWins = matchedMarketWinSummary(filtered.map((point) => compareMatchedMarket(point.model, point.matched_market, outcome)));
  const rawXDomain = finiteExtent(xValues);
  const xDomain: [number, number] = metric === "total_variation" ? [0, 1] : metric === "prediction_diversity" || metric === "adjusted_pog"
    ? [Math.max(0, rawXDomain[0]), rawXDomain[1]]
    : rawXDomain;
  const rawYDomain = finiteExtent(yValues);
  const yDomain: [number, number] = outcome === "raw_brier"
    ? [Math.max(0, rawYDomain[0]), rawYDomain[1]]
    : rawYDomain;
  const highLossScale = isHighLossMetric(metric) ? highLossAxis(xValues, [MARGIN.left, WIDTH - MARGIN.right]) : null;
  const xPosition = (raw: number) => highLossScale?.position(raw) ?? linearPosition(raw, xDomain, [MARGIN.left, WIDTH - MARGIN.right]);
  const xTicks = highLossScale?.ticks ?? linearTicks(xDomain, 6);
  const yTicks = linearTicks(yDomain, 6);
  const associationReason = isHighLossMetric(metric) ? highLossAssociationReason(xValues, yValues) : null;
  const pearson = isHighLossMetric(metric) ? associationReason ? null : rawPearson(xValues, yValues) : pearsonCorrelation(xValues, yValues);
  const spearman = isHighLossMetric(metric) ? associationReason ? null : rawSpearman(xValues, yValues) : spearmanCorrelation(xValues, yValues);
  const selectedX = selected?.diversity[metric] ?? null;
  const aggregationLinks = selected ? existingLinksForConfiguration(selected.exact_configuration) : [];

  return (
    <section className="market-performance-section" id="market-performance">
      <div className="section-heading market-performance-heading">
        <div>
          <p className="eyebrow">ALL CONFIGURATIONS</p>
          <h2>Model performance against the market</h2>
        </div>
        <p>Compare each prompt and information condition with Polymarket on shared freeze-time market events. Dataset questions are excluded.</p>
      </div>

      <div className="market-performance-controls">
        <label><span>PROVIDER</span><select aria-label="Market performance provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <div><span>PROMPT</span><div className="market-performance-tabs" role="group" aria-label="Market performance prompt filter">{PROMPTS.filter((item) => item.id !== "unspecified" || data.audit.prompt_counts.unspecified).map((item) => <button className={prompt === item.id ? "active" : ""} type="button" aria-pressed={prompt === item.id} onClick={() => setPrompt(item.id)} key={item.id}>{item.label}</button>)}</div></div>
        <div><span>INFORMATION</span><div className="market-performance-tabs scrollable" role="group" aria-label="Market performance information filter"><button className={information === "all" ? "active" : ""} type="button" aria-pressed={information === "all"} onClick={() => setInformation("all")}>All information</button>{availableInformation.map((id) => <button className={information === id ? "active" : ""} type="button" aria-pressed={information === id} onClick={() => setInformation(id)} key={id}>{informationLabel(data, id)}</button>)}</div></div>
      </div>

      <div className="market-performance-axis-controls">
        <div><span>DIVERSITY · X</span><div className="market-performance-tabs" role="group" aria-label="Market performance diversity metric">{METRICS.map((id) => <button className={metric === id ? "active" : ""} type="button" aria-pressed={metric === id} onClick={() => setMetric(id)} key={id}>{data.metrics[id].label}</button>)}</div></div>
        <div><span>PERFORMANCE · Y</span><div className="market-performance-tabs"><button className={outcome === "raw_brier" ? "active" : ""} type="button" onClick={() => setOutcome("raw_brier")}>Raw Brier Score ↓</button><button className={outcome === "brier_index" ? "active" : ""} type="button" onClick={() => setOutcome("brier_index")}>Brier Index ↑</button></div></div>
      </div>

      <MarketWinToggle scope="Model performance" checked={highlightMarketWins} onChange={setHighlightMarketWins} outcome={outcome} />
      <dl className="market-performance-kpis">
        <div><dt>CONFIGURATIONS</dt><dd>{filtered.length}</dd><small>{new Set(filtered.map((point) => point.canonical_model_version)).size} model versions</small></div>
        <div><dt>BEATS MATCHED MARKET</dt><dd>{marketWins.wins} / {marketWins.total}</dd><small>{marketWins.rate} · {outcome === "brier_index" ? "BI ↑" : "Raw Brier ↓"} · displayed configurations</small></div>
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
              const x = xPosition(tick);
              return <g key={`x-${tick}`}><line className="market-performance-grid" x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="market-performance-tick" x={x} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{formatX(metric, tick)}</text></g>;
            })}
            {filtered.map((point) => {
              const xValue = point.diversity[metric] as number;
              const yValue = point.model[outcome];
              const x = xPosition(xValue);
              const y = linearPosition(yValue, yDomain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
              const comparison = compareMatchedMarket(point.model, point.matched_market, outcome);
              const label = `${point.canonical_model_version}\n${point.information_label} · ${point.prompt_label}\n${data.metrics[metric].label}: ${formatX(metric, xValue)}\nModel ${data.outcomes[outcome].label}: ${formatY(outcome, yValue)}\nMatched market: ${formatY(outcome, point.matched_market[outcome])}\n${matchedMarketLabel[comparison]} · ${outcome === "brier_index" ? "BI" : "Raw Brier"}\nn = ${point.n_common}`;
              return <g className="market-performance-hit" data-configuration={point.exact_configuration} data-market-comparison={comparison} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} aria-pressed={selected?.exact_configuration === point.exact_configuration} aria-controls="configuration-pair-aggregation" onClick={() => activateConfiguration(point.exact_configuration)} onFocus={() => setSelectedConfiguration(point.exact_configuration)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateConfiguration(point.exact_configuration); } }} key={point.exact_configuration}><PointGlyph point={point} selected={selected?.exact_configuration === point.exact_configuration} />{highlightMarketWins && comparison === "above" && <MarketWinBadge />}<circle className="market-performance-hit-target" r={12} /><title>{label}</title></g>;
            })}
            <text className="market-performance-axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 15} textAnchor="middle">Lower diversity ← {data.metrics[metric].axis} → Higher diversity{highLossScale ? " · signed-log display; raw ticks" : ""}</text>
            <text className="market-performance-axis-label" transform={`translate(20 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{data.outcomes[outcome].axis}</text>
          </svg> : <div className="market-performance-empty">Not enough configurations under the active filters.</div>}
        </div>

        {selected && <aside className="market-performance-inspector" aria-live="polite">
          <p className="eyebrow">SELECTED CONFIGURATION</p>
          <h3>{selected.canonical_model_version}</h3>
          <p>{selected.information_label} · {selected.prompt_label}</p>
          {selectedUnavailableNotice && <p className="model-market-unavailable">{selectedUnavailableNotice}</p>}
          <MarketWinVerdict comparison={compareMatchedMarket(selected.model, selected.matched_market, outcome)} outcome={outcome} />
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
          {isHighLossMetric(metric) && selected.high_loss_diagnostics && <dl>
            <div><dt>Marginal high-loss counts A / B</dt><dd>{selected.high_loss_diagnostics.high_count_a ?? "—"} / {selected.high_loss_diagnostics.high_count_b ?? "—"}</dd></div>
            <div><dt>Joint high-loss count</dt><dd>{selected.high_loss_diagnostics.joint_high_count ?? "—"}</dd></div>
            <div><dt>Expected joint count</dt><dd>{selected.high_loss_diagnostics.expected_joint_count?.toFixed(2) ?? "—"}</dd></div>
          </dl>}
          <small>{selected.exact_configuration}</small>
          <div className="market-performance-aggregation-links">
            <button type="button" className="market-performance-aggregation-cta" aria-controls="configuration-pair-aggregation" onClick={() => { activateConfiguration(selected.exact_configuration); setAggregationScrollRequest((value) => value + 1); }}>Explore aggregation ↓</button>
            {aggregationLinks.length > 0 && <p className="eyebrow">EARLIER EXPERIMENTS</p>}
            {aggregationLinks.map((link) => <div key={`${link.page}-${link.evaluation}`}>
              <a href={existingAggregationHref(link)}>{link.label} →</a>
              <small>{link.evaluation === "cross_fit" ? "Cross-fit OOS" : "Full-sample descriptive"} · {link.methods.length} published methods. {link.scope === "all_events" ? "Dataset + market questions: broader support than this overview." : "Polymarket questions only; each pair uses its own matched support."}</small>
            </div>)}
          </div>
        </aside>}
      </div>

      <div className="market-performance-legend">
        <strong>Information color</strong>{availableInformation.map((id) => <span key={id}><i style={{ background: INFORMATION_COLORS[id] }} />{informationLabel(data, id)}</span>)}
        <strong>Prompt shape</strong><span><i className="shape-circle" />Zero shot</span><span><i className="shape-diamond" />Scratchpad</span>{data.audit.prompt_counts.unspecified ? <span><i className="shape-triangle" />Unspecified</span> : null}
      </div>
      <p className="research-scope">Each model is compared only with Polymarket on its own shared events. Optional badges follow the selected performance metric; they do not indicate statistical significance.</p>
      <ResearchDetails>
        <p><strong>How to read it.</strong> Color distinguishes the information shown to the model; shape distinguishes the prompt. Repeated model names are intentional exact configurations, not duplicate rows. Model and market scores use identical non-imputed support with a valid freeze-time Polymarket probability.</p>
        <p><strong>Matched-market comparison.</strong> There is no shared market line because model coverage differs. The win count uses displayed configurations with a defined matched comparison, once per exact configuration. Badges indicate higher BI or lower Raw Brier than that same configuration’s market score, according to the selected Y axis. Ties within 1e−12 are not wins. The display switch does not change scores, filters, or correlations.</p>
        <p><strong>Total variation.</strong> TV is the mean absolute probability difference between the model and its matched market forecast. It ranges from 0 to 1 and uses no outcomes. Higher TV means greater prediction diversity; it is distinct from 1 − prediction correlation.</p>
        <p><strong>Interpretation.</strong> Correlations are descriptive and do not establish that diversity causes forecasting quality.</p>
      </ResearchDetails>
      {pinnedBase && <MarketConfigurationAggregationExplorer base={pinnedBase} />}
      <ModelMarketAggregationExplorer
        selectedConfiguration={selectedConfiguration || null}
        onSelectConfiguration={setSelectedConfiguration}
        filters={{ provider, prompt, information }}
      />
      <FocalComplementarityExplorer selectedConfiguration={selectedConfiguration || null} />
      <FocalWithinTopicComplementarity selectedConfiguration={selectedConfiguration || null} />
    </section>
  );
}
