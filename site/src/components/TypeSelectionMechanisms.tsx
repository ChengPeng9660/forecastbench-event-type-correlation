import { useEffect, useRef, useState } from "react";
import { score } from "../lib/complementarity";
import { brierGain, groupRows, loadMechanisms, mechanismKey, MECHANISM_PATH, positiveDirections,
  type MechanismIndex, type MechanismView } from "../lib/typeSelectionMechanisms";
import type { AbilityGap, PairScope } from "../types/complementarity";
import type { TestScope } from "../lib/typeSelection";
import "../typeSelectionMechanisms.css";

type Props = { gap: AbilityGap; coverage: number; pairScope: PairScope };
const pc = (value: number | null) => value == null ? "—" : `${(100 * value).toFixed(1)}%`;
const signClass = (value: number | null) => value == null || value === 0 ? "" : value > 0 ? "ts-positive" : "ts-negative";
const COMPARISONS = [
  { label: "Piecewise odds vs selection", before: 0, after: 4 },
  { label: "EC vs selection", before: 0, after: 3 },
  { label: "Log-odds mean vs selection", before: 0, after: 2 },
  { label: "Simple mean vs selection", before: 0, after: 1 },
  { label: "EC vs log-odds mean", before: 2, after: 3 },
  { label: "Extremized vs convex pool", before: 8, after: 9 },
];
const DIAGNOSTICS = [
  { title: "Calibrate the selection", text: "Adjust the selected probability without adding the other forecast.", before: 0, after: 5 },
  { title: "Add the other forecast", text: "A joint model versus the same flexible probability and type controls.", before: 6, after: 7 },
  { title: "Increase pool confidence", text: "Train extremization after fixing the convex pooling weight.", before: 8, after: 9 },
];

