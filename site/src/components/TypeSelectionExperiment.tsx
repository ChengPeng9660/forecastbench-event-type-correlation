import { useEffect, useState } from "react";
import { isScore, score, shortModel } from "../lib/complementarity";
import {
  loadRouting, loadRoutingPair, metricDigits, metricName, ROUTING_PATH, routingGain, routingSummary,
  type RoutingAggregate, type RoutingData, type RoutingMetric, type RoutingPair,
  type RoutingScope, type TestScope,
} from "../lib/typeSelection";
import type { AbilityGap, Dimension, PairScope, Score, StudyPair } from "../types/complementarity";
import "../typeSelection.css";
import TypeSelectionMechanisms from "./TypeSelectionMechanisms";

const TYPE_NAMES: Record<string, string> = {
  politics: "Politics", finance: "Finance", health: "Health", sports: "Sports",
  technology: "Technology", climate_weather: "Climate / Weather", entertainment_culture: "Entertainment / Culture",
};
const percent = (value: Score) => isScore(value) ? `${(100 * value).toFixed(1)}%` : "—";
type ResultView = "cohort" | "pair";
type Props = { pairs: StudyPair[]; selected?: StudyPair; dimension: Dimension;
  abilityGap: AbilityGap; coverage: number; pairScope: PairScope; showEventTypes: () => void };

function initialMetric(): RoutingMetric {
  const metric = new URLSearchParams(window.location.search).get("ts_metric");
  return metric === "bi" || metric === "ece" ? metric : "brier";
}

function ScopePanel({ scope, aggregate, pair, metric, labels, view }: {
  scope: TestScope; aggregate?: RoutingAggregate; pair?: RoutingScope;
  metric: RoutingMetric; labels: string[]; view: ResultView;
}) {
  const isPair = view === "pair", values = isPair ? pair?.scores[metric] : aggregate?.scores[metric];
  const events = isPair ? pair?.events : aggregate?.mean_events;
  const targets = isPair ? pair?.targets : aggregate?.mean_targets;
  const coverage = isPair ? pair?.event_fraction : aggregate?.mean_event_fraction;
  const fallback = isPair ? pair?.fallback_fraction : aggregate?.mean_fallback_fraction;
  const valid = isPair ? (pair?.events ?? 0) > 0 : (aggregate?.defined_pairs ?? 0) > 0;
  const betterThan = values && valid ? [1, 2, 3, 4].filter(index => (routingGain(values, index, metric) ?? 0) > 1e-10).length : null;
  const bestSingleGain = isPair && pair?.best_single != null && values
    ? routingGain(values, pair.best_single, metric) : aggregate?.routing_gain_vs_best_single[metric];
  const digits = metricDigits(metric);
  return <article className="ts-scope" data-testid={`ts-${scope}`}>
    <div className="ts-scope-heading"><p className="cc-eyebrow">{scope === "complementary" ? "01 / TARGETED TEST" : "02 / COMPLETE TEST"}</p>
      <h3>{scope === "complementary" ? "Complementary events only" : "All test events"}</h3>
      <p>{scope === "complementary" ? "Test events in all types with a supported ≥1 BI training advantage." : "Every shared test event, including other types and fallback cases."}</p>
    </div>
    <div className="ts-primary-score"><div><span>Type-based selection · {metricName(metric)}</span><strong>{score(valid ? values?.[0] : null, digits)}</strong></div>
      <div className="ts-takeaway"><b>{betterThan == null ? "—" : `${betterThan} / 4`}</b><span>formulas beaten on {isPair ? "test" : "mean test"} {metric === "brier" ? "Brier score" : metric === "bi" ? "BI" : "ECE"}</span></div></div>
    <dl className="ts-support"><div><dt>{isPair ? "Test events" : "Mean events / pair"}</dt><dd>{score(events, isPair ? 0 : 1)}</dd></div>
      <div><dt>Share of all test events</dt><dd>{percent(coverage ?? null)}</dd></div>
      <div><dt>Fallback event weight</dt><dd>{percent(fallback ?? null)}</dd></div></dl>
    {!valid || !values ? <p className="cc-empty">{isPair ? "No test events in this scope, or the selected pair has no crossed training strengths." : "No crossed-strength pairs satisfy these training filters."}</p>
      : <div className="ts-table-scroll"><table className="ts-results-table"><caption>{isPair ? "Selected pair" : "Equal-weight pair means"} · identical support for every method</caption>
        <thead><tr><th>Method</th><th>{metricName(metric)}</th><th>Routing gain ↑</th>{!isPair && <th>Routing wins</th>}</tr></thead>
        <tbody>{labels.slice(0, 5).map((label, index) => {
          const gain = routingGain(values, index, metric);
          return <tr key={label} className={index === 0 ? "ts-route-row" : ""}><th scope="row">{label}</th><td>{score(values[index], digits)}</td>
            <td className={isScore(gain) && index > 0 ? gain > 0 ? "ts-positive" : gain < 0 ? "ts-negative" : "" : ""}>{index ? score(gain, digits, true) : "Reference"}</td>
            {!isPair && <td>{index ? percent(aggregate?.routing_win_rates[metric][index] ?? null) : "—"}</td>}</tr>;
        })}</tbody></table></div>}
    {valid && values && <div className="ts-baselines"><p><span>Routing gain vs Overall train-selected single</span><strong>{score(routingGain(values, 7, metric), digits, true)}</strong></p>
      <p><span>Routing gain vs better test single <small>(Brier-selected reference)</small></span><strong>{score(bestSingleGain, digits, true)}</strong></p>
      {isPair && <p className="ts-single-scores">Model A: {score(values[5], digits)} · Model B: {score(values[6], digits)}</p>}</div>}
    <p className="cc-caption">{!isPair && `${aggregate?.defined_pairs ?? 0} / ${aggregate?.pairs ?? 0} pairs defined. `}
      {isPair ? "" : "Mean "}{score(targets, isPair ? 0 : 1)} targets {isPair ? "in this scope" : "per pair"}.
      {scope === "complementary" ? " Subset membership uses training data only." : " The router is identical in both test scopes."}</p>
  </article>;
}

