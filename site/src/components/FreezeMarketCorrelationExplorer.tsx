import { useEffect, useMemo, useState } from "react";
import type {
  FreezeAggregationMethodId,
  FreezeDiversityMetricId,
  FreezeFoldView,
  FreezeMarketCorrelationData,
  FreezeMarketCorrelationPoint,
  FreezeMarketDirectionPoint,
} from "../types/data";

export type FreezeCorrelationSort = "correlation" | "exact_copy" | "mad" | "support";
export type FreezeAggregationOutcome = "gain_vs_market" | "aggregation_bi";

const FOLD_VIEWS: Array<{ id: FreezeFoldView; label: string }> = [
  { id: "combined", label: "Combined" },
  { id: "a_to_b", label: "A→B" },
  { id: "b_to_a", label: "B→A" },
];

const SCATTER_WIDTH = 980;
const SCATTER_HEIGHT = 430;
const SCATTER_MARGIN = { top: 25, right: 30, bottom: 68, left: 76 };

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const decimal = (value: number, digits = 3) => value.toFixed(digits);
const signedPercent = (value: number | null, digits = 1) => (
  value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`
);

export const FREEZE_AGGREGATION_METHODS: FreezeAggregationMethodId[] = [
  "ec_w0_56",
  "simple_mean",
  "log_odds_mean",
  "piecewise_odds",
  "cf_directional",
  "best_single",
];

export const FREEZE_DIVERSITY_METRICS: FreezeDiversityMetricId[] = [
  "adjusted_pog",
  "high_loss_lift",
  "adjusted_loss_corr",
];

export const FREEZE_PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "#efab02",
  Anthropic: "#4f207f",
  Google: "#4285f4",
  Qwen: "#267c79",
  DeepSeek: "#c75b39",
  Moonshot: "#20242c",
};

export function finiteExtent(values: number[], includeZero = false): [number, number] {
  const valid = values.filter(Number.isFinite);
  let low = valid.length ? Math.min(...valid) : 0;
  let high = valid.length ? Math.max(...valid) : 1;
  if (includeZero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  if (low === high) {
    const expansion = Math.max(Math.abs(low) * 0.08, 0.05);
    return [low - expansion, high + expansion];
  }
  const padding = (high - low) * 0.07;
  return [low - padding, high + padding];
}

export function linearPosition(value: number, domain: [number, number], range: [number, number]) {
  return range[0] + ((value - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);
}

export function linearTicks(domain: [number, number], count = 5) {
  return Array.from({ length: count }, (_, index) => (
    domain[0] + (index / (count - 1)) * (domain[1] - domain[0])
  ));
}

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  xs.forEach((x, index) => {
    const dx = x - meanX;
    const dy = ys[index] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  });
  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator ? covariance / denominator : null;
}

function tiedRanks(values: number[]) {
  const ranked = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array<number>(values.length);
  let start = 0;
  while (start < ranked.length) {
    let end = start + 1;
    while (end < ranked.length && ranked[end].value === ranked[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) result[ranked[index].index] = averageRank;
    start = end;
  }
  return result;
}

export function spearmanCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  return pearsonCorrelation(tiedRanks(xs), tiedRanks(ys));
}

export function freezeAggregationOutcomeValue(
  point: FreezeMarketCorrelationPoint,
  method: FreezeAggregationMethodId,
  outcome: FreezeAggregationOutcome,
  foldView: FreezeFoldView = "combined",
) {
  const score = freezeMarketPointView(point, foldView).aggregation[method];
  return outcome === "gain_vs_market"
    ? score.gain_vs_market
    : score.brier_index;
}

export function freezeMarketPointView(
  point: FreezeMarketCorrelationPoint,
  foldView: FreezeFoldView,
): FreezeMarketDirectionPoint {
  if (foldView !== "combined") return point.directions[foldView];
  return {
    base_name: "Polymarket Freeze",
    partner_name: point.exact_configuration,
    market_brier_index: point.market_brier_index,
    model_brier_index: point.model_brier_index,
    model_gain_vs_market: point.model_gain_vs_market,
    train_diversity: point.train_diversity,
    train_bi_gap: point.train_bi_gap,
    train_near_bi_share: point.train_near_bi_share,
    near_bi: point.near_bi,
    train_target_cells: point.aggregation.ec_w0_56.test_target_cells,
    test_target_cells: point.aggregation.ec_w0_56.test_target_cells,
    aggregation: point.aggregation,
  };
}

export function scatterMetricLabel(metric: FreezeDiversityMetricId, value: number) {
  return metric === "adjusted_pog" ? value.toFixed(3) : value.toFixed(2);
}

export function sortFreezeCorrelationPoints(
  points: FreezeMarketCorrelationPoint[],
  sort: FreezeCorrelationSort,
): FreezeMarketCorrelationPoint[] {
  const rows = [...points];
  rows.sort((a, b) => {
    if (sort === "exact_copy") return b.exact_copy_share - a.exact_copy_share || b.n_common - a.n_common;
    if (sort === "mad") return a.mean_absolute_difference - b.mean_absolute_difference || b.n_common - a.n_common;
    if (sort === "support") return b.n_common - a.n_common || b.prediction_pearson - a.prediction_pearson;
    return b.prediction_pearson - a.prediction_pearson || b.n_common - a.n_common;
  });
  return rows;
}

export function summarizeFreezeCorrelationPoints(points: FreezeMarketCorrelationPoint[]) {
  const support = points.reduce((sum, point) => sum + point.n_common, 0);
  const weighted = (key: "prediction_pearson" | "exact_copy_share" | "mean_absolute_difference") => (
    support ? points.reduce((sum, point) => sum + point[key] * point.n_common, 0) / support : 0
  );
  return {
    models: new Set(points.map((point) => point.model)).size,
    configurations: points.length,
    support,
    correlation: weighted("prediction_pearson"),
    exactCopy: weighted("exact_copy_share"),
    mad: weighted("mean_absolute_difference"),
  };
}

export function summarizeFreezeAggregationPoints(
  points: FreezeMarketCorrelationPoint[],
  method: FreezeAggregationMethodId,
  foldView: FreezeFoldView = "combined",
) {
  const valid = points.filter((point) => {
    const score = freezeMarketPointView(point, foldView).aggregation[method];
    return score && Number.isFinite(score.brier_index) && score.test_target_cells > 0;
  });
  const support = valid.reduce(
    (sum, point) => sum + freezeMarketPointView(point, foldView).aggregation[method].test_target_cells,
    0,
  );
  const weighted = (field: "brier_index" | "gain_vs_market" | "gain_vs_model") => (
    support
      ? valid.reduce(
        (sum, point) => {
          const score = freezeMarketPointView(point, foldView).aggregation[method];
          return sum + score[field] * score.test_target_cells;
        },
        0,
      ) / support
      : null
  );
  return {
    method,
    pairCount: valid.length,
    support,
    weightedBi: weighted("brier_index"),
    gainVsMarket: weighted("gain_vs_market"),
    gainVsModel: weighted("gain_vs_model"),
    positiveVsMarket: valid.filter(
      (point) => freezeMarketPointView(point, foldView).aggregation[method].gain_vs_market > 0,
    ).length,
  };
}

function downloadCorrelationCsv(points: FreezeMarketCorrelationPoint[]) {
  type CsvCell = string | number | boolean | null;
  const directFields: Array<keyof FreezeMarketCorrelationPoint> = [
    "model", "provider", "family", "prompt_type", "prompt_label", "exact_configuration", "n_common", "prediction_pearson",
    "exact_copy_share", "mean_absolute_difference", "root_mean_squared_difference",
    "market_mean_probability", "model_mean_probability", "market_brier_index",
    "model_brier_index", "model_gain_vs_market", "train_bi_gap", "train_near_bi_share", "near_bi",
  ];
  const diversityFields = FREEZE_DIVERSITY_METRICS.map((metric) => `train_diversity_${metric}`);
  const aggregationFields = FREEZE_AGGREGATION_METHODS.flatMap((method) => [
    `${method}_brier_index`,
    `${method}_gain_vs_market`,
    `${method}_gain_vs_model`,
    `${method}_test_target_cells`,
  ]);
  const rows: CsvCell[][] = [
    [...directFields, ...diversityFields, ...aggregationFields] as string[],
    ...points.map((point) => [
      ...directFields.map((field) => point[field] as CsvCell),
      ...FREEZE_DIVERSITY_METRICS.map((metric) => point.train_diversity[metric]),
      ...FREEZE_AGGREGATION_METHODS.flatMap((method) => {
        const score = point.aggregation[method];
        return [score.brier_index, score.gain_vs_market, score.gain_vs_model, score.test_target_cells];
      }),
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${cell === null ? "" : String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "forecastbench_with_freeze_market_correlation.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function FreezeMarketCorrelationExplorer({ data }: { data: FreezeMarketCorrelationData }) {
  const [provider, setProvider] = useState("all");
  const [prompt, setPrompt] = useState<"all" | FreezeMarketCorrelationPoint["prompt_type"]>("all");
  const [sort, setSort] = useState<FreezeCorrelationSort>("correlation");
  const [showAll, setShowAll] = useState(false);
  const [selectedConfiguration, setSelectedConfiguration] = useState(data.points[0]?.exact_configuration ?? "");
  const [aggregationMethod, setAggregationMethod] = useState<FreezeAggregationMethodId>("cf_directional");
  const [diversityMetric, setDiversityMetric] = useState<FreezeDiversityMetricId>("adjusted_pog");
  const [aggregationOutcome, setAggregationOutcome] = useState<FreezeAggregationOutcome>("gain_vs_market");
  const [foldView, setFoldView] = useState<FreezeFoldView>("combined");
  const [nearBiOnly, setNearBiOnly] = useState(false);
  const [selectedAggregationConfiguration, setSelectedAggregationConfiguration] = useState(
    data.points[0]?.exact_configuration ?? "",
  );
  const providers = useMemo(() => [...new Set(data.points.map((point) => point.provider))], [data.points]);
  const filtered = useMemo(
    () => data.points.filter((point) => (
      (provider === "all" || point.provider === provider)
      && (prompt === "all" || point.prompt_type === prompt)
    )),
    [data.points, prompt, provider],
  );
  const ranked = useMemo(() => sortFreezeCorrelationPoints(filtered, sort), [filtered, sort]);
  const summary = useMemo(() => summarizeFreezeCorrelationPoints(filtered), [filtered]);
  const aggregationSummaries = useMemo(
    () => FREEZE_AGGREGATION_METHODS.map(
      (method) => summarizeFreezeAggregationPoints(filtered, method, foldView),
    ),
    [filtered, foldView],
  );
  const bestDeployable = [...aggregationSummaries]
    .filter((row) => row.method !== "best_single" && row.weightedBi !== null)
    .sort((a, b) => (b.weightedBi as number) - (a.weightedBi as number))[0];
  const displayed = showAll || ranked.length <= 12 ? ranked : ranked.slice(0, 12);
  const selected = ranked.find((point) => point.exact_configuration === selectedConfiguration) ?? ranked[0];
  const scatterPoints = useMemo(
    () => filtered.filter((point) => {
      const view = freezeMarketPointView(point, foldView);
      const diversity = view.train_diversity[diversityMetric];
      const outcome = freezeAggregationOutcomeValue(point, aggregationMethod, aggregationOutcome, foldView);
      return (!nearBiOnly || view.near_bi)
        && diversity !== null
        && Number.isFinite(diversity)
        && Number.isFinite(outcome);
    }),
    [aggregationMethod, aggregationOutcome, diversityMetric, filtered, foldView, nearBiOnly],
  );
  const scatterX = scatterPoints.map(
    (point) => freezeMarketPointView(point, foldView).train_diversity[diversityMetric] as number,
  );
  const scatterY = scatterPoints.map((point) => freezeAggregationOutcomeValue(
    point,
    aggregationMethod,
    aggregationOutcome,
    foldView,
  ));
  const scatterPearson = pearsonCorrelation(scatterX, scatterY);
  const scatterSpearman = spearmanCorrelation(scatterX, scatterY);
  const xDomain = finiteExtent(scatterX);
  const yDomain = finiteExtent(scatterY, aggregationOutcome === "gain_vs_market");
  const xTicks = linearTicks(xDomain);
  const yTicks = linearTicks(yDomain);
  const selectedAggregation = scatterPoints.find(
    (point) => point.exact_configuration === selectedAggregationConfiguration,
  ) ?? scatterPoints[0];
  const selectedAggregationView = selectedAggregation
    ? freezeMarketPointView(selectedAggregation, foldView)
    : null;
  const selectedAggregationScore = selectedAggregationView?.aggregation[aggregationMethod];
  const selectedMethodSummary = aggregationSummaries.find((row) => row.method === aggregationMethod);
  const missingDiversityCount = filtered.filter(
    (point) => {
      const view = freezeMarketPointView(point, foldView);
      return (!nearBiOnly || view.near_bi) && view.train_diversity[diversityMetric] === null;
    },
  ).length;

  useEffect(() => {
    if (!ranked.some((point) => point.exact_configuration === selectedConfiguration)) {
      setSelectedConfiguration(ranked[0]?.exact_configuration ?? "");
    }
  }, [ranked, selectedConfiguration]);

  useEffect(() => {
    if (!scatterPoints.some((point) => point.exact_configuration === selectedAggregationConfiguration)) {
      setSelectedAggregationConfiguration(scatterPoints[0]?.exact_configuration ?? "");
    }
  }, [scatterPoints, selectedAggregationConfiguration]);

  function chooseProvider(nextProvider: string) {
    setProvider(nextProvider);
    setShowAll(false);
  }

  function choosePrompt(nextPrompt: "all" | FreezeMarketCorrelationPoint["prompt_type"]) {
    setPrompt(nextPrompt);
    setShowAll(false);
  }

  return (
    <section className="freeze-correlation-section" id="freeze-correlation">
      <div className="section-heading freeze-correlation-heading">
        <div>
          <p className="eyebrow">FREEZE-ONLY PROMPT ↔ MARKET</p>
          <h2>How closely do models track the market snapshot?</h2>
        </div>
        <p>Prediction-level Pearson correlation compares each zero-shot or scratchpad with-freeze configuration with the same ForecastBench freeze-time Polymarket probability. The two prompt types remain separate, and news-augmented configurations are excluded. Higher values mean closer alignment—not higher forecasting quality or causal market influence.</p>
      </div>

      <div className="freeze-correlation-kpis" aria-label="Correlation summary">
        <div><span>CONFIGS</span><strong>{summary.configurations}</strong><small>{summary.models} model versions</small></div>
        <div><span>WEIGHTED r</span><strong>{decimal(summary.correlation)}</strong><small>support-weighted Pearson</small></div>
        <div><span>EXACT COPY</span><strong>{percent(summary.exactCopy)}</strong><small>identical probabilities</small></div>
        <div><span>MEAN |Δp|</span><strong>{percent(summary.mad, 2)}</strong><small>absolute probability gap</small></div>
        <div><span>COMMON CELLS</span><strong>{summary.support.toLocaleString()}</strong><small>non-imputed model–events</small></div>
      </div>

      <div className="freeze-correlation-toolbar">
        <div className="freeze-provider-tabs" role="group" aria-label="Filter models by provider">
          <button className={provider === "all" ? "active" : ""} type="button" onClick={() => chooseProvider("all")}>All providers</button>
          {providers.map((item) => <button className={provider === item ? "active" : ""} type="button" onClick={() => chooseProvider(item)} key={item}>{item}</button>)}
        </div>
        <div className="freeze-provider-tabs" role="group" aria-label="Filter models by prompt type">
          <button className={prompt === "all" ? "active" : ""} type="button" onClick={() => choosePrompt("all")}>All prompts</button>
          <button className={prompt === "zero_shot" ? "active" : ""} type="button" onClick={() => choosePrompt("zero_shot")}>Zero shot</button>
          <button className={prompt === "scratchpad" ? "active" : ""} type="button" onClick={() => choosePrompt("scratchpad")}>Scratchpad</button>
        </div>
        <div className="freeze-correlation-actions">
          <label><span>SORT BY</span><select aria-label="Sort freeze correlation models" value={sort} onChange={(event) => setSort(event.target.value as FreezeCorrelationSort)}><option value="correlation">Prediction correlation</option><option value="exact_copy">Exact-copy share</option><option value="mad">Mean |Δp| (closest first)</option><option value="support">Common support</option></select></label>
          <button className="download-button" type="button" onClick={() => downloadCorrelationCsv(filtered)}>Download CSV ↓</button>
        </div>
      </div>

      <div className="freeze-correlation-layout">
        <div className="freeze-correlation-ranking">
          <div className="freeze-correlation-scale" aria-hidden="true"><span>−1</span><span>0</span><span>+1</span></div>
          {displayed.map((point, index) => {
            const position = Math.max(0, Math.min(100, (point.prediction_pearson + 1) * 50));
            return (
              <button
                className={`freeze-correlation-row ${selected?.model === point.model ? "active" : ""}`}
                type="button"
                aria-label={`Inspect ${point.model}, ${point.prompt_label}, prediction correlation ${decimal(point.prediction_pearson)}`}
                aria-pressed={selected?.exact_configuration === point.exact_configuration}
                onClick={() => setSelectedConfiguration(point.exact_configuration)}
                key={point.exact_configuration}
              >
                <span className="freeze-correlation-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="freeze-correlation-model"><strong>{point.model}</strong><small>{point.provider} · {point.prompt_label} · n {point.n_common.toLocaleString()}</small></span>
                <span className="freeze-correlation-track"><i className="freeze-correlation-zero" /><i className="freeze-correlation-segment" style={{ left: "50%", width: `${Math.max(0, position - 50)}%` }} /><i className="freeze-correlation-dot" style={{ left: `${position}%` }} /></span>
                <strong className="freeze-correlation-value">{decimal(point.prediction_pearson)}</strong>
              </button>
            );
          })}
          {ranked.length > 12 && <button className="freeze-correlation-more" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show top 12" : `Show all ${ranked.length}`}</button>}
        </div>

        {selected && <aside className="freeze-correlation-detail" aria-live="polite">
          <p className="eyebrow">SELECTED MODEL</p>
          <h3>{selected.model}</h3>
          <p className="freeze-correlation-config">{selected.prompt_label} · with freeze values</p>
          <dl>
            <div><dt>Prediction r</dt><dd>{decimal(selected.prediction_pearson)}</dd></div>
            <div><dt>Exact copy</dt><dd>{percent(selected.exact_copy_share)}</dd></div>
            <div><dt>Mean |Δp|</dt><dd>{percent(selected.mean_absolute_difference, 2)}</dd></div>
            <div><dt>RMSE Δp</dt><dd>{percent(selected.root_mean_squared_difference, 2)}</dd></div>
            <div><dt>Market BI</dt><dd>{selected.market_brier_index.toFixed(2)}</dd></div>
            <div><dt>Model BI</dt><dd>{selected.model_brier_index.toFixed(2)}</dd></div>
            <div><dt>Model gain vs market</dt><dd className={selected.model_gain_vs_market >= 0 ? "positive" : "negative"}>{selected.model_gain_vs_market >= 0 ? "+" : ""}{percent(selected.model_gain_vs_market, 2)}</dd></div>
            <div><dt>Common events</dt><dd>{selected.n_common.toLocaleString()}</dd></div>
          </dl>
          <p className="freeze-correlation-note"><strong>Read this as redundancy.</strong> {data.metric.causal_warning} A high correlation means the model stays close to the market input it saw; it does not by itself imply better BI or positive aggregation gain.</p>
        </aside>}
      </div>

      <section className="freeze-aggregation-block" aria-labelledby="freeze-aggregation-title">
        <div className="freeze-aggregation-heading">
          <div>
            <p className="eyebrow">WITH-FREEZE PROMPT × MARKET</p>
            <h3 id="freeze-aggregation-title">Aggregation benchmark</h3>
          </div>
          <p>Every displayed prompt is paired with the same freeze-time Polymarket probability. Results are ten-repeat, event-disjoint cross-fit OOS and follow the active provider and prompt filters above.</p>
        </div>

        <div className="freeze-aggregation-overview">
          <div className="freeze-aggregation-table" role="table" aria-label="With-freeze prompt and Polymarket aggregation method comparison">
            <div className="freeze-aggregation-head" role="row"><span>METHOD</span><span>BI ↑</span><span>GAIN VS PM</span><span>GAIN VS MODEL</span><span>POSITIVE VS PM</span></div>
            {aggregationSummaries.map((row, index) => {
              const metadata = data.aggregation.methods[row.method];
              const benchmark = row.method === "best_single";
              return <button
                className={`freeze-aggregation-row ${benchmark ? "benchmark" : ""} ${aggregationMethod === row.method ? "active" : ""}`}
                role="row"
                type="button"
                aria-label={`Use ${metadata.label} in the diversity chart`}
                aria-pressed={aggregationMethod === row.method}
                onClick={() => setAggregationMethod(row.method)}
                key={row.method}
              >
                <span><i>{benchmark ? "B" : String(index + 1).padStart(2, "0")}</i><strong>{metadata.label}</strong><small>{metadata.role}</small></span>
                <strong>{row.weightedBi?.toFixed(2) ?? "—"}</strong>
                <strong className={(row.gainVsMarket ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsMarket)}</strong>
                <strong className={(row.gainVsModel ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(row.gainVsModel)}</strong>
                <strong>{row.positiveVsMarket}/{row.pairCount}</strong>
              </button>;
            })}
          </div>

          <dl className="freeze-aggregation-summary">
            <div><dt>PROMPT–MARKET PAIRS</dt><dd>{filtered.length}</dd><small>{prompt === "all" ? "zero-shot + scratchpad" : prompt === "zero_shot" ? "zero-shot only" : "scratchpad only"}{provider === "all" ? " · all providers" : ` · ${provider}`}</small></div>
            <div><dt>OOS TARGET CELLS</dt><dd>{(aggregationSummaries[0]?.support ?? 0).toLocaleString()}</dd><small>{foldView === "combined" ? "10 repeats · both directions" : `10 repeated ${foldView === "a_to_b" ? "A→B" : "B→A"} evaluations`}</small></div>
            <div><dt>BEST DEPLOYABLE BI ↑</dt><dd>{bestDeployable?.weightedBi?.toFixed(2) ?? "—"}</dd><small>{bestDeployable ? data.aggregation.methods[bestDeployable.method].label : "no eligible pairs"}</small></div>
            <div><dt>GAIN VS MARKET</dt><dd className={(bestDeployable?.gainVsMarket ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(bestDeployable?.gainVsMarket ?? null)}</dd><small>support-weighted adjusted-Brier reduction</small></div>
          </dl>
        </div>

        <div className="freeze-diversity-explorer">
          <div className="freeze-diversity-heading">
            <div>
              <p className="eyebrow">FIXED POLYMARKET BASE</p>
              <h4>Does a more diverse model improve market aggregation?</h4>
            </div>
            <p>Each point is one exact with-freeze prompt paired with the same freeze-time market probability. Use A→B or B→A to relate one named training-fold diversity estimate to its opposite-fold aggregation outcome; Combined pools both directions.</p>
          </div>

          <div className="freeze-diversity-controls">
            <div className="freeze-diversity-control-group">
              <span>DIRECTION</span>
              <div className="freeze-diversity-tabs" role="group" aria-label="Select Polymarket cross-fit direction">
                {FOLD_VIEWS.map((view) => <button className={foldView === view.id ? "active" : ""} type="button" aria-pressed={foldView === view.id} onClick={() => setFoldView(view.id)} key={view.id}>{view.label}</button>)}
              </div>
            </div>
            <div className="freeze-diversity-control-group">
              <span>DIVERSITY</span>
              <div className="freeze-diversity-tabs" role="group" aria-label="Select market-model diversity metric">
                {FREEZE_DIVERSITY_METRICS.map((metric) => <button
                  className={diversityMetric === metric ? "active" : ""}
                  type="button"
                  aria-pressed={diversityMetric === metric}
                  onClick={() => setDiversityMetric(metric)}
                  key={metric}
                >{data.aggregation.diversity_metrics[metric].label}</button>)}
              </div>
            </div>
            <div className="freeze-diversity-control-group">
              <span>Y AXIS</span>
              <div className="freeze-diversity-tabs" role="group" aria-label="Select aggregation outcome">
                <button className={aggregationOutcome === "gain_vs_market" ? "active" : ""} type="button" aria-pressed={aggregationOutcome === "gain_vs_market"} onClick={() => setAggregationOutcome("gain_vs_market")}>Fraction Gain vs PM</button>
                <button className={aggregationOutcome === "aggregation_bi" ? "active" : ""} type="button" aria-pressed={aggregationOutcome === "aggregation_bi"} onClick={() => setAggregationOutcome("aggregation_bi")}>Aggregation BI</button>
              </div>
            </div>
            <div className="freeze-diversity-control-group">
              <span>SAMPLE</span>
              <div className="freeze-diversity-tabs" role="group" aria-label="Filter by market-model BI similarity">
                <button className={!nearBiOnly ? "active" : ""} type="button" aria-pressed={!nearBiOnly} onClick={() => setNearBiOnly(false)}>All eligible</button>
                <button className={nearBiOnly ? "active" : ""} type="button" aria-pressed={nearBiOnly} onClick={() => setNearBiOnly(true)}>Near-BI</button>
              </div>
            </div>
          </div>

          <div className="freeze-diversity-kpis" aria-label="Diversity and aggregation summary">
            <div><span>METHOD</span><strong>{data.aggregation.methods[aggregationMethod].label}</strong><small>{aggregationMethod === "best_single" ? "hindsight reference" : "deployable aggregation"}</small></div>
            <div><span>PAIR POINTS</span><strong>{scatterPoints.length}</strong><small>{missingDiversityCount ? `${missingDiversityCount} undefined omitted` : "all selected pairs defined"}</small></div>
            <div><span>PEARSON r</span><strong>{scatterPearson === null ? "—" : decimal(scatterPearson, 2)}</strong><small>unweighted across pairs</small></div>
            <div><span>SPEARMAN ρ</span><strong>{scatterSpearman === null ? "—" : decimal(scatterSpearman, 2)}</strong><small>rank association</small></div>
            <div><span>WEIGHTED GAIN</span><strong className={(selectedMethodSummary?.gainVsMarket ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(selectedMethodSummary?.gainVsMarket ?? null)}</strong><small>vs fixed market base</small></div>
          </div>

          <div className="freeze-diversity-layout">
            <div className="freeze-diversity-chart-wrap">
              {scatterPoints.length >= 2 ? <svg
                className="freeze-diversity-chart"
                viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`}
                role="img"
                aria-label={`${data.aggregation.diversity_metrics[diversityMetric].label} versus ${aggregationOutcome === "gain_vs_market" ? "fraction gain versus Polymarket" : "aggregation Brier Index"}`}
              >
                {yTicks.map((tick) => {
                  const y = linearPosition(tick, yDomain, [SCATTER_HEIGHT - SCATTER_MARGIN.bottom, SCATTER_MARGIN.top]);
                  return <g key={`y-${tick}`}><line className="freeze-diversity-grid" x1={SCATTER_MARGIN.left} x2={SCATTER_WIDTH - SCATTER_MARGIN.right} y1={y} y2={y} /><text className="freeze-diversity-tick" x={SCATTER_MARGIN.left - 12} y={y + 4} textAnchor="end">{aggregationOutcome === "gain_vs_market" ? signedPercent(tick) : tick.toFixed(1)}</text></g>;
                })}
                {xTicks.map((tick) => {
                  const x = linearPosition(tick, xDomain, [SCATTER_MARGIN.left, SCATTER_WIDTH - SCATTER_MARGIN.right]);
                  return <g key={`x-${tick}`}><line className="freeze-diversity-grid" x1={x} x2={x} y1={SCATTER_MARGIN.top} y2={SCATTER_HEIGHT - SCATTER_MARGIN.bottom} /><text className="freeze-diversity-tick" x={x} y={SCATTER_HEIGHT - SCATTER_MARGIN.bottom + 22} textAnchor="middle">{scatterMetricLabel(diversityMetric, tick)}</text></g>;
                })}
                {aggregationOutcome === "gain_vs_market" && yDomain[0] <= 0 && yDomain[1] >= 0 && <line
                  className="freeze-diversity-zero-line"
                  x1={SCATTER_MARGIN.left}
                  x2={SCATTER_WIDTH - SCATTER_MARGIN.right}
                  y1={linearPosition(0, yDomain, [SCATTER_HEIGHT - SCATTER_MARGIN.bottom, SCATTER_MARGIN.top])}
                  y2={linearPosition(0, yDomain, [SCATTER_HEIGHT - SCATTER_MARGIN.bottom, SCATTER_MARGIN.top])}
                />}
                {scatterPoints.map((point) => {
                  const pointView = freezeMarketPointView(point, foldView);
                  const xValue = pointView.train_diversity[diversityMetric] as number;
                  const yValue = freezeAggregationOutcomeValue(point, aggregationMethod, aggregationOutcome, foldView);
                  const x = linearPosition(xValue, xDomain, [SCATTER_MARGIN.left, SCATTER_WIDTH - SCATTER_MARGIN.right]);
                  const y = linearPosition(yValue, yDomain, [SCATTER_HEIGHT - SCATTER_MARGIN.bottom, SCATTER_MARGIN.top]);
                  const color = FREEZE_PROVIDER_COLORS[point.provider] ?? "#665f6d";
                  const isSelected = selectedAggregation?.exact_configuration === point.exact_configuration;
                  const pointLabel = `${point.model}, ${point.prompt_label}: diversity ${scatterMetricLabel(diversityMetric, xValue)}, ${aggregationOutcome === "gain_vs_market" ? `gain ${signedPercent(yValue)}` : `BI ${yValue.toFixed(2)}`}`;
                  return <g
                    className={`freeze-diversity-point ${isSelected ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={pointLabel}
                    onClick={() => setSelectedAggregationConfiguration(point.exact_configuration)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedAggregationConfiguration(point.exact_configuration);
                    }}
                    transform={`translate(${x} ${y})`}
                    key={point.exact_configuration}
                  >
                    {point.prompt_type === "scratchpad"
                      ? <rect x={-6} y={-6} width={12} height={12} rx={1.5} fill={color} transform="rotate(45)" />
                      : <circle r={6.5} fill={color} />}
                    <title>{pointLabel}</title>
                  </g>;
                })}
                <text className="freeze-diversity-axis-label" x={(SCATTER_MARGIN.left + SCATTER_WIDTH - SCATTER_MARGIN.right) / 2} y={SCATTER_HEIGHT - 14} textAnchor="middle">Lower diversity ← {data.aggregation.diversity_metrics[diversityMetric].axis} → Higher diversity</text>
                <text className="freeze-diversity-axis-label" transform={`translate(19 ${(SCATTER_MARGIN.top + SCATTER_HEIGHT - SCATTER_MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle">{aggregationOutcome === "gain_vs_market" ? "Fraction gain vs fixed Polymarket base" : "Aggregation Brier Index (higher is better)"}</text>
              </svg> : <div className="freeze-diversity-empty">Not enough defined pairs under the active filters.</div>}
            </div>

            {selectedAggregation && selectedAggregationScore && <aside className="freeze-diversity-inspector" aria-live="polite">
              <p className="eyebrow">SELECTED PROMPT–MARKET PAIR</p>
              <h5>{selectedAggregation.model}</h5>
              <p>{selectedAggregation.prompt_label} · fixed Polymarket base</p>
              <dl>
                <div><dt>{data.aggregation.diversity_metrics[diversityMetric].label}</dt><dd>{scatterMetricLabel(diversityMetric, selectedAggregationView?.train_diversity[diversityMetric] as number)}</dd></div>
                <div><dt>Fraction gain vs PM</dt><dd className={selectedAggregationScore.gain_vs_market >= 0 ? "positive" : "negative"}>{signedPercent(selectedAggregationScore.gain_vs_market)}</dd></div>
                <div><dt>Aggregation BI ↑</dt><dd>{selectedAggregationScore.brier_index.toFixed(2)}</dd></div>
                <div><dt>Market BI ↑</dt><dd>{selectedAggregationView?.market_brier_index.toFixed(2)}</dd></div>
                <div><dt>Train BI gap</dt><dd>{selectedAggregationView?.train_bi_gap.toFixed(2)}</dd></div>
                <div><dt>Near-BI</dt><dd>{selectedAggregationView?.near_bi ? "Yes" : "No"}</dd></div>
                <div><dt>Common events</dt><dd>{selectedAggregation.n_common.toLocaleString()}</dd></div>
                <div><dt>OOS target cells</dt><dd>{selectedAggregationScore.test_target_cells.toLocaleString()}</dd></div>
              </dl>
            </aside>}
          </div>

          <div className="freeze-diversity-legend">
            <span><i className="zero-shot" /> Zero shot</span><span><i className="scratchpad" /> Scratchpad</span>
            {providers.map((item) => <span key={item}><i style={{ backgroundColor: FREEZE_PROVIDER_COLORS[item] ?? "#665f6d" }} /> {item}</span>)}
          </div>
          <p className="freeze-diversity-note"><strong>Interpretation.</strong> The displayed r and ρ are unweighted pair-level associations, not causal effects. All three x axes are oriented so that larger values mean greater market–model diversity. Near-BI keeps pairs whose mean training-fold BI gap is at most {data.aggregation.near_bi.threshold_bi_points.toFixed(1)} points. {foldView === "combined" ? "Combined is a repeated cross-fit aggregate diagnostic." : `${foldView === "a_to_b" ? "A→B" : "B→A"} keeps train diversity and opposite-fold gain directionally aligned.`} The headline method gain remains support-weighted across all provider/prompt-filtered pairs.</p>
        </div>

        <p className="freeze-aggregation-caveat"><strong>Leakage boundary.</strong> Fixed pools never use outcomes. Directional CF estimates its two direction-specific weights on the training fold only. Best Single uses test outcomes to select the better constituent and is shown only as a non-deployable upper-reference benchmark.</p>
      </section>

      <div className="freeze-correlation-audit">
        <p><strong>Freeze-only scope.</strong> Zero-shot and scratchpad configurations are retained as separate rows. Every displayed configuration explicitly includes <code>with freeze values</code>, and configurations containing <code>news</code> are excluded.</p>
        <p><strong>Outcome-blind support.</strong> Imputed market rows are excluded, leaving {data.audit.model_event_cells.toLocaleString()} model–event cells; correlation is computed only on each model's exact common support.</p>
      </div>
    </section>
  );
}
