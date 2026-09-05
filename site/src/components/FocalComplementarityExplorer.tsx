import { useEffect, useMemo, useRef, useState } from "react";
import {
  eligiblePairs,
  isScore,
  loadComplementarity,
  loadPairProfiles,
  pairGain,
  score,
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

export function CategoryProfileChart({
  pair,
  profiles,
  focal,
  method,
  metric,
  identities,
  stable = false,
}: {
  pair: StudyPair;
  profiles: CategoryProfile[];
  focal: string;
  method: string;
  metric: "bi" | "ece";
  identities: Map<string, ComplementarityConfiguration>;
  stable?: boolean;
}) {
  const direction = oriented(pair, focal);
  const stableFocalGroup = direction.focalIsA ? pair.stability.group_a : pair.stability.group_b;
  const stablePartnerGroup = direction.focalIsA ? pair.stability.group_b : pair.stability.group_a;
  const focalGroup = stable ? stableFocalGroup : direction.focalGroup;
  const partnerGroup = stable ? stablePartnerGroup : direction.partnerGroup;
  const partner = partnerName(pair, focal);
  const rows = [{
    group: "overall",
    focal_train: metric === "ece" ? (direction.focalIsA ? pair.calibration.train_a : pair.calibration.train_b) : direction.focalTrainBi,
    partner_train: metric === "ece" ? (direction.focalIsA ? pair.calibration.train_b : pair.calibration.train_a) : direction.partnerTrainBi,
    focal_test: metric === "ece" ? (direction.focalIsA ? pair.calibration.test_a : pair.calibration.test_b) : direction.focalTestBi,
    partner_test: metric === "ece" ? (direction.focalIsA ? pair.calibration.test_b : pair.calibration.test_a) : direction.partnerTestBi,
    aggregation_test: metric === "ece" ? pair.calibration.methods[method] : pair.methods[method],
    test_support_ok: true,
    stability: null,
  }, ...profiles.map(profile => ({
    group: profile.group,
    focal_train: metric === "ece" ? (direction.focalIsA ? profile.calibration.train_a : profile.calibration.train_b) : (direction.focalIsA ? profile.train_bi_a : profile.train_bi_b),
    partner_train: metric === "ece" ? (direction.focalIsA ? profile.calibration.train_b : profile.calibration.train_a) : (direction.focalIsA ? profile.train_bi_b : profile.train_bi_a),
    focal_test: metric === "ece" ? (direction.focalIsA ? profile.calibration.test_a : profile.calibration.test_b) : (direction.focalIsA ? profile.test_bi_a : profile.test_bi_b),
    partner_test: metric === "ece" ? (direction.focalIsA ? profile.calibration.test_b : profile.calibration.test_a) : (direction.focalIsA ? profile.test_bi_b : profile.test_bi_a),
    aggregation_test: metric === "ece" ? profile.calibration.methods[method] : profile.methods[method],
    test_support_ok: profile.test_support_ok,
    stability: profile.stability,
  }))].sort((first, second) => {
    const priority = (group: string) => group === "overall" ? 0 : group === focalGroup ? 1 : group === partnerGroup ? 2 : 3;
    return priority(first.group) - priority(second.group) || first.group.localeCompare(second.group);
  });
  const values = rows.flatMap(row => [row.focal_train, row.partner_train, row.focal_test, row.partner_test, row.aggregation_test]).filter(isScore);
  const low = metric === "ece" ? 0 : values.length ? Math.floor((Math.min(...values) - 2) / 5) * 5 : 0;
  const high = metric === "ece"
    ? Math.max(.01, (values.length ? Math.max(...values) : 0) * 1.08)
    : values.length ? Math.ceil((Math.max(...values) + 2) / 5) * 5 : 100;
  const input: [number, number] = [low, metric === "ece" ? high : Math.max(low + 5, high)];
  const trainRange: [number, number] = [180, 445], testRange: [number, number] = [585, 850];
  const chartHeight = 73 + rows.length * 64;
  const focalIdentity = identities.get(focal), partnerIdentity = identities.get(partner);

  return <figure className={`focal-category-profile${stable ? " stable-category-profile" : ""}`} data-profile-metric={metric} data-screening={stable ? "stable" : "point-estimate"}>
    <div className="focal-category-title"><div><span><i style={{ background: PURPLE }} />Focal · {identityLabel(focalIdentity, focal)}</span><span><i style={{ background: GOLD }} />Partner · {identityLabel(partnerIdentity, partner)}</span><span><i className="focal-aggregation-key" />Aggregation</span></div><small>{metric === "ece" ? "ECE further left is better" : "BI further right is better"} · same train/test scale</small></div>
    <div className="focal-chart-scroll"><svg viewBox={`0 0 880 ${chartHeight}`} role="img" aria-label={`Category-level training and held-out ${metric === "ece" ? "expected calibration error" : "Brier Index"} for the selected focal model and partner`}>
      <text x={(trainRange[0] + trainRange[1]) / 2} y="20" textAnchor="middle" className="focal-category-heading">TRAIN · identify complementary strengths</text>
      <text x={(testRange[0] + testRange[1]) / 2} y="20" textAnchor="middle" className="focal-category-heading">TEST · evaluate transfer and aggregation</text>
      {[trainRange, testRange].map((range, panel) => <g key={panel}>{ticks(input, 4).map(value => <g key={value}><line className="market-performance-grid" x1={position(value, input, range)} x2={position(value, input, range)} y1="34" y2={chartHeight - 31} /><text className="market-performance-tick" x={position(value, input, range)} y={chartHeight - 12} textAnchor="middle">{value.toFixed(metric === "ece" ? 2 : 0)}</text></g>)}</g>)}
      {rows.map((row, index) => {
        const y = 58 + index * 64;
        const focalEdge = row.group === focalGroup, partnerEdge = row.group === partnerGroup;
        const stableLowerBound = row.stability && (focalEdge || partnerEdge)
          ? direction.focalIsA === focalEdge
            ? row.stability.lcb_for_a_bi
            : row.stability.lcb_for_b_bi
          : null;
        const label = row.group === "overall" ? "Overall" : GROUP_LABELS[row.group] ?? row.group;
        return <g key={row.group}>
          {index === 0 && <rect x="0" y={y - 22} width="875" height="49" rx="4" className="focal-category-overall" />}
          <text x="4" y={y - 3} className={`focal-category-label${index === 0 ? " overall" : ""}`}>{label}</text>
          {(focalEdge || partnerEdge) && <text x="4" y={y + 17} className={focalEdge ? "focal-edge-label" : "partner-edge-label"}>{stable ? `${focalEdge ? "FOCAL" : "PARTNER"} STABLE EDGE · LCB ${score(stableLowerBound, 2, true)}` : focalEdge ? "FOCAL TRAIN EDGE" : "PARTNER TRAIN EDGE"}</text>}
          {([[row.focal_train, row.partner_train, null], [row.focal_test, row.partner_test, row.aggregation_test]] as const).map((valuesForPanel, panel) => {
            const range = panel === 0 ? trainRange : testRange;
            const [focalBi, partnerBi, aggregationBi] = valuesForPanel;
            return <g key={panel}>
              {isScore(focalBi) && isScore(partnerBi) && <line x1={position(focalBi, input, range)} x2={position(partnerBi, input, range)} y1={y} y2={y} className="focal-category-connector" />}
              {isScore(focalBi) && <g><circle cx={position(focalBi, input, range)} cy={y} r="5.5" fill={PURPLE} /><text x={position(focalBi, input, range)} y={y - 11} textAnchor="middle" className="focal-category-value focal-value">{score(focalBi, metric === "ece" ? 3 : 1)}</text></g>}
              {isScore(partnerBi) && <g><circle cx={position(partnerBi, input, range)} cy={y} r="5.5" fill={GOLD} /><text x={position(partnerBi, input, range)} y={y + 20} textAnchor="middle" className="focal-category-value partner-value">{score(partnerBi, metric === "ece" ? 3 : 1)}</text></g>}
              {isScore(aggregationBi) && <path d={`M${position(aggregationBi, input, range)},${y - 7}l-5.5,11h11Z`} fill={SLATE} stroke="white"><title>Aggregation {metric === "ece" ? "ECE" : "BI"}: {score(aggregationBi)}</title></path>}
            </g>;
          })}
        </g>;
      })}
    </svg></div>
    <figcaption>{stable ? <>Stable edges are selected by the lower end of a 90% event-clustered training BI-gap interval. {metric === "ece" ? "ECE uses 10 fixed equal-width bins over [0, 1] on the same targets and does not enter partner selection." : "BI is computed from event-equal Brier scores; test BI remains untouched until evaluation."}</> : metric === "ece" ? "ECE uses 10 fixed equal-width bins over [0, 1] and pooled common targets; lower is better." : "BI gives each event equal weight, with equal target weights inside an event. Categories with fewer than 30 test events remain descriptive."}</figcaption>
  </figure>;
}

export function FocalComplementarityExplorer({
  selectedConfiguration,
  onSelectConfiguration,
}: {
  selectedConfiguration: string | null;
  onSelectConfiguration: (exact: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [activated, setActivated] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [dimension, setDimension] = useState<Dimension>("topic");
  const [abilityGap, setAbilityGap] = useState<AbilityGap>(3);
  const [pairScope, setPairScope] = useState<PairScope>("all");
  const [method, setMethod] = useState("cf_directional");
  const [profileMetric, setProfileMetric] = useState<"bi" | "ece">("bi");
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
  const configurations = useMemo(() => [...(data?.configurations ?? [])].sort((first, second) =>
    first.canonical_model_version.localeCompare(second.canonical_model_version)
      || first.prompt_label.localeCompare(second.prompt_label)
      || first.information_label.localeCompare(second.information_label)), [data]);
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

  return <section ref={sectionRef} className="focal-complementarity-section configuration-pair-section" id="focal-model-complementarity" aria-labelledby="focal-complementarity-heading" aria-busy={loaded.status === "loading"}>
    <div className="section-heading market-performance-heading focal-complementarity-heading">
      <div><p className="eyebrow">SELECTED MODEL · CATEGORY COMPLEMENTARITY</p><h3 id="focal-complementarity-heading">Who complements the selected model?</h3></div>
      <p>{selectedPair && isScore(pairGain(selectedPair, method)) ? `The training-ranked partner changes held-out ${data?.methods.find(item => item.id === method)?.label ?? method} BI by ${score(pairGain(selectedPair, method), 3, true)} relative to the better single model.` : "Fix the exact configuration selected in the first chart and screen similarly skilled partners using training categories."} Test events never select the partner.</p>
    </div>

    {!activated && <div className="configuration-pair-loading" role="status">Complementarity results load when this section enters view.</div>}
    {loaded.status === "loading" && <div className="configuration-pair-loading" role="status">Loading the frozen 313-configuration experiment…</div>}
    {loaded.status === "error" && <div className="configuration-pair-loading" role="alert"><p>{loaded.error}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setAttempt(value => value + 1)}>Retry complementarity results</button></div>}

    {data && <>
      <div className="focal-category-section">
        <div className="section-heading"><div><p className="eyebrow">PAIR PROFILE</p><h4>Where do their category strengths differ?</h4></div><p>Choose an exact focal configuration and a training-ranked partner. Training identifies the complementary pattern; test evaluates transfer and the unchanged aggregation method.</p></div>

        <div className="focal-category-pair-controls">
          <label><span>FOCAL MODEL</span><select aria-label="Selected focal model" value={selectedConfiguration ?? ""} onChange={event => onSelectConfiguration(event.target.value)}><option value="" disabled>Select an exact configuration</option>{configurations.map(configuration => <option value={configuration.exact_configuration} key={configuration.exact_configuration}>{configuration.canonical_model_version} · {configuration.prompt_label} · {configuration.information_label}</option>)}</select><small>Linked to the selected configuration in the first chart.</small></label>
          <label><span>TRAINING-RANKED PARTNER</span><select aria-label="Selected complementary partner" value={selectedPair?.id ?? ""} onChange={event => setSelectedPairId(event.target.value)} disabled={!pairs.length}><option value="" disabled>{pairs.length ? "Select a partner" : "No partner under these controls"}</option>{selectedConfiguration && pairs.map((pair, index) => { const exact = partnerName(pair, selectedConfiguration); const identity = identities.get(exact); return <option value={pair.id} key={pair.id}>{index + 1}. {identityLabel(identity, exact)} · Dtype {score(pair.train_between_norm)}</option>; })}</select><small>Ranked by training D<sub>type</sub>; test values do not choose the partner.</small></label>
        </div>

        <div className="configuration-pair-controls focal-complementarity-controls">
          <div><span>GROUP QUESTIONS BY</span><div className="market-performance-tabs" role="group" aria-label="Selected-model complementarity grouping"><button type="button" className={dimension === "topic" ? "active" : ""} aria-pressed={dimension === "topic"} onClick={() => setDimension("topic")}>Event type</button><button type="button" className={dimension === "source" ? "active" : ""} aria-pressed={dimension === "source"} onClick={() => setDimension("source")}>Source / platform</button></div></div>
          <label><span>TRAIN BI GAP</span><select aria-label="Selected-model train BI gap" value={abilityGap} onChange={event => setAbilityGap(Number(event.target.value) as AbilityGap)}><option value="3">≤ 3 · main</option><option value="5">≤ 5 · wider</option></select></label>
          <label><span>PARTNER SCOPE</span><select aria-label="Selected-model partner scope" value={pairScope} onChange={event => setPairScope(event.target.value as PairScope)}>{data.pair_scopes.map(scope => <option value={scope.id} key={scope.id}>{scope.label}</option>)}</select></label>
          <label><span>AGGREGATION METHOD</span><select aria-label="Selected-model aggregation method" value={method} onChange={event => setMethod(event.target.value)}>{data.methods.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        </div>

        <div className="focal-profile-metric-control"><span>DISPLAY METRIC</span><div className="market-performance-tabs" role="group" aria-label="Category profile metric"><button type="button" className={profileMetric === "bi" ? "active" : ""} aria-pressed={profileMetric === "bi"} onClick={() => setProfileMetric("bi")}>Brier Index ↑</button><button type="button" className={profileMetric === "ece" ? "active" : ""} aria-pressed={profileMetric === "ece"} onClick={() => setProfileMetric("ece")}>ECE ↓</button></div></div>

        {!selectedConfiguration || !focalKnown ? <div className="configuration-pair-empty"><strong>{selectedConfiguration ? "This exact configuration is outside the complementarity release." : "Select a focal model."}</strong><span>Choose an exact configuration above to load its category profile.</span></div> : pairs.length ? <>
          {profileError ? <div className="configuration-pair-loading" role="alert"><p>{profileError}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setProfileAttempt(value => value + 1)}>Retry category profile</button></div> : profiles.length && selectedPair ? <CategoryProfileChart pair={selectedPair} profiles={profiles} focal={selectedConfiguration} method={method} metric={profileMetric} identities={identities} /> : <div className="configuration-pair-loading" role="status">Loading the selected pair’s category profile…</div>}
        </> : <div className="configuration-pair-empty"><strong>No crossed-strength partner under these controls.</strong><span>{allEligible.length ? `${allEligible.length} near-skill partner${allEligible.length === 1 ? " is" : "s are"} available before the crossed-strength requirement. Try the other grouping, widen the BI gap, or change partner scope.` : "Try the other grouping, widen the BI gap, or change partner scope."}</span></div>}
      </div>
    </>}
  </section>;
}
