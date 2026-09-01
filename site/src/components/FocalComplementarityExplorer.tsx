import { useEffect, useMemo, useRef, useState } from "react";
import {
  eligiblePairs,
  isScore,
  loadComplementarity,
  loadPairProfiles,
  pairGain,
  score,
  studySummary,
} from "../lib/complementarity";
import type {
  AbilityGap,
  CategoryProfile,
  ComplementarityConfiguration,
  ComplementarityData,
  Dimension,
  PairScope,
  Score,
  StudyPair,
} from "../types/complementarity";
import "../focalComplementarity.css";

const PURPLE = "#4f207f";
const GOLD = "#d99b16";
const SLATE = "#73818e";
const WIDTH = 980;
const HEIGHT = 440;
const MARGIN = { top: 28, right: 34, bottom: 74, left: 82 };

const GROUP_LABELS: Record<string, string> = {
  politics: "Politics",
  finance: "Finance",
  climate_weather: "Climate / Weather",
  health: "Health",
  technology: "Technology",
  sports: "Sports",
  entertainment_culture: "Entertainment / Culture",
  polymarket: "Polymarket",
  metaculus: "Metaculus",
  manifold: "Manifold",
  infer: "INFER",
  acled: "ACLED",
  dbnomics: "DBnomics",
  fred: "FRED",
  wikipedia: "Wikipedia",
  yfinance: "Yahoo Finance",
};

type Loaded =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: ComplementarityData };

function mean(values: Score[]): Score {
  const defined = values.filter(isScore);
  return defined.length ? defined.reduce((total, value) => total + value, 0) / defined.length : null;
}

