import {lazy,Suspense,useEffect,useRef,useState} from "react";
import {score} from "../lib/complementarity";
import {loadMechanisms,mechanismKey,MECHANISM_PATH,brierGain,type MechanismIndex,type MechanismView} from "../lib/typeSelectionMechanisms";
import {decisionSummary,gainAgainstStrongSelection,initialDecisionFilters,loadDecisionPools,type DecisionFilters,type PoolMode} from "../lib/aggregationDecision";
import {RAW_POOL_PATH} from "../lib/typeSelectionNoCalibration";
import {CAL_POOL_PATH} from "../lib/typeSelectionCalibratedPooling";
import "../complementarity.css";
import "../aggregationDecision.css";

const FullExplorer=lazy(()=>import("./ComplementarityExplorer"));
const PairDecision=lazy(()=>import("./AggregationPairDecision"));
const percent=(v:number|null|undefined,digits=1)=>v==null?"—":`${(100*v).toFixed(digits)}%`;
const tone=(v:number|null)=>v==null||Math.abs(v)<1e-10?"":v>0?"ad-positive":"ad-negative";
const labels=[
  ["Choose the historical type winner","Use its original probability."],
  ["Calibrate that selected forecast","Add a global probability calibration curve."],
  ["Strengthen the single-forecast baseline","Add event-type adjustments and flexible calibration."],
  ["Add the other model’s forecast","Use the same calibration structure with one extra predictor."],
];
type MechanismData={index:MechanismIndex;view:MechanismView};

function PoolingEvidence({data,filters,active}:{data:MechanismData;filters:DecisionFilters;active:boolean}){
  const [pools,setPools]=useState<Awaited<ReturnType<typeof loadDecisionPools>>|null>(null);
  const [mode,setMode]=useState<PoolMode>("raw"),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const key=mechanismKey(filters.gap,filters.coverage,filters.pairScope);
  useEffect(()=>{
    setPools(null);setError("");if(!active)return;
    const controller=new AbortController();
    loadDecisionPools(key,controller.signal).then(v=>{if(!controller.signal.aborted)setPools(v);}).catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));});
    return ()=>controller.abort();
  },[key,active,attempt]);
  if(!active)return null;
  if(!pools)return <div className="ad-pending" role={error?"alert":"status"}>{error||"Loading the formula comparisons…"}{error&&<button className="ad-link-button" onClick={()=>setAttempt(a=>a+1)}>Retry formula comparisons</button>}</div>;
  const row=mode==="raw"?pools.raw.view.primary.scopes[filters.scope]:pools.calibrated.view.primary.stages[mode][filters.scope];
  const main=data.view.primary.scopes[filters.scope],strong=main.brier?.[6]??null;
  if(row.pairs!==main.pairs||row.events!==main.events||row.targets!==main.targets)return <p role="alert">The formula comparison does not match the selected study scope.</p>;
  const methodLabels=mode==="raw"?pools.raw.index.method_labels:pools.calibrated.index.method_labels;
  const count=[2,3,4,5,6,7,8,9].filter(m=>(gainAgainstStrongSelection(row,m,strong)??0)>1e-10).length;
  return <div className="ad-detail-body">
    <div className="ad-switch ad-pool-switch" role="group" aria-label="Supporting pooling pipeline">{([['raw','No calibration'],['input','Calibrate models → pool'],['output','Pool → calibrate output']] as const).map(([v,label])=><button key={v} aria-pressed={mode===v} onClick={()=>setMode(v)}>{label}</button>)}</div>
    <p className="ad-detail-copy">{mode==="raw"?"Pool the original probabilities. Learned methods fit only a mixing weight.":mode==="input"?"Calibrate each exact model separately, then pool. Learned methods refit their mixing weight on calibrated training inputs.":"Pool the original probabilities, then separately calibrate each method’s final output."} These pipelines use simpler calibration than the matched joint comparison above.</p>
    <p className="ad-pool-finding" data-testid="ad-pool-finding"><b>{count}/8 pooling methods</b> beat the strong single-forecast baseline in this scope. Beating a simpler selection baseline does not establish an advantage over the stronger one.</p>
    <div className="ad-table-scroll"><table className="ad-pool-table" data-testid="ad-pool-table"><caption>Positive gain means lower Brier. Same test events and equal pair weights.</caption><thead><tr><th>Method</th><th>Brier ↓</th><th>Gain vs this pipeline’s selection</th><th>Gain vs strong single baseline</th></tr></thead><tbody>{[2,3,4,5,6,7,8,9].map(m=>{
      const own=row.brier?row.brier[0]-row.brier[m]:null,matched=gainAgainstStrongSelection(row,m,strong);
      return <tr key={m}><th scope="row">{methodLabels[m]}</th><td>{score(row.brier?.[m],6)}</td><td className={tone(own)}>{score(own,6,true)}</td><td className={tone(matched)}>{score(matched,6,true)}</td></tr>;
    })}</tbody></table></div>
    <p className="ad-footnote">This pipeline’s selection Brier: {score(row.brier?.[0],6)}. Strong single-forecast Brier: {score(strong,6)}. The second comparison contrasts complete pipelines; the matched joint experiment above isolates adding a predictor within the same calibration family.</p>
    <div className="ad-downloads"><a href={`${RAW_POOL_PATH}REPORT.md`}>Raw pooling report ↗</a><a href={`${CAL_POOL_PATH}REPORT.md`}>Calibrated pooling report ↗</a></div>
  </div>;
}