function Evidence({ index, view }: { index: MechanismIndex; view: MechanismView }) {
  const [scope, setScope] = useState<TestScope>("all");
  const [cutoff, setCutoff] = useState(1);
  const [comparison, setComparison] = useState(0);
  const r = view.primary.scopes[scope], c = COMPARISONS[comparison];
  const rows = groupRows(r.groups[cutoff], c.before, c.after);
  const scale = Math.max(1e-8, ...rows.map(row => Math.abs(row.gain ?? 0)));
  const total = brierGain(r.brier, c.before, c.after);
  const fallbackGain = brierGain(r.fallback_loss, c.before, c.after);
  const matching = r.matching;
  const chosenScope = scope === "all" ? "All test events" : "Complementary events only";
  return <>
    <div className="tm-scope-switch cc-segments" role="group" aria-label="Mechanism test scope">
      <button aria-pressed={scope === "complementary"} onClick={() => setScope("complementary")}>Complementary events only</button>
      <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All test events</button>
    </div>
    <p className="tm-context" data-testid="tm-context"><b>{r.pairs.toLocaleString()} pairs</b> · {chosenScope} · Train BI gap ≤{view.gap} · ≥{view.coverage * 100}% training coverage · {view.pair_scope === "all" ? "All exact configurations" : view.pair_scope === "different_model_version" ? "Different model versions" : "Same prompt + information"}</p>
    <p className="cc-caption">Cohort evidence for these training filters. Primary metric: event-equal Brier score. Each model is fitted on training data and evaluated unchanged in both test scopes.</p>
    {!r.pairs || !r.brier ? <p className="cc-empty">No eligible pairs for these training filters.</p> : <>
      <p className="tm-finding" data-testid="tm-finding"><strong>Calibration changes the comparison.</strong> Calibrated selection has Brier {score(r.brier[5],6)}, versus {score(r.brier[0],6)} before calibration; it beats {[1,2,3,4].filter(i => r.brier![5] < r.brier![i]-1e-10).length} of the four fixed formulas in this scope. The added-forecast diagnostic below asks whether a second prediction helps beyond flexible single-forecast calibration.</p>
      <div className="tm-diagnostics" data-testid="tm-diagnostics">{DIAGNOSTICS.map((diagnostic, i) => {
        const gain = brierGain(r.brier, diagnostic.before, diagnostic.after);
        const stability = positiveDirections(view, scope, diagnostic.before, diagnostic.after);
        return <article key={diagnostic.title}><p className="cc-eyebrow">0{i + 1} / DIAGNOSTIC</p><h4>{diagnostic.title}</h4><p>{diagnostic.text}</p>
          <strong className={signClass(gain)}>{score(gain, 6, true)}</strong><span>Brier improvement</span>
          <div>{pc(r.wins?.[i] ?? null)} pair wins · {stability.positive}/{stability.total} positive directions</div></article>;
      })}</div>
      <p className="tm-gain-note">Positive = lower Brier after the intervention. These are separate comparisons; their gains do not add up to a causal explanation.</p>

      <div className="tm-block"><div className="tm-block-heading"><p className="cc-eyebrow">01 / WHERE THE GAIN OCCURS</p><h4>Does agreement account for the improvement?</h4></div>
        <div className="tm-controls"><label>Compare<select aria-label="Mechanism gain comparison" value={comparison} onChange={e => setComparison(Number(e.target.value))}>{COMPARISONS.map((value, i) => <option key={value.label} value={i}>{value.label}</option>)}</select></label>
          <label>High / low cutoff<select aria-label="Mechanism confidence cutoff" value={cutoff} onChange={e => setCutoff(Number(e.target.value))}>{index.cutoffs.map((value, i) => <option key={value} value={i}>≥{value.toFixed(1)} / ≤{(1 - value).toFixed(1)}{value === .7 ? " · primary" : " · sensitivity"}</option>)}</select></label></div>
        <div className="tm-contribution-chart" role="img" aria-label={`Additive Brier gain contributions for ${c.label}`}>
          <div className="tm-chart-key"><span>Worse ←</span><span>→ Better</span></div>
          {rows.map(row => <div className="tm-chart-row" key={row.name}><div><b>{row.name}</b><small>{pc(row.mass)} of scope weight</small></div><div className="tm-bar-track"><i /><span className={(row.gain ?? 0) >= 0 ? "tm-bar-positive" : "tm-bar-negative"} style={{ width: `${Math.abs(row.gain ?? 0) / scale * 48}%`, left: `${(row.gain ?? 0) >= 0 ? 50 : 50 - Math.abs(row.gain ?? 0) / scale * 48}%` }} /></div><strong className={signClass(row.gain)}>{score(row.gain, 6, true)}</strong></div>)}
          <div className="tm-chart-total"><span>Total Brier improvement</span><b className={signClass(total)} data-testid="tm-total-gain">{score(total, 6, true)}</b></div>
        </div>
        <p className="cc-caption">Contributions retain the original event weights and sum to the total. Opposite sides means one forecast strictly below 0.5 and the other above; remaining forecasts enter “Other”. Group weights are averaged over all defined pairs.</p>
        <p className="tm-agreement-reading" data-testid="tm-agreement-reading">For this comparison, <b>both-high</b> forecasts contribute <strong className={signClass(rows[0].gain)}>{score(rows[0].gain,6,true)}</strong>; <b>both-low</b> forecasts contribute <strong className={signClass(rows[1].gain)}>{score(rows[1].gain,6,true)}</strong>. Higher agreement does not automatically justify raising the event probability.</p>
        <details className="cc-details"><summary>Compare group probabilities with observed frequencies</summary><div className="ts-table-scroll"><table className="tm-wide-table"><thead><tr><th>Forecast group</th><th>Before: mean p</th><th>After: mean p</th><th>Outcome frequency</th><th>Conditional Brier gain</th></tr></thead><tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{pc(row.before)}</td><td>{pc(row.after)}</td><td>{pc(row.outcome)}</td><td className={signClass(row.conditionalGain)}>{score(row.conditionalGain, 6, true)}</td></tr>)}</tbody></table></div>
          <p className="cc-caption">Before = {index.method_labels[c.before]}; after = {index.method_labels[c.after]}. Frequencies and probabilities use the same event/pair weights. Group-average agreement with frequency is a calibration diagnostic, not proof of independent information.</p></details>
      </div>

      <div className="tm-block"><div className="tm-block-heading"><p className="cc-eyebrow">02 / INCREMENTAL PREDICTIVE INFORMATION</p><h4>Does the other forecast still matter after controlling for type?</h4></div>
        <p>The second diagnostic above compares nested models. Both use the selected probability, a fixed probability spline and event-type controls; the joint model additionally sees the other forecast. Better held-out Brier indicates useful added prediction under this model.</p>
        <div className="tm-match" data-testid="tm-matching"><div><span>Supported matching coverage</span><strong>{matching.pairs.toLocaleString()} / {r.pairs.toLocaleString()} pairs</strong><small>{matching.cells.toLocaleString()} matched type/probability cells</small></div>
          <div><span>Outcome frequency difference</span><strong>{matching.differences ? `${score(100 * matching.differences[0], 2, true)} pp` : "—"}</strong><small>More optimistic other forecast − more pessimistic</small></div>
          <div><span>Residual outcome difference</span><strong>{matching.differences ? `${score(100 * matching.differences[2], 2, true)} pp` : "—"}</strong><small>After subtracting the fitted single-forecast baseline</small></div></div>
        <p className="cc-caption">Matched within each exact pair, event type and selected-probability bin of width 0.1. The other forecast differs from the selected one by at least ±0.1; each side needs ≥5 distinct test events. Only {pc(matching.pairs / r.pairs)} of pairs support this comparison. Selected-probability difference within retained cells: {matching.differences ? `${score(100 * matching.differences[1], 2, true)} pp` : "—"}. This is coarse, descriptive matching.</p>
      </div>

      <div className="tm-block"><div className="tm-block-heading"><p className="cc-eyebrow">03 / CONTROLS AND SELECTION STABILITY</p><h4>Calibration, convex pooling and extremization</h4></div>
        <div className="ts-table-scroll"><table className="tm-score-table" data-testid="tm-score-table"><caption>{chosenScope} · identical support for all ten methods</caption><thead><tr><th>Method</th><th>Brier ↓</th><th>ECE ↓</th><th>Gain vs selection ↑</th></tr></thead><tbody>{index.method_labels.map((label, i) => <tr key={label} className={i === 0 ? "ts-route-row" : ""}><th scope="row">{label}</th><td>{score(r.brier?.[i], 6)}</td><td>{score(r.ece?.[i], 5)}</td><td className={signClass(brierGain(r.brier, 0, i))}>{i ? score(brierGain(r.brier, 0, i), 6, true) : "Reference"}</td></tr>)}</tbody></table></div>
        <p className="cc-caption">The convex pool learns one weight in [0,1] from training Brier. Its extremized version freezes that weight and learns γ from 1 to 2 in steps of 0.05. Mean γ: {score(r.gamma, 3)}; γ &gt;1 for {pc(r.extremized_pairs)} of pairs. Calibrated models learn on training log loss with fixed regularization.</p>
        <div className="tm-stability"><p><span>Training type winner retains test lead</span><strong>{r.routed_mass ? pc((r.retained_mass ?? 0) / r.routed_mass) : "—"}</strong><small>Share of supported routed event weight; test ties count half.</small></p>
          <p><span>Fallback event weight</span><strong>{pc(r.fallback_mass)}</strong><small>Sparse, tied or unknown types use the Overall training winner.</small></p>
          <p><span>Fallback contribution to selected comparison</span><strong className={signClass(fallbackGain)}>{score(fallbackGain, 6, true)}</strong><small>{c.label}. This is part of the total {score(total, 6, true)}{total != null && total > 1e-10 && fallbackGain != null ? ` (${pc(fallbackGain/total)} of net gain)` : ""}. Fallback and confidence groups are overlapping partitions.</small></p></div>
      </div>
      <details className="cc-details"><summary>Compare all ten fixed directions</summary><div className="ts-table-scroll"><table className="tm-wide-table"><thead><tr><th>Split / train → test</th><th>Pairs</th><th>Calibration gain</th><th>Added-forecast gain</th><th>Extremization gain</th><th>Piecewise vs selection</th></tr></thead><tbody>{view.directions.map(d => <tr key={`${d.split}-${d.fold}`}><th scope="row">{d.split} · {d.fold === 0 ? "A → B" : "B → A"}</th><td>{d.scopes[scope].pairs}</td>{[[0,5],[6,7],[8,9],[0,4]].map(([a,b]) => <td key={`${a}-${b}`}>{score(brierGain(d.scopes[scope].brier, a,b),6,true)}</td>)}</tr>)}</tbody></table></div><p className="cc-caption">Each direction refits its own training rules. Shared events and models make these stability views, not independent replications.</p></details>
    </>}
    <details className="cc-details"><summary>What these diagnostics can establish</summary><p>This follow-up was specified after inspecting the preceding historical test results. It provides exploratory evidence about prediction behavior. A nested joint-model improvement does not identify the models’ internal evidence or prove conditional independence. Matching is limited to its supported subset, and the flexible calibration family may still miss structure.</p><p>All confidence cutoffs and fitting settings were fixed before this follow-up. Test outcomes determine scores and descriptive frequencies only. {index.audit.fitted_logistic_models.toLocaleString()} training-fitted logistic models; {index.audit.independent_pairs} independently reconstructed primary pairs; maximum reconstruction difference {index.audit.max_independent_error.toExponential(2)}. Group contribution error: {index.audit.max_additivity_error.toExponential(2)}.</p></details>
    <div className="cc-downloads"><a href={`${MECHANISM_PATH}REPORT.md`}>Mechanism report ↗</a><a href={`${MECHANISM_PATH}PROTOCOL.md`}>Fixed analysis protocol ↗</a><a href={`${MECHANISM_PATH}all-direction-scores.csv.gz`} download>All direction scores ↗</a><a href={`${MECHANISM_PATH}primary-pair-diagnostics.json.gz`} download>Pair diagnostics + fitted coefficients ↗</a><a href={`${MECHANISM_PATH}audit.json`}>Mechanism audit ↗</a></div>
  </>;
}

