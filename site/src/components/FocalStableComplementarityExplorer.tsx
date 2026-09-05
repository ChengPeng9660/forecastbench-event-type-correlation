import { useEffect, useMemo, useRef, useState } from "react";
import {
  eligiblePairs,
  isScore,
  loadComplementarity,
  loadPairProfiles,
  pairGain,
  score,
  stablePairs,
} from "../lib/complementarity";
import type {
  AbilityGap,
  CategoryProfile,
  ComplementarityConfiguration,
  ComplementarityData,
  Dimension,
  PairScope,
  StabilityRule,
  StudyPair,
} from "../types/complementarity";
import { CategoryProfileChart } from "./FocalComplementarityExplorer";
import "../focalComplementarity.css";

type Loaded =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: ComplementarityData };

function partnerName(pair: StudyPair, focal: string) {
  return pair.model_a === focal ? pair.model_b : pair.model_a;
}

function identityLabel(identity: ComplementarityConfiguration | undefined, exact: string) {
  return identity?.canonical_model_version ?? exact.replace(/ \([^)]*\)$/, "");
}

export function FocalStableComplementarityExplorer({
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
  const [rule, setRule] = useState<StabilityRule>("main");
  const [profileMetric, setProfileMetric] = useState<"bi" | "ece">("bi");
  const [selectedPairId, setSelectedPairId] = useState("");
  const [profiles, setProfiles] = useState<CategoryProfile[]>([]);
  const [profileError, setProfileError] = useState("");
  const [profileAttempt, setProfileAttempt] = useState(0);

  useEffect(() => {
    setSelectedPairId("");
  }, [selectedConfiguration, dimension, abilityGap, pairScope, rule]);

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
      if (!controller.signal.aborted) setLoaded({ status: "error", error: reason instanceof Error ? reason.message : "Unable to load stable complementarity results." });
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
  const nearSkillPartners = useMemo(() => !data || !selectedConfiguration ? [] : eligiblePairs(
    data, dimension, .5, "eligible", abilityGap, pairScope,
  )
    .filter(pair => pair.model_a === selectedConfiguration || pair.model_b === selectedConfiguration), [data, selectedConfiguration, dimension, abilityGap, pairScope]);
  const pairs = useMemo(() => !data || !selectedConfiguration ? [] : stablePairs(data, dimension, abilityGap, pairScope, rule)
    .filter(pair => pair.model_a === selectedConfiguration || pair.model_b === selectedConfiguration)
    .filter(pair => isScore(pair.stability.score_bi) && isScore(pairGain(pair, method)) && isScore(pair.calibration.methods[method]))
    .sort((first, second) => (second.stability.score_bi ?? -Infinity) - (first.stability.score_bi ?? -Infinity)
      || partnerName(first, selectedConfiguration).localeCompare(partnerName(second, selectedConfiguration))), [data, selectedConfiguration, dimension, abilityGap, pairScope, rule, method]);
  const selectedPair = pairs.find(pair => pair.id === selectedPairId) ?? pairs[0];

  useEffect(() => {
    const controller = new AbortController();
    setProfiles([]); setProfileError("");
    if (selectedPair) loadPairProfiles(selectedPair, controller.signal).then(result => {
      if (!controller.signal.aborted) setProfiles(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setProfileError(reason instanceof Error ? reason.message : "Unable to load the stable category profile.");
    });
    return () => controller.abort();
  }, [selectedPair?.profile_key, profileAttempt]);

  const partner = selectedPair && selectedConfiguration ? partnerName(selectedPair, selectedConfiguration) : null;
  const aggregationBi = selectedPair ? selectedPair.methods[method] : null;
  const aggregationEce = selectedPair ? selectedPair.calibration.methods[method] : null;
  const bestBi = selectedPair && isScore(selectedPair.test_bi_a) && isScore(selectedPair.test_bi_b) ? Math.max(selectedPair.test_bi_a, selectedPair.test_bi_b) : null;
  const bestEce = selectedPair && isScore(selectedPair.calibration.test_a) && isScore(selectedPair.calibration.test_b) ? Math.min(selectedPair.calibration.test_a, selectedPair.calibration.test_b) : null;

  return <section ref={sectionRef} className="focal-complementarity-section stable-complementarity-section configuration-pair-section" id="stable-category-complementarity" aria-labelledby="stable-complementarity-heading" aria-busy={loaded.status === "loading"}>
    <div className="section-heading market-performance-heading focal-complementarity-heading">
      <div><p className="eyebrow">SELECTED MODEL · STABLE CATEGORY COMPLEMENTARITY</p><h3 id="stable-complementarity-heading">Which category strengths survive uncertainty?</h3></div>
      <p>{selectedPair && isScore(aggregationBi) && isScore(bestBi) ? `${pairs.length} stable partner${pairs.length === 1 ? " survives" : "s survive"}; the selected pair changes held-out BI by ${score(aggregationBi - bestBi, 3, true)} relative to the better single model.` : "Penalize noisy training gaps with event-clustered uncertainty, then inspect held-out BI and ECE."} Partner selection remains training-only.</p>
    </div>

    {!activated && <div className="configuration-pair-loading" role="status">Stable complementarity results load when this section enters view.</div>}
    {loaded.status === "loading" && <div className="configuration-pair-loading" role="status">Loading stable category edges…</div>}
    {loaded.status === "error" && <div className="configuration-pair-loading" role="alert"><p>{loaded.error}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setAttempt(value => value + 1)}>Retry stable results</button></div>}

    {data && <div className="focal-category-section stable-category-section">
      <div className="stable-method-note"><strong>Training-only stability screen.</strong><span>For each category, the BI gap is reduced by 1.645 event-clustered standard errors. A pair survives only when opposite-category advantages remain above the selected margin. Test BI and ECE never choose a partner.</span></div>

      <div className="focal-category-pair-controls">
        <label><span>FOCAL MODEL</span><select aria-label="Stable focal model" value={selectedConfiguration ?? ""} onChange={event => onSelectConfiguration(event.target.value)}><option value="" disabled>Select an exact configuration</option>{configurations.map(configuration => <option value={configuration.exact_configuration} key={configuration.exact_configuration}>{configuration.canonical_model_version} · {configuration.prompt_label} · {configuration.information_label}</option>)}</select><small>Linked to the selected configuration in the first chart.</small></label>
        <label><span>STABILITY-RANKED PARTNER</span><select aria-label="Stable complementary partner" value={selectedPair?.id ?? ""} onChange={event => setSelectedPairId(event.target.value)} disabled={!pairs.length}><option value="" disabled>{pairs.length ? "Select a stable partner" : "No stable partner under these controls"}</option>{selectedConfiguration && pairs.map((pair, index) => { const exact = partnerName(pair, selectedConfiguration); return <option value={pair.id} key={pair.id}>{index + 1}. {identityLabel(identities.get(exact), exact)} · stable edge {score(pair.stability.score_bi, 2, true)} BI</option>; })}</select><small>Ranked by the smaller of the two opposite-category training lower bounds.</small></label>
      </div>

      <div className="configuration-pair-controls focal-complementarity-controls stable-complementarity-controls">
        <div><span>GROUP QUESTIONS BY</span><div className="market-performance-tabs" role="group" aria-label="Stable complementarity grouping"><button type="button" className={dimension === "topic" ? "active" : ""} aria-pressed={dimension === "topic"} onClick={() => setDimension("topic")}>Event type</button><button type="button" className={dimension === "source" ? "active" : ""} aria-pressed={dimension === "source"} onClick={() => setDimension("source")}>Source / platform</button></div></div>
        <label><span>TRAIN BI GAP</span><select aria-label="Stable train BI gap" value={abilityGap} onChange={event => setAbilityGap(Number(event.target.value) as AbilityGap)}><option value="3">≤ 3 · main</option><option value="5">≤ 5 · wider</option></select></label>
        <label><span>STABILITY RULE</span><select aria-label="Stable category rule" value={rule} onChange={event => setRule(event.target.value as StabilityRule)}><option value="main">90% CI lower bound &gt; 0</option><option value="strict">90% CI lower bound &gt; 1 BI</option></select></label>
        <label><span>PARTNER SCOPE</span><select aria-label="Stable partner scope" value={pairScope} onChange={event => setPairScope(event.target.value as PairScope)}>{data.pair_scopes.map(scope => <option value={scope.id} key={scope.id}>{scope.label}</option>)}</select></label>
        <label><span>AGGREGATION METHOD</span><select aria-label="Stable aggregation method" value={method} onChange={event => setMethod(event.target.value)}>{data.methods.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      </div>

      <div className="focal-profile-metric-control stable-profile-metric-control"><span>DISPLAY METRIC</span><div className="market-performance-tabs" role="group" aria-label="Stable category profile metric"><button type="button" className={profileMetric === "bi" ? "active" : ""} aria-pressed={profileMetric === "bi"} onClick={() => setProfileMetric("bi")}>Brier Index ↑</button><button type="button" className={profileMetric === "ece" ? "active" : ""} aria-pressed={profileMetric === "ece"} onClick={() => setProfileMetric("ece")}>ECE ↓</button></div></div>

      {!selectedConfiguration || !focalKnown ? <div className="configuration-pair-empty"><strong>{selectedConfiguration ? "This exact configuration is outside the stable release." : "Select a focal model."}</strong><span>Choose an exact configuration above to load its stable category profile.</span></div> : selectedPair && partner ? <>
        <dl className="stable-pair-summary" aria-label="Selected stable pair summary">
          <div><dt>STABLE PARTNERS</dt><dd>{pairs.length}</dd><small>{nearSkillPartners.length} near-skill candidates</small></div>
          <div><dt>STABLE EDGE</dt><dd>{score(selectedPair.stability.score_bi, 2, true)}</dd><small>BI · 90% training lower bound</small></div>
          <div><dt>{data.methods.find(item => item.id === method)?.label ?? method} BI</dt><dd>{score(aggregationBi, 3)}</dd><small>{isScore(aggregationBi) && isScore(bestBi) ? `${score(aggregationBi - bestBi, 3, true)} vs better single` : "held-out test"}</small></div>
          <div><dt>{data.methods.find(item => item.id === method)?.label ?? method} ECE</dt><dd>{score(aggregationEce, 3)}</dd><small>{isScore(aggregationEce) && isScore(bestEce) ? `${score(bestEce - aggregationEce, 3, true)} improvement vs best single` : "held-out test"}</small></div>
        </dl>
        {profileError ? <div className="configuration-pair-loading" role="alert"><p>{profileError}</p><button type="button" className="market-performance-aggregation-cta" onClick={() => setProfileAttempt(value => value + 1)}>Retry stable profile</button></div> : profiles.length ? <CategoryProfileChart pair={selectedPair} profiles={profiles} focal={selectedConfiguration} method={method} metric={profileMetric} identities={identities} stable /> : <div className="configuration-pair-loading" role="status">Loading the selected stable pair’s category profile…</div>}
      </> : <div className="configuration-pair-empty"><strong>No stable partner under these controls.</strong><span>{nearSkillPartners.length ? `${nearSkillPartners.length} near-skill candidate${nearSkillPartners.length === 1 ? " is" : "s are"} available, but none has two opposite category edges above this training-only uncertainty margin.` : "Try the other grouping, widen the BI gap, or change partner scope."}</span></div>}
    </div>}
  </section>;
}