function RouteMap({ pair, selected }: { pair?: RoutingPair; selected?: StudyPair }) {
  if (!pair || !selected) return <p className="cc-empty">Choose a pair with crossed training strengths in the pair explorer above to inspect its frozen routing map.</p>;
  return <div className="ts-route-map"><p><strong>A</strong> · {shortModel(selected.model_a)}<br /><strong>B</strong> · {shortModel(selected.model_b)}</p>
    <div className="ts-table-scroll"><table><caption>Every decision below is fitted on the training fold.</caption>
      <thead><tr><th>Event type</th><th>Train events</th><th>Train BI · A − B</th><th>Use model</th><th>In complementary subset?</th></tr></thead>
      <tbody>{pair.routes.map(route => <tr key={route.type}><th scope="row">{TYPE_NAMES[route.type] ?? route.type}</th><td>{route.train_events}</td><td>{score(route.train_gap_bi, 3, true)}</td><td><b className={`ts-model-${route.selected}`}>{route.selected === 0 ? "A" : "B"}</b>{route.fallback && " · fallback"}</td><td>{route.complementary ? "Yes" : "No"}</td></tr>)}
        <tr><th scope="row">Unseen / unlabeled types</th><td>—</td><td>—</td><td><b>{pair.fallback === 0 ? "A" : "B"}</b> · fallback</td><td>No</td></tr></tbody></table></div>
    <p className="cc-caption">Supported types choose their lower training-Brier model, including gaps below 1 BI. Types with fewer than 30 training events, ties and unknown labels use the Overall training winner. The ≥1 BI threshold defines only the complementary test subset.</p>
  </div>;
}

