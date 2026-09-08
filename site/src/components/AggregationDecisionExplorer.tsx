import {lazy,Suspense,useEffect,useState} from "react";
import {score} from "../lib/complementarity";
import {mechanismKey,MECHANISM_PATH,brierGain} from "../lib/typeSelectionMechanisms";
import {DISPLAYED_STABILITY_GROUP,DISPLAYED_TEST_SCOPE,decisionSummary,initialDecisionFilters,loadDecisionMechanisms,loadDecisionPools,type DecisionFilters,type PoolMode} from "../lib/aggregationDecision";
import {STABILITY_PATH} from "../lib/aggregationStability";
import {writeDecisionQuery} from "../lib/aggregationDecisionPairs";
import {RAW_POOL_PATH} from "../lib/typeSelectionNoCalibration";
import {CAL_POOL_PATH} from "../lib/typeSelectionCalibratedPooling";
import {TYPEWISE_PATH} from "../lib/typewiseMatchedAggregation";
import {EventTypeJointRow,UNCALIBRATED_METHODS,UncalibratedAggregationRows,UncalibratedJointRow} from "./UncalibratedAggregationRow";
import {PoolingComparisonTable} from "./PoolingComparisonTable";
import "../complementarity.css";
import "../aggregationDecision.css";

const FullExplorer=lazy(()=>import("./ComplementarityExplorer"));
const MultiModelDecision=lazy(()=>import("./MultiModelAggregationExplorer"));
const PairDecision=lazy(()=>import("./AggregationPairDecision"));
const percent=(v:number|null|undefined,digits=1)=>v==null?"—":`${(100*v).toFixed(digits)}%`;
const tone=(v:number|null)=>v==null||Math.abs(v)<1e-10?"":v>0?"ad-positive":"ad-negative";
type MechanismData=Awaited<ReturnType<typeof loadDecisionMechanisms>>;

function PoolingEvidence({data,filters,active}:{data:MechanismData;filters:DecisionFilters;active:boolean}){
  const [pools,setPools]=useState<Awaited<ReturnType<typeof loadDecisionPools>>|null>(null);
  const [mode,setMode]=useState<PoolMode>("raw"),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const key=mechanismKey(filters.gap,filters.coverage,filters.pairScope);
  useEffect(()=>{setPools(null);setError("");if(!active)return;const c=new AbortController();loadDecisionPools(key,c.signal,filters.stability).then(v=>{if(!c.signal.aborted)setPools(v);}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e));});return()=>c.abort();},[key,filters.stability,active,attempt]);
  if(!active)return null;
  if(!pools)return <div className="ad-pending" role={error?"alert":"status"}>{error||"Loading pooling scores…"}{error&&<button className="ad-link-button" onClick={()=>setAttempt(a=>a+1)}>Retry formula comparisons</button>}</div>;
  const row=mode==="raw"?pools.raw.view.primary.scopes[filters.scope]:pools.calibrated.view.primary.stages[mode][filters.scope];
  const main=data.view.primary.scopes[filters.scope];
  if(row.pairs!==main.pairs||row.events!==main.events||row.targets!==main.targets)return <p role="alert">Inconsistent test support.</p>;
  const methodLabels=mode==="raw"?pools.raw.index.method_labels:pools.calibrated.index.method_labels;
  return <div className="ad-detail-body">
    <div className="ad-switch ad-pool-switch" role="group" aria-label="Supporting pooling pipeline">{([['raw','No calibration'],['input','Calibrate models → pool'],['output','Pool → calibrate output']] as const).map(([v,label])=><button key={v} aria-pressed={mode===v} onClick={()=>setMode(v)}>{label}</button>)}</div>
    <PoolingComparisonTable brier={row.brier} methodLabels={methodLabels} testId="ad-pool-table"/>
    <div className="ad-downloads">{filters.stability==="original"?<><a href={`${RAW_POOL_PATH}REPORT.md`}>Raw pooling report ↗</a><a href={`${CAL_POOL_PATH}REPORT.md`}>Calibrated pooling report ↗</a></>:<><a href={`${STABILITY_PATH}REPORT.md`}>Stability study report ↗</a><a href={`${STABILITY_PATH}PROTOCOL.md`}>Post-hoc study protocol ↗</a></>}</div>
  </div>;
}

