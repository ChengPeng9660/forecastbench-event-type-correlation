import {useEffect,useRef,useState} from "react";
import {score} from "../lib/complementarity";
import {CAL_POOL_PATH,loadCalibratedPooling,calibratedGain,calibrationGain,calibratedDirections,type CalIndex,type CalView,type CalibrationStage} from "../lib/typeSelectionCalibratedPooling";
import {rawViewKey,type RawReference} from "../lib/typeSelectionNoCalibration";
import type {TestScope} from "../lib/typeSelection";
import type {AbilityGap,PairScope} from "../types/complementarity";
import "../typeSelectionNoCalibration.css";

const percent=(v:number|null|undefined)=>v==null?"—":`${(100*v).toFixed(1)}%`;
const tone=(v:number|null)=>v==null||Math.abs(v)<1e-10?"":v>0?"ts-positive":"ts-negative";
type Props={gap:AbilityGap;coverage:number;pairScope:PairScope};

export default function TypeSelectionCalibratedPooling(props:Props){
  const [data,setData]=useState<{index:CalIndex;view:CalView}|null>(null);
  const [error,setError]=useState("");const [attempt,setAttempt]=useState(0);
  const [stage,setStage]=useState<CalibrationStage>("input");
  const [scope,setScope]=useState<TestScope>("all");
  const [reference,setReference]=useState<RawReference>("selection");
  const [method,setMethod]=useState(5);
  const ref=useRef<HTMLElement>(null),key=rawViewKey(props.gap,props.coverage,props.pairScope);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError("");
    loadCalibratedPooling(key,controller.signal).then(v=>{if(!controller.signal.aborted)setData(v);}).catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));});
    return ()=>controller.abort();
  },[key,attempt]);
  useEffect(()=>{if(data&&new URLSearchParams(location.search).get("cc_section")==="type-selection-calibrated-pooling")ref.current?.scrollIntoView({block:"start"});},[data]);
  const row=data?.view.primary.stages[stage][scope];
  const gain=(m:number)=>row?calibratedGain(row,m,reference):null;
  const scale=Math.max(1e-8,...[2,3,4,5,6].map(m=>Math.abs(gain(m)??0)));
  const baseline=reference==="selection"?"calibrated type selection":"the same pipeline with a duplicate";
  return <section id="type-selection-calibrated-pooling" className="tm-experiment nc-experiment" ref={ref} aria-label="Pooling with probability calibration">
    <p className="cc-eyebrow">NEW / PROBABILITY CALIBRATION · SAME FROZEN EXPERIMENT</p>
    <h3>Does calibration change the value of a second forecast?</h3>
    <p className="ts-intro">Repeat all four existing formulas, the normalized product and the three learned pools. Calibrate probabilities using training events only, and compare with a calibrated historical type winner.</p>
    {!data||!row?<div className="cc-empty" role={error?"alert":"status"}><p>{error||"Loading calibrated pooling results…"}</p>{error&&<button className="research-button" onClick={()=>setAttempt(a=>a+1)}>Retry calibrated pooling results</button>}</div>:<>
      <div className="tm-scope-switch cc-segments" role="group" aria-label="Calibration location">
        <button aria-pressed={stage==="input"} onClick={()=>setStage("input")}>Calibrate models → pool</button>
        <button aria-pressed={stage==="output"} onClick={()=>setStage("output")}>Pool → calibrate output</button>
      </div>
      <p className="nc-contract" data-testid="cp-contract">{stage==="input"?<>Fit a separate calibration curve to Model A and Model B, then apply the frozen type router and pool their calibrated probabilities. Baseline: the selected model’s calibrated forecast. Learned pools refit their one mixing weight on these calibrated training inputs.</>:<>Pool the original probabilities, then fit a separate calibration curve to each method’s output. Baseline: a separately calibrated type-selection output. Original mixing weights remain frozen. This version uses a different calibrated-selection baseline from input calibration.</>}</p>
      <div className="tm-scope-switch cc-segments" role="group" aria-label="Calibrated pooling test scope">
        <button aria-pressed={scope==="complementary"} onClick={()=>setScope("complementary")}>Complementary events only</button>
        <button aria-pressed={scope==="all"} onClick={()=>setScope("all")}>All test events</button>
      </div>
      <p className="tm-context" data-testid="cp-context"><b>{row.pairs.toLocaleString()} pairs</b> · {stage==="input"?"Input calibration":"Output calibration"} · {scope==="all"?"All test events":"Complementary events only"} · Train BI gap ≤{data.view.gap} · ≥{data.view.coverage*100}% coverage · {data.view.pair_scope==="all"?"All exact configurations":data.view.pair_scope==="different_model_version"?"Different model versions":"Same prompt + information"}</p>
      {!row.pairs||!row.brier?<p className="cc-empty">No eligible pairs for these training filters.</p>:<>
        <div className="tm-diagnostics" data-testid="cp-baselines">
          <article><h4>Raw type selection</h4><strong>{score(row.raw_brier?.[0],6)}</strong><span>Original Brier · unchanged test support</span></article>
          <article><h4>{stage==="input"?"Selected calibrated model":"Calibrated selection output"}</h4><strong>{score(row.brier[0],6)}</strong><span>This version’s single-model baseline</span></article>
          <article><h4>Selection’s calibration gain</h4><strong className={tone(calibrationGain(row,0))}>{score(calibrationGain(row,0),6,true)}</strong><span>Raw selection Brier − calibrated selection Brier</span></article>
        </div>
        <div className="tm-controls"><label>Compare pooling against<select aria-label="Calibrated pooling comparison baseline" value={reference} onChange={e=>setReference(e.target.value as RawReference)}>
          <option value="selection">Calibrated type selection</option><option value="duplicate">Same-pipeline duplicate</option>
        </select></label></div>
        <p className="tm-finding" data-testid="cp-finding"><strong>{[2,3,4,5].filter(m=>(gain(m)??0)>1e-10).length} of the four original formulas improve mean Brier</strong> relative to {baseline}. Normalized product gain: <b className={tone(gain(6))}>{score(gain(6),6,true)}</b>. Positive means better.</p>
        <div className="tm-contribution-chart nc-chart" role="img" aria-label={`Calibrated fixed pooling gains versus ${baseline}`}>
          <div className="tm-chart-key"><span>Worse ←</span><span>→ Better</span></div>
          {data.index.fixed_methods.map(m=><div className="tm-chart-row" key={m}><div><b>{data.index.method_labels[m]}</b><small>{stage==="input"?"Calibrated model inputs":"Calibrated pooled output"}</small></div><div className="tm-bar-track"><i/><span className={(gain(m)??0)>=0?"tm-bar-positive":"tm-bar-negative"} style={{width:`${Math.abs(gain(m)??0)/scale*48}%`,left:`${(gain(m)??0)>=0?50:50-Math.abs(gain(m)??0)/scale*48}%`}}/></div><strong className={tone(gain(m))}>{score(gain(m),6,true)}</strong></div>)}
        </div>
        <p className="cc-caption">{stage==="input"?"Duplicate control: F(s_c,s_c), using the same calibrated selected forecast twice. All calibration coefficients and mixing weights stay fixed.":"Duplicate control: C_m(F(s,s)). Keep the exact calibrator fitted on the real two-model training output, then replace the other forecast with the selected forecast. This is a substitution diagnostic; the duplicate pipeline is not refitted."}</p>
        <div className="tm-block"><p className="cc-eyebrow">THREE LEARNED POOLS / SAME CALIBRATION LOCATION</p><div className="tm-diagnostics" data-testid="cp-learned">{data.index.learned_methods.map((m,k)=>{
          const d=calibratedDirections(data.view,stage,scope,m,reference);
          return <article key={m}><h4>{data.index.method_labels[m]}</h4><strong className={tone(gain(m))}>{score(gain(m),6,true)}</strong><span>Brier improvement vs {baseline}</span><div>{d.positive}/{d.total} positive directions · mean λ = {score(row.weights?.[k],3)}</div></article>;
        })}</div></div>
        <div className="tm-block"><h4>Separate calibration gains from pooling gains</h4><div className="ts-table-scroll"><table className="nc-results" data-testid="cp-results"><caption>{stage==="input"?"Input":"Output"} calibration · event-equal Brier · equal pair means · pooling reference: {baseline}</caption><thead><tr><th>Method</th><th>Raw Brier ↓</th><th>Calibrated Brier ↓</th><th>Calibration gain ↑</th><th>Pooling gain ↑</th><th>Pair wins vs reference</th><th>Positive directions</th><th>Raw ECE ↓</th><th>Calibrated ECE ↓</th></tr></thead><tbody>{data.index.method_labels.map((label,m)=>{
          const d=calibratedDirections(data.view,stage,scope,m,reference);
          return <tr key={label} className={m===0?"ts-route-row":""}><th scope="row">{label}</th><td>{score(row.raw_brier?.[m],6)}</td><td>{score(row.brier?.[m],6)}</td><td className={tone(calibrationGain(row,m))}>{score(calibrationGain(row,m),6,true)}</td><td className={tone(gain(m))}>{score(gain(m),6,true)}</td><td>{percent(reference==="selection"?row.wins?.[m]:row.duplicate_wins?.[m])}</td><td>{d.positive}/{d.total}</td><td>{score(row.raw_ece?.[m],5)}</td><td>{score(row.ece?.[m],5)}</td></tr>;
        })}</tbody></table></div><p className="cc-caption">Calibration gain compares each complete method with its own raw version. Pooling gain compares with the selected reference after calibration. ECE uses ten equal-width bins and target weights within each pair. Calibration fits training log loss, so held-out Brier and ECE need not both improve.</p></div>
        <details className="cc-details"><summary>Inspect calibrated gains by original forecast group</summary><div className="tm-controls"><label>Diagnostic method<select aria-label="Calibrated pooling diagnostic method" value={method} onChange={e=>setMethod(Number(e.target.value))}>{data.index.method_labels.slice(2).map((label,k)=><option key={label} value={k+2}>{label}</option>)}</select></label></div><div className="ts-table-scroll"><table className="nc-group-table"><thead><tr><th>Original forecast group</th><th>Scope weight</th><th>Additive gain vs {baseline}</th></tr></thead><tbody>{["Both high","Both low","Opposite sides","Other forecasts"].map((label,k)=>{
          const base=reference==="selection"?row.group.loss?.[k][0]:row.group.duplicate_loss?.[k][method];
          const value=base==null||!row.group.loss?null:base-row.group.loss[k][method];
          return <tr key={label}><th scope="row">{label}</th><td>{percent(row.group.mass?.[k])}</td><td className={tone(value)}>{score(value,6,true)}</td></tr>;
        })}</tbody></table></div><p className="cc-caption">Groups use original forecasts: both high ≥0.7, both low ≤0.3, opposite sides of 0.5, and other forecasts. Contributions keep the original scope weights and sum to total gain. Fallback events carry {percent(row.fallback_mass)} of scope weight; their overlapping gain contribution is {score(row.fallback_loss&&row.fallback_duplicate_loss?(reference==="selection"?row.fallback_loss[0]:row.fallback_duplicate_loss[method])-row.fallback_loss[method]:null,6,true)}.</p><p>Unrestricted λ range: {score(row.log_weight_min,3)} to {score(row.log_weight_max,3)}; negative weights: {percent(row.weight_bins?.[0])}. Coefficients for both model calibrators and all ten output calibrators are retained in the pair download.</p></details>
        <details className="cc-details"><summary>Inspect ten calibrated test directions</summary><div className="ts-table-scroll"><table className="nc-results"><thead><tr><th>Split / train → test</th><th>Pairs</th>{[2,3,4,5,6,7,8,9].map(m=><th key={m}>{data.index.method_labels[m]}</th>)}</tr></thead><tbody>{data.view.directions.map(d=><tr key={`${d.split}-${d.fold}`}><th scope="row">{d.split} · {d.fold===0?"A → B":"B → A"}</th><td>{d.stages[stage][scope].pairs}</td>{[2,3,4,5,6,7,8,9].map(m=><td key={m}>{score(calibratedGain(d.stages[stage][scope],m,reference),6,true)}</td>)}</tr>)}</tbody></table></div><p className="cc-caption">Each direction refits the complete pipeline only on its training events. These directions share events and models and are not independent replications.</p></details>
      </>}
      <details className="cc-details"><summary>Calibration formula, frozen controls and interpretation</summary>
        <p>C(p) = sigmoid(z + a + b·z/4), where z = logit(clip(p,10⁻⁶,1−10⁻⁶)). Fit a and b using event-weighted training log loss plus 0.005·(0.1a²+b²)/2. No type features or splines enter the calibrator. Coefficients are pair-specific.</p>
        <p>The raw-training type router, pair filters, fallback, complementary types and outer test events remain unchanged. Multiple fitted stages reuse the outer training sample; no inner cross-fitting is claimed. The final test evaluates each frozen complete pipeline.</p>
        <p>Calibration and adding a forecast can both affect predictive accuracy. A positive pooling gain shows usefulness under that pipeline and comparator. It does not establish independent internal evidence. Normalized product remains a pooling heuristic. These historical test results motivated the follow-up, so this is exploratory.</p>
        <p>{data.index.audit.calibrator_fits.toLocaleString()} calibrator fits across {data.index.audit.pair_directions.toLocaleString()} pair directions; {data.index.audit.independent_pairs} primary pairs independently reconstructed. Maximum reconstruction error: {data.index.audit.max_independent_error.toExponential(2)}. Nonpositive fitted slopes: {data.index.audit.input_nonpositive_slopes} input and {data.index.audit.output_nonpositive_slopes} output calibrators.</p>
      </details>
      <div className="cc-downloads"><a href={`${CAL_POOL_PATH}REPORT.md`}>Calibrated pooling report ↗</a><a href={`${CAL_POOL_PATH}PROTOCOL.md`}>Calibrated pooling protocol ↗</a><a href={`${CAL_POOL_PATH}all-direction-scores.csv.gz`} download>Calibrated pooling scores ↗</a><a href={`${CAL_POOL_PATH}primary-pair-results.json.gz`} download>Calibrated pair coefficients and results ↗</a><a href={`${CAL_POOL_PATH}audit.json`}>Calibrated pooling audit ↗</a></div>
    </>}
  </section>;
}