function Experiment({ data, ...props }: Props & { data: RoutingData }) {
  const [metric, setMetric] = useState<RoutingMetric>(initialMetric);
  const [view, setView] = useState<ResultView>(() => new URLSearchParams(window.location.search).get("ts_view") === "pair" ? "pair" : "cohort");
  const summary = routingSummary(data, props.abilityGap, props.coverage, props.pairScope);
  const [selected, setSelected] = useState<RoutingPair | undefined>();
  const [pairError, setPairError] = useState("");
  const [pairAttempt, setPairAttempt] = useState(0);
  const [pairLoading, setPairLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setSelected(undefined); setPairError("");
    const id = props.selected?.id;
    setPairLoading(Boolean(id && data.pair_shards[id]));
    if (id) loadRoutingPair(data, id, controller.signal).then(pair => {
      if (!controller.signal.aborted) { setSelected(pair ?? undefined); setPairLoading(false); }
    }).catch(reason => { if (!controller.signal.aborted) { setPairError(String(reason.message ?? reason)); setPairLoading(false); } });
    return () => controller.abort();
  }, [data, props.selected?.id, pairAttempt]);
  const directions = data.summaries.filter(row => row.ability_gap === props.abilityGap && row.coverage === props.coverage && row.pair_scope === props.pairScope);
  const currentCrossedPairs = props.pairs.filter(pair => pair.crossing === true).length;
  const scopeDescription = props.pairScope === "all" ? "All exact configurations" : props.pairScope === "different_model_version" ? "Different model versions" : "Same prompt + information";
  const digits = metricDigits(metric);
  function change(nextMetric: RoutingMetric, nextView: ResultView) {
    setMetric(nextMetric); setView(nextView);
    const query = new URLSearchParams(window.location.search);
    query.set("ts_metric", nextMetric); query.set("ts_view", nextView);
    history.replaceState(null, "", `${window.location.pathname}?${query.toString()}${window.location.hash}`);
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cc_section") === "type-selection") {
      document.getElementById("type-selection")?.scrollIntoView({ block: "start" });
    }
  }, []);
  if (props.dimension !== "topic") return <div className="ts-event-type-notice"><p>This experiment routes by event type. Switch the grouping above to view its two test scopes.</p><button className="research-button" onClick={props.showEventTypes}>View event-type selection</button></div>;
  return <>
    <p className="ts-intro">Use the model with the lower historical Brier score for each event type. Compare this single frozen rule with four pooling formulas on a targeted subset and the complete test set.</p>
    <button className="cc-text-button" onClick={() => {
      const query = new URLSearchParams(location.search); query.set("cc_section", "type-selection-mechanisms");
      history.replaceState(null, "", `${location.pathname}?${query}${location.hash}`);
      document.getElementById("type-selection-mechanisms")?.scrollIntoView({block:"start", behavior:"smooth"});
    }}>Explore why pooling can beat selection ↓</button>
    <div className="ts-controls"><div className="cc-segments" role="group" aria-label="Type-selection result view"><button aria-pressed={view === "cohort"} onClick={() => change(metric, "cohort")}>Cohort results</button><button aria-pressed={view === "pair"} onClick={() => change(metric, "pair")}>Selected pair</button></div>
      <div className="cc-segments" role="group" aria-label="Type-selection metric">{(["brier", "bi", "ece"] as const).map(value => <button key={value} aria-pressed={metric === value} onClick={() => change(value, view)}>{metricName(value)}</button>)}</div></div>
    <p className="ts-filter-context" data-testid="ts-filter-context"><strong>{currentCrossedPairs.toLocaleString()} crossed-strength pairs</strong> · Train BI gap ≤{props.abilityGap} · ≥{props.coverage * 100}% training coverage · {scopeDescription}</p>
    <p className="cc-caption">Uses the model-pair, ability-gap, coverage and identity filters above. This comparison always requires crossed training strengths and shows all four formulas together.</p>
    {view === "pair" && <p className="ts-selected-name" data-testid="ts-selected-name">{props.selected ? <><b>A</b> · {shortModel(props.selected.model_a)}<br /><b>B</b> · {shortModel(props.selected.model_b)}</> : "Select a model pair above."}</p>}
    {pairError && <p role="alert">{pairError} <button className="cc-text-button" onClick={() => setPairAttempt(value => value + 1)}>Retry routing map</button></p>}
    {view === "pair" && pairLoading ? <p className="cc-empty" role="status">Loading this pair’s two test scopes…</p> : <div className="ts-two-scopes">{(["complementary", "all"] as const).map(scope => <ScopePanel key={scope} scope={scope} aggregate={summary?.scopes[scope]} pair={selected?.scopes[scope]} labels={data.method_labels} metric={metric} view={view} />)}</div>}
    <div className="ts-reading-key"><span className="ts-positive">Positive routing gain: selection performs better.</span><span className="ts-negative">Negative: the comparator performs better.</span><p>{metric === "bi" ? "Gain = routing BI − comparator BI." : `Gain = comparator ${metric === "brier" ? "Brier score" : "ECE"} − routing ${metric === "brier" ? "Brier score" : "ECE"}.`} Win rates count strict pair-level improvements. The two scopes are nested; each formula is evaluated on exactly the same targets as routing within a scope.</p></div>
    <details className="cc-details"><summary>Inspect the selected pair’s historical routing map</summary><RouteMap pair={selected} selected={props.selected} /></details>
    <details className="cc-details"><summary>Stability across ten fixed event directions</summary><p className="cc-caption">Routing gain versus Simple mean, a fixed comparator. Each direction repeats training selection on its own training fold. These overlapping directions are not independent replications.</p>
      <div className="ts-table-scroll"><table className="ts-direction-table"><thead><tr><th>Split / direction</th><th>Pairs</th><th>Complementary events</th><th>All events</th></tr></thead><tbody>{directions.map(row => <tr key={`${row.split}-${row.fold}`}><th scope="row">{row.split} · {row.fold === 0 ? "A → B" : "B → A"}{row.split === data.primary_split && row.fold === data.primary_fold ? " · primary" : ""}</th><td>{row.scopes.all.defined_pairs}</td>{(["complementary", "all"] as const).map(scope => <td key={scope}>{score(routingGain(row.scopes[scope].scores[metric], 1, metric), digits, true)}</td>)}</tr>)}</tbody></table></div></details>
    <details className="cc-details"><summary>Method, support and verification</summary>
      <p>At least 30 common training events support a type. Complementary types include every supported type with an absolute training BI gap ≥1, and both models must lead in different types. Test outcomes never determine membership or routing. Other supported types still choose their historical winner; sparse, tied and unknown types fall back to the Overall training winner.</p>
      <p>Brier score is averaged within each event, then equally across events. BI = 100 × (1 − √Brier score), calculated per pair and scope. ECE uses ten equal-width bins and target weights. Cohort scores are equal-weight means across defined pairs; mean BI is not a transform of the cohort’s mean Brier score.</p>
      <p>{data.audit.evaluated_pair_directions.toLocaleString()} pair directions were evaluated. Fixed-formula reconstruction error: {data.audit.max_frozen_score_error.toExponential(2)}. Independent grouped-event reconstruction checked {data.audit.independent.sampled_primary_pairs} primary pairs, with maximum error {data.audit.independent.max_absolute_error.toExponential(2)}.</p>
      <p>This is a new retrospective comparison in the existing historical archive. The event splits are not chronological forecasts of future events. Shared models and events prevent interpreting pair counts as independent evidence.</p>
    </details>
    <div className="cc-downloads"><a href={`${ROUTING_PATH}REPORT.md`}>Results report ↗</a><a href={`${ROUTING_PATH}PROTOCOL.md`}>Routing protocol ↗</a><a href={`${ROUTING_PATH}primary-pairs.csv`} download>Primary pair results CSV ↗</a><a href={`${ROUTING_PATH}all-directions.csv.gz`} download>All ten directions CSV.gz ↗</a><a href={`${ROUTING_PATH}audit.json`}>Numerical audit ↗</a></div>
    <p className="cc-caption">{data.date} · Derived from ForecastBench · CC BY-SA 4.0.</p>
    <TypeSelectionMechanisms gap={props.abilityGap} coverage={props.coverage} pairScope={props.pairScope} />
  </>;
}

export default function TypeSelectionExperiment(props: Props) {
  const [data, setData] = useState<RoutingData | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    loadRouting(controller.signal).then(setData).catch(reason => { if (!controller.signal.aborted) setError(String(reason.message ?? reason)); });
    return () => controller.abort();
  }, [attempt]);
  return <section id="type-selection" className="cc-block ts-experiment" aria-label="Type-based model selection experiment">
    <div className="cc-section-heading"><div><p className="cc-eyebrow">NEW EXPERIMENT / TYPE-BASED SELECTION</p><h2>Choose the specialist, or combine both?</h2></div></div>
    {data ? <Experiment {...props} data={data} /> : <div className="cc-empty" role={error ? "alert" : "status"}><p>{error || "Loading the two-scope selection experiment…"}</p>{error && <button className="research-button" onClick={() => setAttempt(value => value + 1)}>Retry type-selection results</button>}</div>}
  </section>;
}
