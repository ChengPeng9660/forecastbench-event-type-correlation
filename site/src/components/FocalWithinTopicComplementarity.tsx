import { useEffect, useMemo, useRef, useState } from "react";
import { ResearchDetails } from "./ResearchDetails";
import {
  findWithinTopicSummary,
  isFiniteScore,
  loadWithinTopicFocal,
  loadWithinTopicStudy,
  trainingEligibleWithinTopicPairs,
  withinTopicGain,
  withinTopicMetric,
} from "../lib/withinTopicComplementarity";
import { score } from "../lib/complementarity";
import type { ComplementarityConfiguration, PairScope, Score } from "../types/complementarity";
import type {
  OverallGap,
  TopicGap,
  TopicSupport,
  WithinTopicFocalData,
  WithinTopicMetric,
  WithinTopicOutcome,
  WithinTopicPair,
  WithinTopicStudy,
} from "../types/withinTopicComplementarity";
import "../withinTopicComplementarity.css";

const PURPLE = "#4f207f";
const GOLD = "#d99b16";
const WIDTH = 980;
const HEIGHT = 440;
const MARGIN = { top: 30, right: 34, bottom: 76, left: 82 };
const EPS = 1e-10;

type StudyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: WithinTopicStudy };

type FocalState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: WithinTopicFocalData };

function identityLabel(identity: ComplementarityConfiguration | undefined, exact: string) {
  return identity?.canonical_model_version ?? exact.replace(/ \([^)]*\)$/, "");
}

function partnerName(pair: WithinTopicPair, focal: string) {
  return pair.model_a === focal ? pair.model_b : pair.model_a;
}

function oriented(pair: WithinTopicPair, focal: string, outcome: WithinTopicOutcome) {
  const focalIsA = pair.model_a === focal;
  return {
    focalIsA,
    focalTrainTopicBi: focalIsA ? pair.train_topic_bi_a : pair.train_topic_bi_b,
    partnerTrainTopicBi: focalIsA ? pair.train_topic_bi_b : pair.train_topic_bi_a,
    focalTestBi: outcome === "topic"
      ? (focalIsA ? pair.test_topic_bi_a : pair.test_topic_bi_b)
      : (focalIsA ? pair.test_bi_a : pair.test_bi_b),
    partnerTestBi: outcome === "topic"
      ? (focalIsA ? pair.test_topic_bi_b : pair.test_topic_bi_a)
      : (focalIsA ? pair.test_bi_b : pair.test_bi_a),
    focalWinShare: focalIsA ? pair.train_a_win_share : pair.train_b_win_share,
    partnerWinShare: focalIsA ? pair.train_b_win_share : pair.train_a_win_share,
    focalRescue: focalIsA ? pair.train_a_rescue : pair.train_b_rescue,
    partnerRescue: focalIsA ? pair.train_b_rescue : pair.train_a_rescue,
  };
}

function mean(values: Score[]): Score {
  const defined = values.filter(isFiniteScore);
  return defined.length ? defined.reduce((total, value) => total + value, 0) / defined.length : null;
}

