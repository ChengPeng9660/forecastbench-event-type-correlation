import { useEffect,useRef,useState } from "react";
import { score } from "../lib/complementarity";
import { loadRawPooling,RAW_POOL_PATH,rawDirections,rawGain,rawViewKey,type RawIndex,type RawReference,type RawView } from "../lib/typeSelectionNoCalibration";
import type { TestScope } from "../lib/typeSelection";
import type { AbilityGap,PairScope } from "../types/complementarity";
import "../typeSelectionNoCalibration.css";

type Props={gap:AbilityGap;coverage:number;pairScope:PairScope};
const percent=(v:number|null|undefined)=>v==null?"—":`${(100*v).toFixed(1)}%`;
const tone=(v:number|null)=>v==null||Math.abs(v)<1e-10?"":v>0?"ts-positive":"ts-negative";
const formulas=["q = sigmoid(zₛ + λ(zₒ − zₛ)) · unrestricted λ", "q = sigmoid((1 − λ)zₛ + λzₒ) · 0 ≤ λ ≤ 1", "q = (1 − λ)s + λo · 0 ≤ λ ≤ 1"];

export default function TypeSelectionNoCalibration(props:Props) {
  const [data,setData]=useState<{index:RawIndex;view:RawView}|null>(null);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const [scope,setScope]=useState<TestScope>("all");
  const [reference,setReference]=useState<RawReference>("selection");
  const [method,setMethod]=useState(5);
  const ref=useRef<HTMLElement>(null);
  const key=rawViewKey(props.gap,props.coverage,props.pairScope);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError("");
    loadRawPooling(key,controller.signal).then(v=>{if(!controller.signal.aborted)setData(v);})
      .catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));});
    return ()=>controller.abort();
  },[key,attempt]);
  useEffect(()=>{
    if(data&&new URLSearchParams(location.search).get("cc_section")==="type-selection-no-calibration")ref.current?.scrollIntoView({block:"start"});
  },[data]);
  const row=data?.view.primary.scopes[scope];
  const gain=(m:number)=>row?rawGain(row,m,reference):null;
  const scale=Math.max(1e-8,...[2,3,4,5,6].map(m=>Math.abs(gain(m)??0)));
  const baseline=reference==="selection"?"raw type selection":"the same formula with a duplicate";
  const groupNames=["Both high","Both low","Opposite sides","Other forecasts"];
  return <section id="type-selection-no-calibration" className="tm-experiment nc-experiment" ref={ref} aria-label="Pooling without calibration">
    <p className="cc-eyebrow">NEW / RAW FORECASTS · NO CALIBRATION STEP</p>
    <h3>Does a second raw forecast help?</h3>
    <p className="ts-intro">Use the historical type winner’s original probability s and the other model’s original probability o. Compare all four existing formulas, a normalized product, and three methods that learn only a mixing weight.</p>
    <p className="nc-contract">No fitted calibration curve, intercept or type correction. The original training router remains fixed. Pooling itself can still change calibration.</p>
    {!data||!row?<div className="cc-empty" role={error?"alert":"status"}><p>{error||"Loading the raw pooling experiment…"}</p>{error&&<button className="research-button" onClick={()=>setAttempt(a=>a+1)}>Retry raw pooling results</button>}</div>:<>
      <div className="tm-scope-switch cc-segments" role="group" aria-label="Raw pooling test scope">
        <button aria-pressed={scope==="complementary"} onClick={()=>setScope("complementary")}>Complementary events only</button>
        <button aria-pressed={scope==="all"} onClick={()=>setScope("all")}>All test events</button>
      </div>
      <p className="tm-context" data-testid="nc-context"><b>{row.pairs.toLocaleString()} pairs</b> · {scope==="all"?"All test events":"Complementary events only"} · Train BI gap ≤{data.view.gap} · ≥{data.view.coverage*100}% coverage · {data.view.pair_scope==="all"?"All exact configurations":data.view.pair_scope==="different_model_version"?"Different model versions":"Same prompt + information"}</p>
      {!row.pairs||!row.brier?<p className="cc-empty">No eligible pairs for these training filters.</p>:<>
        <div className="tm-controls"><label>Compare against<select aria-label="Raw pooling comparison baseline" value={reference} onChange={e=>setReference(e.target.value as RawReference)}>
          <option value="selection">Raw type selection · s</option><option value="duplicate">Same-formula duplicate · F(s,s)</option>
        </select></label></div>
        <p className="tm-finding" data-testid="nc-finding"><strong>{[2,3,4,5].filter(m=>(gain(m)??0)>1e-10).length} of the four original formulas improve mean Brier</strong> relative to {baseline} in this scope. The normalized product has a gain of <b className={tone(gain(6))}>{score(gain(6),6,true)}</b>. Positive means better; individual pairs can differ.</p>
        <div className="tm-contribution-chart nc-chart" role="img" aria-label={`Fixed raw pooling gains versus ${baseline}`}>
          <div className="tm-chart-key"><span>Worse ←</span><span>→ Better</span></div>
          {data.index.fixed_methods.map(m=><div className="tm-chart-row" key={m}><div><b>{data.index.method_labels[m]}</b><small>No learned parameters</small></div><div className="tm-bar-track"><i/><span className={(gain(m)??0)>=0?"tm-bar-positive":"tm-bar-negative"} style={{width:`${Math.abs(gain(m)??0)/scale*48}%`,left:`${(gain(m)??0)>=0?50:50-Math.abs(gain(m)??0)/scale*48}%`}}/></div><strong className={tone(gain(m))}>{score(gain(m),6,true)}</strong></div>)}
        </div>
        <p className="cc-caption">The duplicate control replaces o with s, preserving the formula and trained weight. EC, Piecewise and the product can strengthen a duplicated forecast; Simple mean and Log-odds mean preserve it up to numerical clipping.</p>
        <div className="tm-block"><p className="cc-eyebrow">ONE TRAINED WEIGHT / NO CALIBRATION TERMS</p>
          <div className="tm-diagnostics" data-testid="nc-learned">{data.index.learned_methods.map((m,k)=>{
            const directions=rawDirections(data.view,scope,m,reference);
            return <article key={m}><h4>{data.index.method_labels[m]}</h4><p>{formulas[k]}</p><strong className={tone(gain(m))}>{score(gain(m),6,true)}</strong><span>Brier improvement vs {baseline}</span><div>{directions.positive}/{directions.total} positive directions · mean λ = {score(row.weights?.[k],3)}</div></article>;
          })}</div>
          <p className="cc-caption">The uncalibrated joint removes every calibration and type coefficient from the preceding joint model. Its one coefficient uses the same training log loss and fixed regularization. The bounded variant restricts the weight to [0,1]; the probability pool learns its weight from training Brier. z denotes log-odds.</p>
        </div>
        <div className="tm-block"><h4>All methods on identical test events</h4><div className="ts-table-scroll"><table className="nc-results" data-testid="nc-results"><caption>Event-equal Brier · equal pair means · gains against {baseline}</caption><thead><tr><th>Method</th><th>Brier ↓</th><th>Reference Brier</th><th>Gain ↑</th><th>Pair wins</th><th>Positive directions</th><th>ECE ↓</th></tr></thead><tbody>{data.index.method_labels.map((label,m)=>{
          const directions=rawDirections(data.view,scope,m,reference);
          return <tr key={label} className={m===0?"ts-route-row":""}><th scope="row">{label}</th><td>{score(row.brier?.[m],6)}</td><td>{score(reference==="selection"?row.brier?.[0]:row.duplicate_brier?.[m],6)}</td><td className={tone(gain(m))}>{score(gain(m),6,true)}</td><td>{percent(reference==="selection"?row.wins?.[m]:row.duplicate_wins?.[m])}</td><td>{directions.positive}/{directions.total}</td><td>{score(row.ece?.[m],5)}</td></tr>;
        })}</tbody></table></div></div>
        <details className="cc-details"><summary>Inspect agreement groups, fallback events and learned weights</summary>
          <div className="tm-controls"><label>Diagnostic method<select aria-label="Raw pooling diagnostic method" value={method} onChange={e=>setMethod(Number(e.target.value))}>{data.index.method_labels.slice(2).map((label,i)=><option key={label} value={i+2}>{label}</option>)}</select></label></div>
          <div className="ts-table-scroll"><table className="nc-group-table"><thead><tr><th>Raw forecast group</th><th>Scope weight</th><th>Additive gain vs {baseline}</th></tr></thead><tbody>{groupNames.map((name,k)=>{
            const original=reference==="selection"?row.group.loss?.[k][0]:row.group.duplicate_loss?.[k][method];
            const value=original==null||!row.group.loss?null:original-row.group.loss[k][method];
            return <tr key={name}><th scope="row">{name}</th><td>{percent(row.group.mass?.[k])}</td><td className={tone(value)}>{score(value,6,true)}</td></tr>;
          })}</tbody></table></div>
          <p className="cc-caption">Both high means both original forecasts ≥0.7; both low means both ≤0.3. Groups preserve scope weights and sum to the method’s total gain. Fallback events account for {percent(row.fallback_mass)} of scope weight; their overlapping gain contribution is {score(row.fallback_loss&&row.fallback_duplicate_loss?(reference==="selection"?row.fallback_loss[0]:row.fallback_duplicate_loss[method])-row.fallback_loss[method]:null,6,true)}.</p>
          <p className="cc-caption">Unrestricted log-odds weight λ ranges from {score(row.log_weight_min,3)} to {score(row.log_weight_max,3)}. Below 0: {percent(row.weight_bins?.[0])}; in [0,1]: {percent(row.weight_bins?.[1])}; above 1: {percent(row.weight_bins?.[2])}. Mixing weights attach to selected/other roles and are shared across event types within each pair.</p>
        </details>
        <details className="cc-details"><summary>Inspect ten fixed directions</summary><div className="ts-table-scroll"><table className="nc-results"><thead><tr><th>Split / train → test</th><th>Pairs</th>{[2,3,4,5,6,7].map(m=><th key={m}>{data.index.method_labels[m]}</th>)}</tr></thead><tbody>{data.view.directions.map(d=><tr key={`${d.split}-${d.fold}`}><th scope="row">{d.split} · {d.fold===0?"A → B":"B → A"}</th><td>{d.scopes[scope].pairs}</td>{[2,3,4,5,6,7].map(m=><td key={m}>{score(rawGain(d.scopes[scope],m,reference),6,true)}</td>)}</tr>)}</tbody></table></div><p className="cc-caption">Each direction fits only on its own training events. These directions reuse events and models and are not independent replications.</p></details>
      </>}
      <details className="cc-details"><summary>Definitions and interpretation limits</summary><p>Normalized product: q = so / [so + (1−s)(1−o)]. This is a pooling rule; it does not establish independent evidence or a probability of two distinct events occurring together. Log-odds computations clip inputs to [10⁻⁶, 1−10⁻⁶]. Maximum measured baseline Brier change from clipping: {data.index.audit.max_clipping_brier_error.toExponential(2)}.</p><p>These historical holdouts motivated this exploratory follow-up. Positive gains establish performance under the stated rule and controls. Pooling may itself improve calibration, so a no-calibration-step gain does not isolate a unique information mechanism. The separate calibrated comparison below remains relevant.</p><p>{data.index.audit.pair_directions.toLocaleString()} pair directions; {data.index.audit.independent_pairs} independently reconstructed primary pairs. Maximum numerical reconstruction error: {data.index.audit.max_independent_error.toExponential(2)}.</p></details>
      <div className="cc-downloads"><a href={`${RAW_POOL_PATH}REPORT.md`}>Raw pooling report ↗</a><a href={`${RAW_POOL_PATH}PROTOCOL.md`}>Raw pooling protocol ↗</a><a href={`${RAW_POOL_PATH}all-direction-scores.csv.gz`} download>Raw pooling scores ↗</a><a href={`${RAW_POOL_PATH}primary-pair-results.json.gz`} download>Raw pooling pair results ↗</a><a href={`${RAW_POOL_PATH}audit.json`}>Raw pooling audit ↗</a></div>
    </>}
  </section>;
}