export default function TypeSelectionMechanisms(props: Props) {
  const [data, setData] = useState<{index: MechanismIndex; view: MechanismView} | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const key = mechanismKey(props.gap, props.coverage, props.pairScope);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    loadMechanisms(key, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(String(reason.message ?? reason)); });
    return () => controller.abort();
  }, [key, attempt]);
  useEffect(() => {
    if (data && new URLSearchParams(location.search).get("cc_section") === "type-selection-mechanisms") ref.current?.scrollIntoView({block:"start"});
  }, [data]);
  return <section id="type-selection-mechanisms" className="tm-experiment" aria-label="Type-selection mechanism analysis" ref={ref}>
    <p className="cc-eyebrow">FOLLOW-UP / EXPLORATORY MECHANISM ANALYSIS</p><h3>Does agreement justify more confidence?</h3>
    <p className="ts-intro">Separate three possibilities: calibrating the chosen model, retaining the other model’s information, and making a combined forecast more confident. Inspect both test scopes before attributing pooling’s advantage to any one explanation.</p>
    {data ? <Evidence index={data.index} view={data.view} /> : <div className="cc-empty" role={error ? "alert" : "status"}><p>{error || "Loading the mechanism comparisons…"}</p>{error && <button className="research-button" onClick={() => setAttempt(a => a + 1)}>Retry mechanism results</button>}</div>}
  </section>;
}