function Verdict({onExplore}:{onExplore:()=>void}){
  const [filters,setFilters]=useState<DecisionFilters>(()=>initialDecisionFilters(location.search));
  const [pairMode,setPairMode]=useState(()=>new URLSearchParams(location.search).get("cc_result")==="pair");
  const [data,setData]=useState<MechanismData|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const [poolsOpen,setPoolsOpen]=useState(false);
  const key=mechanismKey(filters.gap,filters.coverage,filters.pairScope),ref=useRef<HTMLElement>(null);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError("");
    loadMechanisms(key,controller.signal).then(v=>{if(!controller.signal.aborted)setData(v);}).catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));});
    return ()=>controller.abort();
  },[key,attempt]);
  useEffect(()=>{const listener=()=>{setFilters(initialDecisionFilters(location.search));setPairMode(new URLSearchParams(location.search).get("cc_result")==="pair");};window.addEventListener("popstate",listener);return()=>window.removeEventListener("popstate",listener);},[]);
  function changeResult(next:boolean){setPairMode(next);const q=new URLSearchParams(location.search);q.set("cc_result",next?"pair":"overall");q.set("cc_section","aggregation-verdict");history.replaceState(null,"",`${location.pathname}?${q}#complementarity`);}
  function change(patch:Partial<DecisionFilters>){
    const next={...filters,...patch};setFilters(next);
    const q=new URLSearchParams(location.search);q.set("cc_section","aggregation-verdict");q.set("cc_gap",String(next.gap));q.set("cc_coverage",String(next.coverage));q.set("cc_scope",next.pairScope);q.set("cc_test_scope",next.scope);
    history.replaceState(null,"",`${location.pathname}?${q}#complementarity`);
  }
  const summary=data?.view.key===key?decisionSummary(data.view,filters.scope):null;
  const row=summary?.row,defined=!!row?.pairs&&!!row.brier;
  const verdict=summary?.gain!=null&&summary.gain>1e-10?"Aggregation adds a modest, consistent gain.":"This scope does not show an average gain from aggregation.";
  const filterControls=(<details className="ad-filters"><summary><span data-testid="ad-context">{row?`${row.pairs.toLocaleString()} model pairs`:'Study scope'} · Train BI gap ≤{filters.gap} · ≥{filters.coverage*100}% coverage · {filters.pairScope==="all"?"All exact configurations":filters.pairScope==="different_model_version"?"Different model versions":"Same prompt + information"}</span><b>Change study scope</b></summary><div className="ad-filter-fields">
      <label>Training ability gap<select aria-label="Verdict training ability gap" value={filters.gap} onChange={e=>change({gap:Number(e.target.value) as DecisionFilters['gap']})}><option value="3">BI gap ≤3</option><option value="5">BI gap ≤5</option></select></label>
      <label>Supported type coverage<select aria-label="Verdict type coverage" value={filters.coverage} onChange={e=>change({coverage:Number(e.target.value)})}>{[.5,.6,.7,.8].map(v=><option key={v} value={v}>At least {v*100}%</option>)}</select></label>
      <label>Model-pair scope<select aria-label="Verdict model-pair scope" value={filters.pairScope} onChange={e=>change({pairScope:e.target.value as DecisionFilters['pairScope']})}><option value="all">All exact configurations</option><option value="different_model_version">Different model versions</option><option value="matched_conditions">Same prompt + information</option></select></label>
    </div><p>Pairs have similar Overall training ability and crossed event-type strengths. Eligibility and type routing use training events only. This verdict is about this screened cohort, not every possible model pair.</p></details>);
  return <section id="complementarity" className="cc-study ad-study" lang="en" ref={ref}>
    <header className="ad-header"><p className="ad-eyebrow">FORECASTBENCH / TYPE SELECTION VS AGGREGATION</p><h1>Is aggregation worth adding?</h1><p>When history tells us which model is better for each event type, does a second forecast still help?</p></header>
    <div className="ad-result-switch" role="group" aria-label="Aggregation result level"><button aria-pressed={!pairMode} onClick={()=>changeResult(false)}>Overall evidence</button><button aria-pressed={pairMode} onClick={()=>changeResult(true)}>One model pair</button></div>
    <div className="ad-scope-line"><div className="ad-switch" role="group" aria-label="Aggregation verdict test scope"><button aria-pressed={filters.scope==="all"} onClick={()=>change({scope:"all"})}>All test events</button><button aria-pressed={filters.scope==="complementary"} onClick={()=>change({scope:"complementary"})}>Complementary events only</button></div><span>{filters.scope==="all"?"Every shared test event, including fallback cases.":"Only event types with a supported training advantage."}</span></div>

    {pairMode?<>{filterControls}<Suspense fallback={<p className="ad-pending" role="status">Loading pair comparison…</p>}><PairDecision filters={filters}/></Suspense></>:<>
    {!data||!summary?<div className="ad-pending" role={error?"alert":"status"}><p>{error||"Loading the matched selection and aggregation comparison…"}</p>{error&&<button className="research-button" onClick={()=>setAttempt(a=>a+1)}>Retry aggregation verdict</button>}</div>:!defined?<p className="ad-pending">No eligible pairs for these training filters. No conclusion is substituted from another cohort.</p>:<>
      <section className="ad-verdict" aria-labelledby="ad-verdict-title"><div><p className="ad-eyebrow">THE MATCHED COMPARISON</p><h2 id="ad-verdict-title" data-testid="ad-verdict-title">{verdict}</h2><p>{(summary.gain??0)>1e-10?"Even after giving the selected forecast event-type adjustments and flexible calibration, adding the other forecast improves mean test Brier in this study.":"With event-type adjustments and flexible calibration in both pipelines, the added forecast does not lower mean test Brier in this scope."}</p><p className="ad-verdict-limit">Whether an extra model call is worth its cost remains untested.</p></div><div className={`ad-effect ${tone(summary.gain)}`} data-testid="ad-effect"><strong>{percent(summary.relative,2)}</strong><span>relative Brier reduction</span><small>vs the strong single-forecast baseline</small></div></section>
      <div className="ad-facts" data-testid="ad-facts"><div><strong>{score(summary.gain,6,true)}</strong><span>absolute Brier improvement</span></div><div><strong>{percent(summary.pairWins)}</strong><span>of model pairs improve</span></div><div><strong>{summary.directions.positive}/{summary.directions.total}</strong><span>fixed directions improve</span></div></div>
    </>}
    {filterControls}
    {data&&summary&&defined&&<>
      <section className="ad-comparison" aria-labelledby="ad-comparison-title"><div className="ad-section-heading"><div><p className="ad-eyebrow">FIRST STRENGTHEN THE SINGLE FORECAST</p><h2 id="ad-comparison-title">How much does aggregation add?</h2></div><span>Brier score ↓ · {filters.scope==="all"?"All test events":"Complementary events"}</span></div>
        <div className="ad-table-scroll"><table className="ad-main-table" data-testid="ad-main-table"><caption>Same models, type router and test events. Only the prediction pipeline changes.</caption><thead><tr><th>Prediction pipeline</th><th>Forecasts used per event</th><th>Test Brier ↓</th></tr></thead><tbody>{summary.rows.map((r,k)=><tr key={r.method} className={k===2?"ad-single-row":k===3?"ad-joint-row":""}><th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">{k+1}</span><div><b>{labels[k][0]}</b><small>{labels[k][1]}</small>{k===2&&<em>Strong single-forecast baseline</em>}{k===3&&<em>Matched aggregation</em>}</div></div></th><td>{k===3?"2 forecasts":"1 selected forecast"}</td><td>{score(r.brier,6)}</td></tr>)}</tbody></table></div>
        <p className="ad-comparison-note">The key comparison is <b>row 3 → row 4</b>: {score(row?.brier?.[6],6)} → {score(row?.brier?.[7],6)}. Improving the selected forecast alone already lowers Brier by {score(summary.singleImprovement,6)} relative to raw routing. The extra aggregation gain is {score(summary.gain,6)}.</p>
        <p className="ad-footnote">Both matched pipelines refit on training events with the same calibration family and regularization. Row 4 adds the other forecast as a predictor. “1 selected forecast” can come from different models across event types. This comparison is not a causal decomposition.</p>
      </section>
      <section className="ad-reading" aria-label="How to use this result"><div><h3>If both forecasts are already available</h3><p>The matched aggregator extracts additional predictive value. Historical type selection alone leaves some of that value unused.</p></div><div><h3>If a second forecast requires another call</h3><p>The measured improvement is modest. Cost, latency and decision value need to justify obtaining that second forecast.</p></div></section>
      <p className="ad-evidence-limit">Exploratory historical holdouts · Training and test events are disjoint. Repeated directions share events and models; they are not independent replications. These results do not show that every aggregation formula helps.</p>
      <div className="ad-supporting"><p className="ad-eyebrow">SUPPORTING EVIDENCE / OPEN ONLY WHAT YOU NEED</p>
        <details className="ad-disclosure" onToggle={e=>setPoolsOpen(e.currentTarget.open)}><summary>Do the original pooling methods tell the same story?</summary><PoolingEvidence data={data} filters={filters} active={poolsOpen}/></details>
        <details className="ad-disclosure"><summary>How stable is the gain across test directions?</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-direction-table"><caption>Strong single-forecast baseline → matched joint model. Positive is better.</caption><thead><tr><th>Split / train → test</th><th>Pairs</th><th>Brier improvement</th><th>Pair wins</th></tr></thead><tbody>{data.view.directions.map(d=>{const r=d.scopes[filters.scope],g=brierGain(r.brier,6,7);return <tr key={`${d.split}-${d.fold}`}><th scope="row">{d.split} · {d.fold===0?"A → B":"B → A"}{d.split===data.index.primary_split&&d.fold===data.index.primary_fold?" · primary":""}</th><td>{r.pairs.toLocaleString()}</td><td className={tone(g)}>{score(g,6,true)}</td><td>{percent(r.wins?.[1])}</td></tr>;})}</tbody></table></div><p className="ad-footnote">Five event-cluster splits, each evaluated in both directions. Pair wins count lower mean Brier for a model pair, not the share of individual events predicted correctly.</p></div></details>
        <details className="ad-disclosure"><summary>Calibration, scoring and downloadable evidence</summary><div className="ad-detail-body"><p>The strong single-forecast baseline uses the selected forecast’s log-odds, three hinge terms and event-type indicators. The matched joint model adds the difference between the two forecasts’ log-odds. Both minimize the same regularized, event-weighted training log loss.</p><p>Brier averages targets within each event, then weights events equally within each pair, then pairs equally. ECE uses ten equal-width bins and target weights within each pair. Multiple fitted stages reuse their outer training sample; no inner cross-fitting is claimed.</p><div className="ad-table-scroll"><table className="ad-ece-table"><thead><tr><th>Pipeline</th><th>ECE ↓</th></tr></thead><tbody>{summary.rows.map((r,k)=><tr key={r.method}><th scope="row">{labels[k][0]}</th><td>{score(r.ece,6)}</td></tr>)}</tbody></table></div><div className="ad-downloads"><a href={`${MECHANISM_PATH}REPORT.md`}>Matched comparison report ↗</a><a href={`${MECHANISM_PATH}PROTOCOL.md`}>Study protocol ↗</a><a href={`${MECHANISM_PATH}primary-pair-diagnostics.json.gz`} download>Pair results and fitted coefficients ↗</a><a href={`${MECHANISM_PATH}all-direction-scores.csv.gz`} download>All test directions ↗</a><a href={`${MECHANISM_PATH}audit.json`}>Numerical audit ↗</a></div></div></details>
      </div>
    </>}
    </>}
    <footer className="ad-footer"><div><b>Need a specific model pair or the full diagnostics?</b><p>The complete research explorer remains available.</p></div><button className="ad-explore-button" onClick={onExplore}>Open full research explorer →</button></footer>
  </section>;
}

export default function AggregationDecisionExplorer(){
  const [explore,setExplore]=useState(()=>new URLSearchParams(location.search).get("cc_view")==="explorer");
  useEffect(()=>{const update=()=>setExplore(new URLSearchParams(location.search).get("cc_view")==="explorer");window.addEventListener("popstate",update);return()=>window.removeEventListener("popstate",update);},[]);
  function change(next:boolean){
    const q=new URLSearchParams(location.search);if(next)q.set("cc_view","explorer");else{q.delete("cc_view");q.set("cc_section","aggregation-verdict");}
    history.replaceState(null,"",`${location.pathname}?${q}#complementarity`);setExplore(next);window.scrollTo({top:0});
  }
  return explore?<><div className="ad-back"><button className="ad-link-button" onClick={()=>change(false)}>← Back to the aggregation verdict</button><span>Full research explorer</span></div><Suspense fallback={<section id="complementarity" className="cc-study ad-pending" role="status">Loading the full research explorer…</section>}><FullExplorer/></Suspense></>:<Verdict onExplore={()=>change(true)}/>;
}