function percentage(value: Score | undefined, digits = 1) {
  return isFiniteScore(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function domain(values: number[], includeZero = true): [number, number] {
  if (!values.length) return [0, 1];
  let low = Math.min(...values), high = Math.max(...values);
  if (includeZero) { low = Math.min(0, low); high = Math.max(0, high); }
  const span = high - low || Math.max(0.01, Math.abs(high) * .2);
  return [low - span * .08, high + span * .08];
}

function position(value: number, input: [number, number], output: [number, number]) {
  return output[0] + (value - input[0]) / (input[1] - input[0] || 1) * (output[1] - output[0]);
}

function ticks(input: [number, number], count = 5) {
  return Array.from({ length: count + 1 }, (_, index) => input[0] + index * (input[1] - input[0]) / count);
}

function correlation(pairs: WithinTopicPair[], metric: WithinTopicMetric, method: string, outcome: WithinTopicOutcome): Score {
  const points = pairs.flatMap(pair => {
    const x = withinTopicMetric(pair, metric), y = withinTopicGain(pair, method, outcome);
    return isFiniteScore(x) && isFiniteScore(y) ? [[x, y] as const] : [];
  });
  if (points.length < 2) return null;
  const xMean = points.reduce((total, point) => total + point[0], 0) / points.length;
  const yMean = points.reduce((total, point) => total + point[1], 0) / points.length;
  let numerator = 0, xDenominator = 0, yDenominator = 0;
  points.forEach(([x, y]) => {
    numerator += (x - xMean) * (y - yMean);
    xDenominator += (x - xMean) ** 2;
    yDenominator += (y - yMean) ** 2;
  });
  const denominator = Math.sqrt(xDenominator * yDenominator);
  return denominator > 0 ? numerator / denominator : null;
}

function WithinTopicScatter({
  pairs,
  focal,
  metric,
  method,
  outcome,
  topicLabel,
  identities,
  selected,
  onSelect,
}: {
  pairs: WithinTopicPair[];
  focal: string;
  metric: WithinTopicMetric;
  method: string;
  outcome: WithinTopicOutcome;
  topicLabel: string;
  identities: Map<string, ComplementarityConfiguration>;
  selected?: WithinTopicPair;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const points = pairs.flatMap((pair, index) => {
    const x = withinTopicMetric(pair, metric), y = withinTopicGain(pair, method, outcome);
    return isFiniteScore(x) && isFiniteScore(y)
      ? [{ pair, index, x, y, partner: partnerName(pair, focal) }]
      : [];
  });
  const xDomain: [number, number] = [0, Math.max(.0001, ...points.map(point => point.x)) * 1.07];
  const yDomain = domain(points.map(point => point.y));
  const xRange: [number, number] = [MARGIN.left, WIDTH - MARGIN.right];
  const yRange: [number, number] = [HEIGHT - MARGIN.bottom, MARGIN.top];
  const active = points.find(point => point.pair.id === hovered)
    ?? points.find(point => point.pair.id === selected?.id);
  const metricName = metric === "normalized_pog" ? "Normalized POG" : "Adjusted POG";
  const xAxis = metric === "normalized_pog"
    ? "Training within-topic POG ÷ mean pair loss →"
    : "Training within-topic Adjusted POG (loss units) →";

  return <figure className="within-topic-scatter">
    <div className="focal-chart-scroll"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Training within-topic ${metricName} versus held-out aggregation gain in ${topicLabel}`}>
      {ticks(xDomain).map(value => <g key={`x-${value}`}><line className="market-performance-grid" x1={position(value, xDomain, xRange)} x2={position(value, xDomain, xRange)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="market-performance-tick" x={position(value, xDomain, xRange)} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{score(value)}</text></g>)}
      {ticks(yDomain).map(value => <g key={`y-${value}`}><line className="market-performance-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={position(value, yDomain, yRange)} y2={position(value, yDomain, yRange)} /><text className="market-performance-tick" x={MARGIN.left - 12} y={position(value, yDomain, yRange) + 4} textAnchor="end">{score(value, 2)}</text></g>)}
      <line className="within-topic-zero" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={position(0, yDomain, yRange)} y2={position(0, yDomain, yRange)} />
      <text className="market-performance-tick" x={WIDTH - MARGIN.right} y={position(0, yDomain, yRange) - 8} textAnchor="end">Equal to better single</text>
      {points.map(point => {
        const isSelected = point.pair.id === selected?.id;
        const x = position(point.x, xDomain, xRange), y = position(point.y, yDomain, yRange);
        const label = `${point.index + 1}. ${point.partner}\nTraining ${metricName}: ${score(point.x)}\nOverall / topic train BI gaps: ${score(point.pair.train_overall_gap)} / ${score(point.pair.train_topic_gap)}\nHeld-out gain vs better single: ${score(point.y, 3, true)} BI`;
        return <g className={`within-topic-point${isSelected ? " selected" : ""}`} data-partner={point.partner} data-outcome={point.y > EPS ? "beats-both" : "below-or-tied"} data-training-rank={point.index + 1} role="button" tabIndex={0} aria-label={label} aria-pressed={isSelected} transform={`translate(${x} ${y})`} key={point.pair.id}
          onMouseEnter={() => setHovered(point.pair.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(point.pair.id)} onBlur={() => setHovered(null)}
          onClick={() => onSelect(point.pair.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.pair.id); } }}>
          {isSelected && <circle className="within-topic-halo" r="12" />}
          {point.y > EPS
            ? <path className="within-topic-glyph win" d="M0,-7 L6.5,5 L-6.5,5 Z" />
            : <circle className="within-topic-glyph miss" r={isSelected ? 6.5 : 5.5} />}
          {isSelected && <text className="focal-complementarity-point-label" x={x > WIDTH * .68 ? -12 : 12} y="-10" textAnchor={x > WIDTH * .68 ? "end" : "start"}>{identityLabel(identities.get(point.partner), point.partner)}</text>}
          <circle className="market-performance-hit-target" r="14" /><title>{label}</title>
        </g>;
      })}
      <text className="market-performance-axis-label" x={WIDTH / 2} y={HEIGHT - 17} textAnchor="middle">{xAxis}</text>
      <text className="market-performance-axis-label" transform={`translate(18 ${HEIGHT / 2}) rotate(-90)`} textAnchor="middle">Held-out aggregation BI − better single BI</text>
    </svg></div>
    <div className="within-topic-legend"><span><i className="triangle" />Beats both models</span><span><i className="circle" />Below / tied</span><span>Shape does not encode prompt or information</span></div>
    <div className="focal-complementarity-readout" aria-live="polite">{active ? <><strong>{identityLabel(identities.get(active.partner), active.partner)}</strong><span>{metricName} {score(active.x)} · held-out gain <b>{score(active.y, 3, true)} BI</b></span></> : <span>Select a partner to inspect the pair.</span>}</div>
  </figure>;
}

function CoverageBar({ pair, focal }: { pair: WithinTopicPair; focal: string }) {
  const values = oriented(pair, focal, "topic");
  const focalShare = isFiniteScore(values.focalWinShare) ? values.focalWinShare : 0;
  const partnerShare = isFiniteScore(values.partnerWinShare) ? values.partnerWinShare : 0;
  const tie = isFiniteScore(pair.train_tie_share) ? pair.train_tie_share : Math.max(0, 1 - focalShare - partnerShare);
  return <figure className="within-topic-coverage">
    <div className="within-topic-coverage-bar" aria-label={`Focal lower loss ${percentage(focalShare)}, partner lower loss ${percentage(partnerShare)}, tied ${percentage(tie)}`}>
      <span className="focal" style={{ width: `${focalShare * 100}%` }} />
      <span className="partner" style={{ width: `${partnerShare * 100}%` }} />
      <span className="tie" style={{ width: `${tie * 100}%` }} />
    </div>
    <figcaption><span><i className="focal" />Focal lower loss <b>{percentage(focalShare)}</b></span><span><i className="partner" />Partner lower loss <b>{percentage(partnerShare)}</b></span><span><i className="tie" />Tie <b>{percentage(tie)}</b></span></figcaption>
  </figure>;
}

export function FocalWithinTopicComplementarity({ selectedConfiguration }: { selectedConfiguration: string | null }) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [activated, setActivated] = useState(false);
  const [studyState, setStudyState] = useState<StudyState>({ status: "idle" });
  const [focalState, setFocalState] = useState<FocalState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [topic, setTopic] = useState("finance");
  const [overallGap, setOverallGap] = useState<OverallGap>(3);
  const [topicGap, setTopicGap] = useState<TopicGap>(1);
  const [support, setSupport] = useState<TopicSupport>(30);
  const [scope, setScope] = useState<PairScope>("all");
  const [metric, setMetric] = useState<WithinTopicMetric>("normalized_pog");
  const [method, setMethod] = useState("cf_directional");
  const [outcome, setOutcome] = useState<WithinTopicOutcome>("topic");
  const [selectedPairId, setSelectedPairId] = useState("");

  useEffect(() => {
    const element = sectionRef.current;
    if (!element || activated) return;
    const Observer = window.IntersectionObserver;
    if (typeof Observer !== "function") {
      const activateIfNear = () => {
        const bounds = element.getBoundingClientRect();
        if ((bounds.width > 0 || bounds.height > 0) && bounds.top <= window.innerHeight + 500 && bounds.bottom >= -500) setActivated(true);
      };
      const frame = window.requestAnimationFrame(activateIfNear);
      window.addEventListener("scroll", activateIfNear, { passive: true });
      window.addEventListener("resize", activateIfNear);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("scroll", activateIfNear);
        window.removeEventListener("resize", activateIfNear);
      };
    }
    const observer = new Observer(entries => {
      if (entries.some(entry => entry.isIntersecting)) setActivated(true);
    }, { rootMargin: "500px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [activated]);

  useEffect(() => {
    if (!activated) return;
    const controller = new AbortController();
    setStudyState({ status: "loading" });
    loadWithinTopicStudy(controller.signal).then(data => {
      if (!controller.signal.aborted) setStudyState({ status: "ready", data });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setStudyState({ status: "error", error: reason instanceof Error ? reason.message : "Unable to load within-topic results." });
    });
    return () => controller.abort();
  }, [activated, attempt]);

  const study = studyState.status === "ready" ? studyState.data : null;
  useEffect(() => {
    const controller = new AbortController();
    setFocalState({ status: "idle" });
    if (!study || !selectedConfiguration) return;
    setFocalState({ status: "loading" });
    loadWithinTopicFocal(study, selectedConfiguration, controller.signal).then(data => {
      if (!controller.signal.aborted) setFocalState({ status: "ready", data });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setFocalState({ status: "error", error: reason instanceof Error ? reason.message : "Unable to load the selected model." });
    });
    return () => controller.abort();
  }, [study, selectedConfiguration]);

  useEffect(() => setSelectedPairId(""), [selectedConfiguration, topic, overallGap, topicGap, support, scope, metric]);

  const identities = useMemo(() => new Map((study?.configurations ?? []).map(configuration => [configuration.exact_configuration, configuration])), [study]);
  const focalPairs = focalState.status === "ready" ? focalState.data.pairs : [];
  const eligible = useMemo(() => trainingEligibleWithinTopicPairs(focalPairs, topic, overallGap, topicGap, support, scope, metric)
    .sort((first, second) => (withinTopicMetric(second, metric) ?? -Infinity) - (withinTopicMetric(first, metric) ?? -Infinity)
      || partnerName(first, selectedConfiguration ?? "").localeCompare(partnerName(second, selectedConfiguration ?? ""))), [focalPairs, topic, overallGap, topicGap, support, scope, metric, selectedConfiguration]);
  const plotted = useMemo(() => eligible.filter(pair => isFiniteScore(withinTopicGain(pair, method, outcome))), [eligible, method, outcome]);
  const selectedPair = eligible.find(pair => pair.id === selectedPairId) ?? eligible[0];
  const topCount = eligible.length ? Math.max(1, Math.ceil(eligible.length / 4)) : 0;
  const top = eligible.slice(0, topCount);
  const topGains = top.map(pair => withinTopicGain(pair, method, outcome)).filter(isFiniteScore);
  const allGains = eligible.map(pair => withinTopicGain(pair, method, outcome)).filter(isFiniteScore);
  const topMean = mean(topGains), allMean = mean(allGains);
  const topBeatRate = topGains.length ? topGains.filter(value => value > EPS).length / topGains.length : null;
  const localCorrelation = correlation(plotted, metric, method, outcome);
  const fullSummary = study ? findWithinTopicSummary(study, scope, overallGap, topicGap, support, method, outcome, metric) : undefined;
  const validation = study?.validation.validations.find(row => row.pair_scope === scope
    && row.method === method && row.outcome === outcome && row.metric === metric);
  const topicLabel = study?.topics.find(item => item.id === topic)?.label ?? topic;
  const methodLabel = study?.methods.find(item => item.id === method)?.label ?? method;
  const selectedPartner = selectedPair && selectedConfiguration ? partnerName(selectedPair, selectedConfiguration) : null;
  const selectedIdentity = selectedPartner ? identities.get(selectedPartner) : undefined;
  const focalIdentity = selectedConfiguration ? identities.get(selectedConfiguration) : undefined;
  const direction = selectedPair && selectedConfiguration ? oriented(selectedPair, selectedConfiguration, outcome) : null;
  const selectedGain = selectedPair ? withinTopicGain(selectedPair, method, outcome) : null;
  const selectedAggregation = selectedPair?.methods[method]?.[outcome === "topic" ? "topic_bi" : "overall_bi"];
  const selectedRank = selectedPair ? eligible.findIndex(pair => pair.id === selectedPair.id) + 1 : 0;

  return <section ref={sectionRef} className="within-topic-section configuration-pair-section" id="within-topic-complementarity" aria-labelledby="within-topic-heading" aria-busy={studyState.status === "loading" || focalState.status === "loading"}>
    <div className="section-heading market-performance-heading within-topic-heading">
      <div><p className="eyebrow">SELECTED MODEL · WITHIN-TOPIC COMPLEMENTARITY</p><h3 id="within-topic-heading">Do they solve different questions inside the same topic?</h3></div>
      <p>Hold overall and topic ability close, rank partners by training-only POG, then test the existing aggregation methods on different events.</p>
    </div>
    <div className="focal-configuration-line"><span>FOCAL MODEL FROM THE FIRST CHART</span><strong>{selectedConfiguration ?? "No configuration selected"}</strong></div>

    {!activated && <div className="configuration-pair-loading" role="status">Within-topic results load when this section enters view.</div>}
    {studyState.status === "loading" && <div className="configuration-pair-loading" role="status">Loading the frozen within-topic experiment…</div>}
    {studyState.status === "error" && <div className="configuration-pair-loading" role="alert"><p>{studyState.error}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setAttempt(value => value + 1)}>Retry within-topic results</button></div>}

    {study && <>
      <div className="configuration-pair-controls within-topic-controls">
        <label><span>TOPIC</span><select aria-label="Within-topic event type" value={topic} onChange={event => setTopic(event.target.value)}>{study.topics.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>OVERALL TRAIN BI GAP</span><select aria-label="Within-topic overall train BI gap" value={overallGap} onChange={event => setOverallGap(Number(event.target.value) as OverallGap)}><option value="3">≤ 3 · main</option><option value="5">≤ 5 · wider</option></select></label>
        <label><span>TOPIC TRAIN BI GAP</span><select aria-label="Within-topic train BI gap" value={topicGap} onChange={event => setTopicGap(Number(event.target.value) as TopicGap)}><option value="1">≤ 1 · close</option><option value="2">≤ 2</option><option value="3">≤ 3 · wider</option></select></label>
        <label><span>MIN TRAIN TOPIC EVENTS</span><select aria-label="Within-topic train event support" value={support} onChange={event => setSupport(Number(event.target.value) as TopicSupport)}><option value="20">20 · exploratory</option><option value="30">30 · main</option><option value="50">50 · stricter</option></select></label>
        <label><span>PARTNER SCOPE</span><select aria-label="Within-topic partner scope" value={scope} onChange={event => setScope(event.target.value as PairScope)}>{study.pair_scopes.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>AGGREGATION METHOD</span><select aria-label="Within-topic aggregation method" value={method} onChange={event => setMethod(event.target.value)}>{study.methods.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      </div>
      <div className="market-performance-axis-controls within-topic-axis-controls">
        <div><span>TRAIN COMPLEMENTARITY · X</span><div className="market-performance-tabs" role="group" aria-label="Within-topic POG metric">{study.metrics.map(item => <button type="button" className={metric === item.id ? "active" : ""} aria-pressed={metric === item.id} onClick={() => setMetric(item.id)} key={item.id}>{item.label}</button>)}</div></div>
        <div><span>TEST PERFORMANCE · Y</span><div className="market-performance-tabs" role="group" aria-label="Within-topic test outcome">{study.outcomes.map(item => <button type="button" className={outcome === item.id ? "active" : ""} aria-pressed={outcome === item.id} onClick={() => setOutcome(item.id)} key={item.id}>{item.label}</button>)}</div></div>
      </div>
      <p className="research-scope within-topic-scope"><strong>Training-only screen.</strong> Overall BI gap controls general ability; the {topicLabel} BI gap controls ability inside the selected topic. POG is the smaller of the two directions of loss rescued, so it is high only when each model is better on some training targets. Normalized POG divides by their mean topic loss. Test outcomes never rank or choose a partner.</p>

      {!selectedConfiguration ? <div className="configuration-pair-empty"><strong>Select a model in the first chart.</strong><span>The exact model version, prompt, and information condition will remain fixed here.</span></div>
        : focalState.status === "loading" ? <div className="configuration-pair-loading" role="status">Loading partners for the selected exact configuration…</div>
        : focalState.status === "error" ? <div className="configuration-pair-empty"><strong>{focalState.error}</strong><span>No replacement focal model is substituted.</span></div>
        : focalState.status === "ready" && <>
          <dl className="market-performance-kpis within-topic-kpis">
            <div><dt>ELIGIBLE PARTNERS</dt><dd>{eligible.length}</dd><small>{plotted.length} with defined {outcome === "topic" ? "topic" : "whole-test"} Y</small></div>
            <div><dt>TOP-POG OOS GAIN</dt><dd>{score(topMean, 3, true)}</dd><small>top quartile · BI vs better single</small></div>
            <div><dt>TOP-POG BEATS BOTH</dt><dd>{percentage(topBeatRate)}</dd><small>{topGains.length} defined top-quartile results</small></div>
            <div><dt>ALL NEAR-SKILL</dt><dd>{score(allMean, 3, true)}</dd><small>all training-eligible focal partners</small></div>
            <div><dt>POG–GAIN r</dt><dd>{score(localCorrelation, 2)}</dd><small>primary holdout · {plotted.length} plotted partners</small></div>
            <div><dt>FULL STUDY · TOP POG</dt><dd>{score(fullSummary?.top_quartile_mean_gain_bi, 3, true)}</dd><small>{fullSummary?.top_quartile_n_defined ?? 0} / {fullSummary?.top_quartile_n ?? 0} defined · 10 directions</small></div>
          </dl>
          {fullSummary && <p className="within-topic-study-readout"><strong>All-model check under these controls.</strong> Pooled across seven topics and ten fixed split directions, the training top-POG quartile averages <b>{score(fullSummary.top_quartile_mean_gain_bi, 3, true)} BI</b> versus <b>{score(fullSummary.mean_gain_bi, 3, true)} BI</b> for all eligible rows; <b>{percentage(fullSummary.top_quartile_beats_both_rate)}</b> of defined top-quartile rows beat both models. Pearson r = <b>{score(fullSummary.pearson, 2)}</b>; Spearman ρ = <b>{score(fullSummary.spearman, 2)}</b>. These repeated rows are descriptive, not independent trials.</p>}
          {validation && <p className="within-topic-validation-readout"><strong>Pre-specified ability-control check.</strong> With overall BI gap ≤ 3, topic BI gap ≤ 1, and at least 30 training events, top-POG rows outperform the all-eligible mean in <b>{validation.positive_top_minus_all_directions} / {validation.defined_directions}</b> split directions. After descriptive adjustment for overall ability, topic ability, both BI gaps, support, topic, and split direction, standardized POG β = <b>{score(validation.standardized_pog_beta, 3, true)}</b> and adds <b>{score(validation.pog_incremental_r2, 3, true)}</b> R². POG’s correlation with mean topic BI is <b>{score(validation.topic_mean_bi_correlation, 2)}</b>.</p>}

          {!eligible.length ? <div className="configuration-pair-empty"><strong>No partner passes this training screen.</strong><span>Try a wider topic BI gap or lower training-support threshold. The focal model is unchanged.</span></div> : <>
            <div className="focal-pair-picker within-topic-picker">
              <div><span>FIXED FOCAL</span><strong>{identityLabel(focalIdentity, selectedConfiguration)}</strong><small>{focalIdentity ? `${focalIdentity.prompt_label} · ${focalIdentity.information_label}` : selectedConfiguration}</small></div>
              <label><span>TRAINING POG–RANKED PARTNER</span><select aria-label="Within-topic complementary partner" value={selectedPair?.id ?? ""} onChange={event => setSelectedPairId(event.target.value)}>{eligible.map((pair, index) => { const exact = partnerName(pair, selectedConfiguration); return <option value={pair.id} key={pair.id}>{index + 1}. {identityLabel(identities.get(exact), exact)} · POG {score(withinTopicMetric(pair, metric))}</option>; })}</select><small>Ranking uses {metric === "normalized_pog" ? "normalized" : "adjusted"} training POG only.</small></label>
            </div>

            <div className="market-performance-layout within-topic-layout">
              <div className="market-performance-chart-wrap"><WithinTopicScatter pairs={eligible} focal={selectedConfiguration} metric={metric} method={method} outcome={outcome} topicLabel={topicLabel} identities={identities} selected={selectedPair} onSelect={setSelectedPairId} /></div>
              <aside className="configuration-pair-inspector within-topic-inspector" aria-live="polite" data-focal-configuration={selectedConfiguration} data-partner-configuration={selectedPartner ?? undefined}>
                <p className="eyebrow">TRAIN-SELECTED PARTNER · RANK {selectedRank}</p>
                {selectedPartner && <><h4>{identityLabel(selectedIdentity, selectedPartner)}</h4><p>{selectedIdentity ? `${selectedIdentity.information_label} · ${selectedIdentity.prompt_label}` : "Exact configuration"}</p></>}
                {selectedPair && direction && <>
                  <div className="focal-identity-flags"><span>{selectedPair.same_model_version ? "Same model version" : "Different model versions"}</span><span>{selectedPair.same_prompt ? "Same prompt" : "Different prompts"}</span><span>{selectedPair.same_information ? "Same information" : "Different information"}</span></div>
                  <dl>
                    <div><dt>Normalized POG</dt><dd>{score(selectedPair.train_normalized_pog)}</dd></div>
                    <div><dt>Adjusted POG</dt><dd>{score(selectedPair.train_adjusted_pog)}</dd></div>
                    <div><dt>Overall train BI gap</dt><dd>{score(selectedPair.train_overall_gap)}</dd></div>
                    <div><dt>{topicLabel} train BI gap</dt><dd>{score(selectedPair.train_topic_gap)}</dd></div>
                    <div><dt>Focal / partner train BI</dt><dd>{score(direction.focalTrainTopicBi, 1)} / {score(direction.partnerTrainTopicBi, 1)}</dd></div>
                    <div><dt>Focal / partner rescued loss</dt><dd>{score(direction.focalRescue)} / {score(direction.partnerRescue)}</dd></div>
                    <div><dt>{methodLabel} BI</dt><dd>{score(selectedAggregation)}</dd></div>
                    <div><dt>Focal / partner test BI</dt><dd>{score(direction.focalTestBi)} / {score(direction.partnerTestBi)}</dd></div>
                    <div><dt>Gain vs better single</dt><dd>{score(selectedGain, 3, true)} BI</dd></div>
                    <div><dt>Train / test topic events</dt><dd>{selectedPair.train_topic_events} / {selectedPair.test_topic_events}</dd></div>
                  </dl>
                  <p className={`within-topic-verdict${isFiniteScore(selectedGain) && selectedGain > EPS ? " win" : ""}`}>{!isFiniteScore(selectedGain) ? `Held-out ${topicLabel} gain is undefined because fewer than ${study.test_topic_support} test events are available.` : selectedGain > EPS ? `The unchanged ${methodLabel} pool beats both models on held-out ${outcome === "topic" ? topicLabel : "whole-test"} support.` : `The unchanged ${methodLabel} pool does not beat the better single model on this holdout.`}</p>
                  <small>{selectedPartner}</small>
                </>}
              </aside>
            </div>

            {selectedPair && <section className="within-topic-mechanism" aria-labelledby="within-topic-mechanism-heading">
              <div className="section-heading"><div><p className="eyebrow">WHY POG RANKED THIS PAIR</p><h4 id="within-topic-mechanism-heading">Who has the smaller error on the training targets?</h4></div><p>The two topic BI scores can be nearly equal even when their correctable losses occur on different targets.</p></div>
              <CoverageBar pair={selectedPair} focal={selectedConfiguration} />
              <div className="within-topic-pog-identity"><span>Focal rescues <b>{score(direction?.focalRescue)}</b> loss from partner</span><span>Partner rescues <b>{score(direction?.partnerRescue)}</b> loss from focal</span><strong>POG = smaller rescue = {score(selectedPair.train_adjusted_pog)}</strong></div>
            </section>}
          </>}
        </>}

      <ResearchDetails label="Experiment definition & interpretation">
        <p><strong>Ability is controlled twice.</strong> A pair must pass both the overall training BI-gap threshold and the selected topic’s training BI-gap threshold. Prompt and information conditions remain attached to each exact configuration; the partner-scope control can require matched conditions or a different model version.</p>
        <p><strong>POG measures reciprocal correction.</strong> For each training target, compare the two squared Brier losses. One rescue term is the mean positive amount by which A improves on B; the other reverses A and B. Adjusted POG is the smaller rescue. If only one model ever improves on the other, POG is zero. Normalized POG divides by their mean topic raw loss to reduce remaining loss-scale differences.</p>
        <p><strong>Question difficulty remains in BI.</strong> Official question fixed effects and the BI transformation are retained for the two ability gates and all reported BI outcomes. The same fixed effect appears in both losses for a common target, so it cancels exactly from POG’s pairwise loss difference.</p>
        <p><strong>Evaluation is out of sample.</strong> Five deterministic event splits are evaluated in both directions. Overall gap, topic gap, training support, pair scope, and POG rank use only the training half. The five aggregation formulas are unchanged and use no topic-specific routing. Selected-topic Y requires at least {study.test_topic_support} test events; an undefined value is never replaced with zero.</p>
        <p><strong>Limits.</strong> POG is an ex-post oracle diagnostic, not a deployable question router. Reused events make pair and split rows dependent, so correlations and win rates are descriptive. A positive association supports the proposed screening idea; it does not establish causality or guarantee improvement for a new pair.</p>
      </ResearchDetails>
    </>}
  </section>;
}