function Verdict({baseConfiguration,embedded=false}:{baseConfiguration?:string;embedded?:boolean}){
  const [filters,setFilters]=useState<DecisionFilters>(()=>initialDecisionFilters(location.search));
  const [multiMode,setMultiMode]=useState(()=>new URLSearchParams(location.search).get("cc_result")==="multi");
  const [pairMode,setPairMode]=useState(()=>embedded||new URLSearchParams(location.search).get("cc_result")==="pair");
  const [data,setData]=useState<MechanismData|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0),[poolsOpen,setPoolsOpen]=useState(false);
  const key=mechanismKey(filters.gap,filters.coverage,filters.pairScope);
  const cohort=filters.stability??"stable",postHoc=cohort!=="original";
  const selectionLabel=cohort==="fallback"?"Overall selection (train)":cohort==="all"?"Selection policy":"Type-based selection";
  const reportPath=postHoc?STABILITY_PATH:MECHANISM_PATH;
  useEffect(()=>{const c=new AbortController();setData(null);setError("");if(multiMode)return;loadDecisionMechanisms(key,c.signal,cohort).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e));});return()=>c.abort();},[key,cohort,attempt,multiMode]);
  useEffect(()=>{const listener=()=>{writeDecisionQuery({});setFilters(initialDecisionFilters(location.search));setMultiMode(new URLSearchParams(location.search).get("cc_result")==="multi");setPairMode(embedded||new URLSearchParams(location.search).get("cc_result")==="pair");};listener();window.addEventListener("popstate",listener);window.addEventListener("hashchange",listener);return()=>{window.removeEventListener("popstate",listener);window.removeEventListener("hashchange",listener);};},[embedded]);
  function changeResult(next:boolean){setMultiMode(false);setPairMode(next);writeDecisionQuery({cc_result:next?"pair":"overall",cc_section:"aggregation-verdict"});}
  function change(patch:Partial<DecisionFilters>){const next={...filters,...patch,stability:DISPLAYED_STABILITY_GROUP,scope:DISPLAYED_TEST_SCOPE};setFilters(next);writeDecisionQuery({cc_section:"aggregation-verdict",cc_gap:String(next.gap),cc_coverage:String(next.coverage),cc_scope:next.pairScope,cc_test_scope:next.scope,cc_stability:next.stability??"stable"});}
  const summary=data?.view.key===key&&data.cohort===cohort?decisionSummary(data.view,filters.scope):null,row=summary?.row;
  const rawRow=data?.view.key===key&&data.cohort===cohort?data.rawPrimary.scopes[filters.scope]:null;
  const typewiseRow=data?.view.key===key&&data.cohort===cohort?data.typewise?.primary.scopes[filters.scope]??null:null;
  const rawGain=brierGain(rawRow?.brier??null,0,7),rawRelative=rawGain!=null&&rawRow?.brier?.[0]?rawGain/rawRow.brier[0]:null;
  const defined=!!row?.pairs&&!!row.brier&&!!rawRow?.brier;
  return <section id={embedded?"market-type-selection":"complementarity"} className={`cc-study ad-study${embedded?" ad-embedded":""}`} lang="en">
    <header className="ad-header">{embedded?<h2>Selection vs aggregation</h2>:<h1>Selection vs aggregation</h1>}</header>
    <div className="ad-result-switch" role="group" aria-label="Aggregation result level">{!embedded&&<button aria-pressed={!pairMode&&!multiMode} onClick={()=>changeResult(false)}>Overall evidence</button>}<button aria-pressed={pairMode&&!multiMode} onClick={()=>changeResult(true)}>One model pair</button><button aria-pressed={multiMode} onClick={()=>{setMultiMode(true);writeDecisionQuery({cc_result:"multi"});}}>2–4 models</button></div>
    <div className="ad-scope-line"><span data-testid="ad-test-scope-label">Complementary events only</span></div>
    {!multiMode&&<><div className="ad-cohort-line"><div className="ad-cohort-label"><span>Complementary-pair group</span><strong data-testid="ad-cohort-label">No reversals</strong></div></div>
    <details className="ad-filters"><summary><span data-testid="ad-context">{row?`${row.pairs.toLocaleString()} model pairs`:'Study scope'} · Train BI gap ≤{filters.gap} · ≥{filters.coverage*100}% coverage</span><b>Change study scope</b></summary><div className="ad-filter-fields">
      <label>Training ability gap<select aria-label="Verdict training ability gap" value={filters.gap} onChange={e=>change({gap:Number(e.target.value) as DecisionFilters['gap']})}><option value="3">BI gap ≤3</option><option value="5">BI gap ≤5</option></select></label>
      <label>Supported type coverage<select aria-label="Verdict type coverage" value={filters.coverage} onChange={e=>change({coverage:Number(e.target.value)})}>{[.5,.6,.7,.8].map(v=><option key={v} value={v}>At least {v*100}%</option>)}</select></label>
      <label>Model-pair scope<select aria-label="Verdict model-pair scope" value={filters.pairScope} onChange={e=>change({pairScope:e.target.value as DecisionFilters['pairScope']})}><option value="all">All exact configurations</option><option value="different_model_version">Different model versions</option><option value="matched_conditions">Same prompt + information</option></select></label>
    </div></details></>}
    {multiMode?<Suspense fallback={<p className="ad-pending" role="status">Loading model-count explorer…</p>}><MultiModelDecision scope={filters.scope} baseConfiguration={baseConfiguration}/></Suspense>:pairMode?<Suspense fallback={<p className="ad-pending" role="status">Loading pair comparison…</p>}><PairDecision filters={filters} baseConfiguration={baseConfiguration}/></Suspense>:!data||!summary?<div className="ad-pending" role={error?"alert":"status"}>{error||"Loading comparison…"}{error&&<button className="research-button" onClick={()=>setAttempt(a=>a+1)}>Retry aggregation verdict</button>}</div>:!defined?<p className="ad-pending">No eligible pairs.</p>:<>
      <div className="ad-result-strip"><div className={`ad-effect ${tone(rawGain)}`} data-testid="ad-effect"><strong>{percent(rawRelative==null?null:Math.abs(rawRelative),2)}</strong><span>Brier {rawGain!=null&&rawGain<0?"increase":"reduction"} vs {selectionLabel.toLowerCase()} · learned raw rule</span></div><div className="ad-facts" data-testid="ad-facts"><div><strong className={tone(rawGain)}>{score(rawGain,6,true)}</strong><span>Brier gain</span></div><div><strong>4</strong><span>fixed raw rules shown</span></div><div><strong>{score(rawRow!.brier![7],6)}</strong><span>learned raw Brier</span></div></div></div>
      <section className="ad-comparison"><div className="ad-section-heading"><h3>Pipeline comparison</h3><span>{filters.scope==="all"?"All test events":"Complementary events"} · Brier &amp; ECE ↓</span></div><div className="ad-table-scroll"><table className="ad-main-table" data-testid="ad-main-table"><thead><tr><th>Prediction pipeline</th><th>Test Brier ↓</th><th>Test ECE ↓</th></tr></thead><tbody><tr><th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">1</span><b>{selectionLabel}</b></div></th><td>{score(row!.brier![0],6)}</td><td>{score(row!.ece?.[0],6)}</td></tr><UncalibratedAggregationRows brier={row!.brier!} ece={row!.ece} referenceLabel={selectionLabel.toLowerCase()}/><UncalibratedJointRow brier={rawRow!.brier![7]} ece={rawRow!.ece?.[7]} referenceBrier={row!.brier![0]} referenceLabel={selectionLabel.toLowerCase()}/>{typewiseRow?.brier&&typewiseRow.ece&&<EventTypeJointRow brier={typewiseRow.brier[2]} ece={typewiseRow.ece[2]} referenceBrier={typewiseRow.brier[0]} globalBrier={typewiseRow.brier[1]} globalEce={typewiseRow.ece[1]} referenceLabel={selectionLabel.toLowerCase()}/>}</tbody></table></div>{!data.typewise&&<p className="ad-typewise-unavailable" data-testid="ad-event-type-unavailable">The event-type-weight rule is shown for No reversals and Original training-only selection. This cohort changes reversed pairs to an overall fallback, so its selected/other roles do not match the current event-type experiment.</p>}</section>
      <div className="ad-supporting">
        {data.typewise&&<details className="ad-disclosure"><summary>Event-type aggregation evidence</summary><div className="ad-detail-body"><p><b>One training coefficient per supported event type.</b> Types with at least 30 training events receive their own λ; sparse or unseen types share a pooled fallback. No intercept, calibration slope, probability offset, or test-fitted coefficient is used.</p><div className="ad-table-scroll"><table className="ad-direction-table ad-typewise-table" data-testid="ad-event-type-directions"><thead><tr><th>Split / train → test</th><th>Pairs</th><th>Brier gain vs selection</th><th>ECE gain vs selection</th><th>Brier gain vs global λ</th><th>ECE gain vs global λ</th></tr></thead><tbody>{data.typewise.directions.map(direction=>{const r=direction.scopes[filters.scope];return <tr key={`${direction.split}-${direction.fold}`}><th scope="row">{direction.split} · {direction.fold===0?"A → B":"B → A"}</th><td>{r.pairs.toLocaleString()}</td><td className={tone(r.brier?r.brier[0]-r.brier[2]:null)}>{score(r.brier?r.brier[0]-r.brier[2]:null,6,true)}</td><td className={tone(r.ece?r.ece[0]-r.ece[2]:null)}>{score(r.ece?r.ece[0]-r.ece[2]:null,6,true)}</td><td className={tone(r.brier?r.brier[1]-r.brier[2]:null)}>{score(r.brier?r.brier[1]-r.brier[2]:null,6,true)}</td><td className={tone(r.ece?r.ece[1]-r.ece[2]:null)}>{score(r.ece?r.ece[1]-r.ece[2]:null,6,true)}</td></tr>;})}</tbody></table></div><p>Positive gain means the event-type rule has the lower error. The ten directions share events and models and are stability checks, not independent replications.{postHoc&&" No-reversal membership is a post-hoc, test-defined diagnostic; coefficients remain training-only."}</p><div className="ad-downloads"><a href={`${TYPEWISE_PATH}REPORT.md`}>Event-type report ↗</a><a href={`${TYPEWISE_PATH}PROTOCOL.md`}>Event-type protocol ↗</a><a href={`${TYPEWISE_PATH}coefficient-summary.json`}>Coefficient summary ↗</a><a href={`${TYPEWISE_PATH}audit.json`}>Numerical audit ↗</a></div></div></details>}
        <details className="ad-disclosure" onToggle={e=>setPoolsOpen(e.currentTarget.open)}><summary>Pooling methods</summary><PoolingEvidence data={data} filters={filters} active={poolsOpen}/></details>
        <details className="ad-disclosure"><summary>ECE & downloads</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-ece-table"><thead><tr><th>Pipeline</th><th>ECE ↓</th></tr></thead><tbody><tr><th scope="row">{selectionLabel}</th><td>{score(row!.ece?.[0],6)}</td></tr>{UNCALIBRATED_METHODS.map(method=><tr key={method.id} data-testid={`ad-uncalibrated-ece-${method.id}`}><th scope="row">Uncalibrated aggregation · {method.label}</th><td>{score(row!.ece?.[method.index],6)}</td></tr>)}<tr><th scope="row">Matched aggregation · no calibration</th><td>{score(rawRow!.ece?.[7],6)}</td></tr>{typewiseRow?.ece&&<tr data-testid="ad-event-type-ece-summary"><th scope="row">Matched aggregation · event-type weights</th><td>{score(typewiseRow.ece[2],6)}</td></tr>}</tbody></table></div><div className="ad-downloads"><a href={`${reportPath}REPORT.md`}>Matched comparison report ↗</a><a href={`${reportPath}PROTOCOL.md`}>Study protocol ↗</a><a href={`${reportPath}${postHoc?"index.json":"primary-pair-diagnostics.json.gz"}`} download>{postHoc?"Pair index ↗":"Pair results ↗"}</a><a href={`${reportPath}${postHoc?"all-direction-results.jsonl.gz":"all-direction-scores.csv.gz"}`} download>All test directions ↗</a><a href={`${reportPath}audit.json`}>Numerical audit ↗</a></div></div></details>
      </div>
    </>}
  </section>;
}

export function MarketAggregationDecision({baseConfiguration}:{baseConfiguration:string}){
  return <Verdict embedded baseConfiguration={baseConfiguration}/>;
}
export default function AggregationDecisionExplorer(){
  const [explore,setExplore]=useState(()=>new URLSearchParams(location.search).get("cc_view")==="explorer");
  useEffect(()=>{const update=()=>setExplore(new URLSearchParams(location.search).get("cc_view")==="explorer");window.addEventListener("popstate",update);return()=>window.removeEventListener("popstate",update);},[]);
  function change(next:boolean){const q=new URLSearchParams(location.search);if(next)q.set("cc_view","explorer");else{q.delete("cc_view");q.set("cc_section","aggregation-verdict");}history.replaceState(null,"",`${location.pathname}?${q}#complementarity`);setExplore(next);window.scrollTo({top:0});}
  return explore?<><div className="ad-back"><button className="ad-link-button" onClick={()=>change(false)}>← Back to the aggregation verdict</button><span>Full research explorer</span></div><Suspense fallback={<section id="complementarity" className="cc-study ad-pending" role="status">Loading full research explorer…</section>}><FullExplorer/></Suspense></>:<Verdict/>;
}