function percentage(value: Score | undefined, digits = 1) {
  return isScore(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function domain(values: number[], includeZero = true): [number, number] {
  if (!values.length) return [0, 1];
  let low = Math.min(...values), high = Math.max(...values);
  if (includeZero) { low = Math.min(0, low); high = Math.max(0, high); }
  const span = high - low || Math.max(1, Math.abs(high) * .2);
  return [low - span * .08, high + span * .08];
}

function position(value: number, input: [number, number], output: [number, number]) {
  return output[0] + (value - input[0]) / (input[1] - input[0] || 1) * (output[1] - output[0]);
}

function ticks(input: [number, number], count = 5) {
  return Array.from({ length: count + 1 }, (_, index) => input[0] + index * (input[1] - input[0]) / count);
}

function partnerName(pair: StudyPair, focal: string) {
  return pair.model_a === focal ? pair.model_b : pair.model_a;
}

function identityLabel(identity: ComplementarityConfiguration | undefined, exact: string) {
  return identity?.canonical_model_version ?? exact.replace(/ \([^)]*\)$/, "");
}

function oriented(pair: StudyPair, focal: string) {
  const focalIsA = pair.model_a === focal;
  return {
    focalIsA,
    focalTrainBi: focalIsA ? pair.train_bi_a : pair.train_bi_b,
    partnerTrainBi: focalIsA ? pair.train_bi_b : pair.train_bi_a,
    focalTestBi: focalIsA ? pair.test_bi_a : pair.test_bi_b,
    partnerTestBi: focalIsA ? pair.test_bi_b : pair.test_bi_a,
    focalGroup: focalIsA ? pair.group_a : pair.group_b,
    partnerGroup: focalIsA ? pair.group_b : pair.group_a,
  };
}

function FocalPartnerScatter({
  pairs,
  focal,
  method,
  selected,
  identities,
  onSelect,
}: {
  pairs: StudyPair[];
  focal: string;
  method: string;
  selected?: StudyPair;
  identities: Map<string, ComplementarityConfiguration>;
  onSelect: (pairId: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const points = pairs.flatMap((pair, index) => {
    const gain = pairGain(pair, method);
    return isScore(pair.train_between_norm) && isScore(gain)
      ? [{ pair, index, x: pair.train_between_norm, y: gain, partner: partnerName(pair, focal) }]
      : [];
  });
  const xDomain: [number, number] = [0, Math.max(.001, ...points.map(point => point.x)) * 1.07];
  const yDomain = domain(points.map(point => point.y));
  const xRange: [number, number] = [MARGIN.left, WIDTH - MARGIN.right];
  const yRange: [number, number] = [HEIGHT - MARGIN.bottom, MARGIN.top];
  const active = points.find(point => point.pair.id === hovered)
    ?? points.find(point => point.pair.id === selected?.id);

  return <figure className="focal-complementarity-scatter">
    <div className="focal-chart-scroll"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Training category complementarity versus held-out aggregation gain for partners of the selected model">
      {ticks(xDomain).map(value => <g key={`x-${value}`}><line className="market-performance-grid" x1={position(value, xDomain, xRange)} x2={position(value, xDomain, xRange)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} /><text className="market-performance-tick" x={position(value, xDomain, xRange)} y={HEIGHT - MARGIN.bottom + 23} textAnchor="middle">{score(value)}</text></g>)}
      {ticks(yDomain).map(value => <g key={`y-${value}`}><line className="market-performance-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={position(value, yDomain, yRange)} y2={position(value, yDomain, yRange)} /><text className="market-performance-tick" x={MARGIN.left - 12} y={position(value, yDomain, yRange) + 4} textAnchor="end">{score(value, 2)}</text></g>)}
      <line className="focal-complementarity-zero" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={position(0, yDomain, yRange)} y2={position(0, yDomain, yRange)} />
      <text className="market-performance-tick" x={WIDTH - MARGIN.right} y={position(0, yDomain, yRange) - 8} textAnchor="end">Equal to better single</text>
      {points.map(point => {
        const isSelected = point.pair.id === selected?.id;
        const x = position(point.x, xDomain, xRange), y = position(point.y, yDomain, yRange);
        const identity = identities.get(point.partner);
        const label = `${point.index + 1}. ${point.partner}\nTraining Dtype: ${score(point.x)}\nTrain BI gap: ${score(point.pair.train_gap)}\nHeld-out gain vs better single: ${score(point.y, 3, true)} BI`;
        return <g className={`focal-complementarity-point${isSelected ? " selected" : ""}`} data-partner={point.partner} data-training-rank={point.index + 1} role="button" tabIndex={0} aria-label={label} aria-pressed={isSelected} transform={`translate(${x} ${y})`} key={point.pair.id}
          onMouseEnter={() => setHovered(point.pair.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(point.pair.id)} onBlur={() => setHovered(null)}
          onClick={() => onSelect(point.pair.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.pair.id); } }}>
          {isSelected && <circle className="focal-complementarity-halo" r="12" />}
          <circle className="focal-complementarity-glyph" r={isSelected ? 6.8 : 5.5} fill={point.y > 1e-10 ? PURPLE : GOLD} />
          {isSelected && <text className="focal-complementarity-point-label" x={x > WIDTH * .68 ? -12 : 12} y="-10" textAnchor={x > WIDTH * .68 ? "end" : "start"}>{identityLabel(identity, point.partner)}</text>}
          <circle className="market-performance-hit-target" r="13" /><title>{label}</title>
        </g>;
      })}
      <text className="market-performance-axis-label" x={WIDTH / 2} y={HEIGHT - 17} textAnchor="middle">Training cross-category complementarity Dtype (normalized) →</text>
      <text className="market-performance-axis-label" transform={`translate(18 ${HEIGHT / 2}) rotate(-90)`} textAnchor="middle">Held-out aggregation BI − better single BI</text>
    </svg></div>
    <div className="focal-complementarity-legend"><span><i style={{ background: PURPLE }} />Beats both models</span><span><i style={{ background: GOLD }} />Below / tied</span><span>Partner ranking uses training Dtype only</span></div>
    <div className="focal-complementarity-readout" aria-live="polite">{active ? <><strong>{identityLabel(identities.get(active.partner), active.partner)}</strong><span>D<sub>type</sub> {score(active.x)} · held-out gain <b>{score(active.y, 3, true)} BI</b></span></> : <span>Select a partner to inspect the pair.</span>}</div>
  </figure>;
}

function CategoryProfileChart({
  pair,
  profiles,
  focal,
  method,
  identities,
}: {
  pair: StudyPair;
  profiles: CategoryProfile[];
  focal: string;
  method: string;
  identities: Map<string, ComplementarityConfiguration>;
}) {
  const direction = oriented(pair, focal);
  const partner = partnerName(pair, focal);
  const rows = [{
    group: "overall",
    focal_train: direction.focalTrainBi,
    partner_train: direction.partnerTrainBi,
    focal_test: direction.focalTestBi,
    partner_test: direction.partnerTestBi,
    aggregation_test: pair.methods[method],
    test_support_ok: true,
  }, ...profiles.map(profile => ({
    group: profile.group,
    focal_train: direction.focalIsA ? profile.train_bi_a : profile.train_bi_b,
    partner_train: direction.focalIsA ? profile.train_bi_b : profile.train_bi_a,
    focal_test: direction.focalIsA ? profile.test_bi_a : profile.test_bi_b,
    partner_test: direction.focalIsA ? profile.test_bi_b : profile.test_bi_a,
    aggregation_test: profile.methods[method],
    test_support_ok: profile.test_support_ok,
  }))].sort((first, second) => {
    const priority = (group: string) => group === "overall" ? 0 : group === direction.focalGroup ? 1 : group === direction.partnerGroup ? 2 : 3;
    return priority(first.group) - priority(second.group) || first.group.localeCompare(second.group);
  });
  const values = rows.flatMap(row => [row.focal_train, row.partner_train, row.focal_test, row.partner_test, row.aggregation_test]).filter(isScore);
  const low = values.length ? Math.floor((Math.min(...values) - 2) / 5) * 5 : 0;
  const high = values.length ? Math.ceil((Math.max(...values) + 2) / 5) * 5 : 100;
  const input: [number, number] = [low, Math.max(low + 5, high)];
  const trainRange: [number, number] = [180, 445], testRange: [number, number] = [585, 850];
  const chartHeight = 73 + rows.length * 64;
  const focalIdentity = identities.get(focal), partnerIdentity = identities.get(partner);

  return <figure className="focal-category-profile">
    <div className="focal-category-title"><div><span><i style={{ background: PURPLE }} />Focal · {identityLabel(focalIdentity, focal)}</span><span><i style={{ background: GOLD }} />Partner · {identityLabel(partnerIdentity, partner)}</span><span><i className="focal-aggregation-key" />Aggregation</span></div><small>BI further right is better · same train/test scale</small></div>
    <div className="focal-chart-scroll"><svg viewBox={`0 0 880 ${chartHeight}`} role="img" aria-label="Category-level training strengths and held-out transfer for the selected focal model and partner">
      <text x={(trainRange[0] + trainRange[1]) / 2} y="20" textAnchor="middle" className="focal-category-heading">TRAIN · identify complementary strengths</text>
      <text x={(testRange[0] + testRange[1]) / 2} y="20" textAnchor="middle" className="focal-category-heading">TEST · evaluate transfer and aggregation</text>
      {[trainRange, testRange].map((range, panel) => <g key={panel}>{ticks(input, 4).map(value => <g key={value}><line className="market-performance-grid" x1={position(value, input, range)} x2={position(value, input, range)} y1="34" y2={chartHeight - 31} /><text className="market-performance-tick" x={position(value, input, range)} y={chartHeight - 12} textAnchor="middle">{value.toFixed(0)}</text></g>)}</g>)}
      {rows.map((row, index) => {
        const y = 58 + index * 64;
        const focalEdge = row.group === direction.focalGroup, partnerEdge = row.group === direction.partnerGroup;
        const label = row.group === "overall" ? "Overall" : GROUP_LABELS[row.group] ?? row.group;
        return <g key={row.group}>
          {index === 0 && <rect x="0" y={y - 22} width="875" height="49" rx="4" className="focal-category-overall" />}
          <text x="4" y={y - 3} className={`focal-category-label${index === 0 ? " overall" : ""}`}>{label}</text>
          {(focalEdge || partnerEdge) && <text x="4" y={y + 17} className={focalEdge ? "focal-edge-label" : "partner-edge-label"}>{focalEdge ? "FOCAL TRAIN EDGE" : "PARTNER TRAIN EDGE"}</text>}
          {([[row.focal_train, row.partner_train, null], [row.focal_test, row.partner_test, row.aggregation_test]] as const).map((valuesForPanel, panel) => {
            const range = panel === 0 ? trainRange : testRange;
            const [focalBi, partnerBi, aggregationBi] = valuesForPanel;
            return <g key={panel}>
              {isScore(focalBi) && isScore(partnerBi) && <line x1={position(focalBi, input, range)} x2={position(partnerBi, input, range)} y1={y} y2={y} className="focal-category-connector" />}
              {isScore(focalBi) && <g><circle cx={position(focalBi, input, range)} cy={y} r="5.5" fill={PURPLE} /><text x={position(focalBi, input, range)} y={y - 11} textAnchor="middle" className="focal-category-value focal-value">{score(focalBi, 1)}</text></g>}
              {isScore(partnerBi) && <g><circle cx={position(partnerBi, input, range)} cy={y} r="5.5" fill={GOLD} /><text x={position(partnerBi, input, range)} y={y + 20} textAnchor="middle" className="focal-category-value partner-value">{score(partnerBi, 1)}</text></g>}
              {isScore(aggregationBi) && <path d={`M${position(aggregationBi, input, range)},${y - 7}l-5.5,11h11Z`} fill={SLATE} stroke="white"><title>Aggregation BI: {score(aggregationBi)}</title></path>}
            </g>;
          })}
        </g>;
      })}
    </svg></div>
    <figcaption>Numbers show focal / partner BI. Categories with fewer than 30 test events remain descriptive and do not confirm transfer.</figcaption>
  </figure>;
}

export function FocalComplementarityExplorer({ selectedConfiguration }: { selectedConfiguration: string | null }) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [activated, setActivated] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [dimension, setDimension] = useState<Dimension>("topic");
  const [abilityGap, setAbilityGap] = useState<AbilityGap>(3);
  const [pairScope, setPairScope] = useState<PairScope>("all");
  const [method, setMethod] = useState("cf_directional");
  const [selectedPairId, setSelectedPairId] = useState("");
  const [profiles, setProfiles] = useState<CategoryProfile[]>([]);
  const [profileError, setProfileError] = useState("");
  const [profileAttempt, setProfileAttempt] = useState(0);

  useEffect(() => {
    setSelectedPairId("");
  }, [selectedConfiguration, dimension, abilityGap, pairScope]);

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
    setLoaded({ status: "loading" });
    loadComplementarity(controller.signal).then(data => {
      if (!controller.signal.aborted) setLoaded({ status: "ready", data });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoaded({ status: "error", error: reason instanceof Error ? reason.message : "Unable to load complementarity results." });
    });
    return () => controller.abort();
  }, [activated, attempt]);

  const data = loaded.status === "ready" ? loaded.data : null;
  const identities = useMemo(() => new Map((data?.configurations ?? []).map(configuration => [configuration.exact_configuration, configuration])), [data]);
  const focalKnown = Boolean(selectedConfiguration && identities.has(selectedConfiguration));
  const allEligible = useMemo(() => !data || !selectedConfiguration ? [] : eligiblePairs(data, dimension, .5, "eligible", abilityGap, pairScope)
    .filter(pair => pair.model_a === selectedConfiguration || pair.model_b === selectedConfiguration)
    .filter(pair => isScore(pair.train_between_norm) && isScore(pairGain(pair, method))), [data, selectedConfiguration, dimension, abilityGap, pairScope, method]);
  const pairs = useMemo(() => !data || !selectedConfiguration ? [] : eligiblePairs(data, dimension, .5, "crossing", abilityGap, pairScope)
    .filter(pair => pair.model_a === selectedConfiguration || pair.model_b === selectedConfiguration)
    .filter(pair => isScore(pair.train_between_norm) && isScore(pairGain(pair, method)))
    .sort((first, second) => (second.train_between_norm ?? -Infinity) - (first.train_between_norm ?? -Infinity)
      || partnerName(first, selectedConfiguration).localeCompare(partnerName(second, selectedConfiguration))), [data, selectedConfiguration, dimension, abilityGap, pairScope, method]);
  const selectedPair = pairs.find(pair => pair.id === selectedPairId) ?? pairs[0];

  useEffect(() => {
    const controller = new AbortController();
    setProfiles([]); setProfileError("");
    if (selectedPair) loadPairProfiles(selectedPair, controller.signal).then(result => {
      if (!controller.signal.aborted) setProfiles(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setProfileError(reason instanceof Error ? reason.message : "Unable to load the category profile.");
    });
    return () => controller.abort();
  }, [selectedPair?.profile_key, profileAttempt]);

  const gains = pairs.map(pair => pairGain(pair, method)).filter(isScore);
  const baselineGains = allEligible.map(pair => pairGain(pair, method)).filter(isScore);
  const meanGain = mean(gains);
  const beatRate = gains.length ? gains.filter(gain => gain > 1e-10).length / gains.length : null;
  const baselineGain = mean(baselineGains);
  const fullSummary = data ? studySummary(data, dimension, .5, "crossing", abilityGap, method, pairScope) : undefined;
  const selectedDirection = selectedPair && selectedConfiguration ? oriented(selectedPair, selectedConfiguration) : null;
  const selectedPartner = selectedPair && selectedConfiguration ? partnerName(selectedPair, selectedConfiguration) : null;
  const selectedIdentity = selectedPartner ? identities.get(selectedPartner) : undefined;
  const focalIdentity = selectedConfiguration ? identities.get(selectedConfiguration) : undefined;
  const selectedGain = selectedPair ? pairGain(selectedPair, method) : null;
  const selectedRank = selectedPair ? pairs.findIndex(pair => pair.id === selectedPair.id) + 1 : 0;
  const selectedAggregationBi = selectedPair?.methods[method];
  const gainVsFocal = isScore(selectedAggregationBi) && isScore(selectedDirection?.focalTestBi) ? selectedAggregationBi - selectedDirection.focalTestBi : null;
  const methodLabel = data?.methods.find(item => item.id === method)?.label ?? method;

  return <section ref={sectionRef} className="focal-complementarity-section configuration-pair-section" id="focal-model-complementarity" aria-labelledby="focal-complementarity-heading" aria-busy={loaded.status === "loading"}>
    <div className="section-heading market-performance-heading focal-complementarity-heading">
      <div><p className="eyebrow">SELECTED MODEL · CATEGORY COMPLEMENTARITY</p><h3 id="focal-complementarity-heading">Who complements the selected model?</h3></div>
      <p>Fix the exact configuration selected in the first chart, screen similarly skilled partners using training categories, then evaluate existing aggregation methods on different events.</p>
    </div>
    <div className="focal-configuration-line"><span>FOCAL MODEL FROM THE FIRST CHART</span><strong>{selectedConfiguration ?? "No configuration selected"}</strong></div>

    {!activated && <div className="configuration-pair-loading" role="status">Complementarity results load when this section enters view.</div>}
    {loaded.status === "loading" && <div className="configuration-pair-loading" role="status">Loading the frozen 313-configuration experiment…</div>}
    {loaded.status === "error" && <div className="configuration-pair-loading" role="alert"><p>{loaded.error}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setAttempt(value => value + 1)}>Retry complementarity results</button></div>}

    {data && <>
      <div className="configuration-pair-controls focal-complementarity-controls">
        <div><span>GROUP QUESTIONS BY</span><div className="market-performance-tabs" role="group" aria-label="Selected-model complementarity grouping"><button type="button" className={dimension === "topic" ? "active" : ""} aria-pressed={dimension === "topic"} onClick={() => setDimension("topic")}>Event type</button><button type="button" className={dimension === "source" ? "active" : ""} aria-pressed={dimension === "source"} onClick={() => setDimension("source")}>Source / platform</button></div></div>
        <label><span>TRAIN BI GAP</span><select aria-label="Selected-model train BI gap" value={abilityGap} onChange={event => setAbilityGap(Number(event.target.value) as AbilityGap)}><option value="3">≤ 3 · main</option><option value="5">≤ 5 · wider</option></select></label>
        <label><span>PARTNER SCOPE</span><select aria-label="Selected-model partner scope" value={pairScope} onChange={event => setPairScope(event.target.value as PairScope)}>{data.pair_scopes.map(scope => <option value={scope.id} key={scope.id}>{scope.label}</option>)}</select></label>
        <label><span>AGGREGATION METHOD</span><select aria-label="Selected-model aggregation method" value={method} onChange={event => setMethod(event.target.value)}>{data.methods.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      </div>
      {!selectedConfiguration || !focalKnown ? <div className="configuration-pair-empty"><strong>{selectedConfiguration ? "This exact configuration is outside the complementarity release." : "Select a model in the first chart."}</strong><span>No replacement focal model is substituted.</span></div> : <>
        <dl className="market-performance-kpis focal-complementarity-kpis">
          <div><dt>SCREENED PARTNERS</dt><dd>{pairs.length}</dd><small>{allEligible.length} near-skill candidates before crossed strengths</small></div>
          <div><dt>MEAN OOS GAIN</dt><dd>{score(meanGain, 3, true)}</dd><small>BI vs better single · primary event holdout</small></div>
          <div><dt>BEATS BOTH</dt><dd>{percentage(beatRate)}</dd><small>{gains.length} defined partner results</small></div>
          <div><dt>NEAR-SKILL BASELINE</dt><dd>{score(baselineGain, 3, true)}</dd><small>all focal pairs before crossed-strength screen</small></div>
          <div><dt>FULL STUDY</dt><dd>{score(fullSummary?.mean_gain_vs_test_best_bi, 3, true)}</dd><small>{fullSummary?.n ?? 0} pairs · {percentage(fullSummary?.beats_both_rate)} beat both</small></div>
        </dl>

        {pairs.length ? <>
          <div className="focal-pair-picker">
            <div><span>FIXED FOCAL</span><strong>{identityLabel(focalIdentity, selectedConfiguration)}</strong><small>{focalIdentity ? `${focalIdentity.prompt_label} · ${focalIdentity.information_label}` : selectedConfiguration}</small></div>
            <label><span>TRAINING-RANKED PARTNER</span><select aria-label="Selected complementary partner" value={selectedPair?.id ?? ""} onChange={event => setSelectedPairId(event.target.value)}>{pairs.map((pair, index) => { const exact = partnerName(pair, selectedConfiguration); const identity = identities.get(exact); return <option value={pair.id} key={pair.id}>{index + 1}. {identityLabel(identity, exact)} · Dtype {score(pair.train_between_norm)}</option>; })}</select><small>Ranking uses training D<sub>type</sub>, descending.</small></label>
          </div>
          <div className="market-performance-layout focal-complementarity-layout">
            <div className="market-performance-chart-wrap"><FocalPartnerScatter pairs={pairs} focal={selectedConfiguration} method={method} selected={selectedPair} identities={identities} onSelect={setSelectedPairId} /></div>
            <aside className="configuration-pair-inspector focal-complementarity-inspector" aria-live="polite" data-focal-configuration={selectedConfiguration} data-partner-configuration={selectedPartner ?? undefined}>
              <p className="eyebrow">TRAIN-SELECTED PARTNER · RANK {selectedRank}</p>
              {selectedPartner && <><h4>{identityLabel(selectedIdentity, selectedPartner)}</h4><p>{selectedIdentity ? `${selectedIdentity.information_label} · ${selectedIdentity.prompt_label}` : "Exact configuration"}</p></>}
              {selectedPair && selectedDirection && <>
                <div className="focal-identity-flags"><span>{selectedPair.same_model_version ? "Same model version" : "Different model versions"}</span><span>{selectedPair.same_prompt ? "Same prompt" : "Different prompts"}</span><span>{selectedPair.same_information ? "Same information" : "Different information"}</span></div>
                <dl>
                  <div><dt>Training D<sub>type</sub></dt><dd>{score(selectedPair.train_between_norm)}</dd></div>
                  <div><dt>Train BI gap</dt><dd>{score(selectedPair.train_gap)}</dd></div>
                  <div><dt>Mean train BI</dt><dd>{score(selectedPair.mean_train_bi, 1)}</dd></div>
                  <div><dt>{methodLabel} BI</dt><dd>{score(selectedAggregationBi)}</dd></div>
                  <div><dt>Focal test BI</dt><dd>{score(selectedDirection.focalTestBi)}</dd></div>
                  <div><dt>Partner test BI</dt><dd>{score(selectedDirection.partnerTestBi)}</dd></div>
                  <div><dt>Gain vs focal</dt><dd>{score(gainVsFocal, 3, true)} BI</dd></div>
                  <div><dt>Gain vs better single</dt><dd>{score(selectedGain, 3, true)} BI</dd></div>
                  <div><dt>Supported train mass</dt><dd>{percentage(selectedPair.train_coverage)}</dd></div>
                </dl>
                <small>{selectedPartner}</small>
              </>}
            </aside>
          </div>

          <div className="focal-category-section"><div className="section-heading"><div><p className="eyebrow">WHY THIS PAIR WAS SCREENED</p><h4>Where do their category strengths differ?</h4></div><p>Training identifies the complementary pattern. Test values show whether the named strengths transfer and whether the unchanged pool improves each category.</p></div>
            {profileError ? <div className="configuration-pair-loading" role="alert"><p>{profileError}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setProfileAttempt(value => value + 1)}>Retry category profile</button></div> : profiles.length && selectedPair ? <CategoryProfileChart pair={selectedPair} profiles={profiles} focal={selectedConfiguration} method={method} identities={identities} /> : <div className="configuration-pair-loading" role="status">Loading the selected pair’s category profile…</div>}
          </div>
        </> : <div className="configuration-pair-empty"><strong>No crossed-strength partner under these controls.</strong><span>{allEligible.length ? `${allEligible.length} near-skill partner${allEligible.length === 1 ? " is" : "s are"} available before the crossed-strength requirement. Try the other grouping, widen the BI gap, or change partner scope.` : "Try the other grouping, widen the BI gap, or change partner scope."}</span></div>}
      </>}
    </>}
  </section>;
}
