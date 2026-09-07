import {lazy,Suspense,useEffect,useState} from "react";
import {score} from "../lib/complementarity";
import {loadMechanisms,mechanismKey,MECHANISM_PATH,brierGain,type MechanismIndex,type MechanismView} from "../lib/typeSelectionMechanisms";
import {decisionSummary,initialDecisionFilters,loadDecisionPools,type DecisionFilters,type PoolMode} from "../lib/aggregationDecision";
import {writeDecisionQuery} from "../lib/aggregationDecisionPairs";
import type {MarketDiversityPerformancePoint} from "../types/data";
import {RAW_POOL_PATH} from "../lib/typeSelectionNoCalibration";
import {CAL_POOL_PATH} from "../lib/typeSelectionCalibratedPooling";
import {UncalibratedAggregationRow,useUncalibratedMethod} from "./UncalibratedAggregationRow";
import {PoolingComparisonTable} from "./PoolingComparisonTable";
import "../complementarity.css";
import "../aggregationDecision.css";

const FullExplorer=lazy(()=>import("./ComplementarityExplorer"));
const PairDecision=lazy(()=>import("./AggregationPairDecision"));
const percent=(v:number|null|undefined,digits=1)=>v==null?"—":`${(100*v).toFixed(digits)}%`;
const tone=(v:number|null)=>v==null||Math.abs(v)<1e-10?"":v>0?"ad-positive":"ad-negative";
const labels=["Type-based selection","Calibrated selection","Strong single-forecast baseline","Matched aggregation"];
type MechanismData={index:MechanismIndex;view:MechanismView};

function PoolingEvidence({data,filters,active}:{data:MechanismData;filters:DecisionFilters;active:boolean}){
  const [pools,setPools]=useState<Awaited<ReturnType<typeof loadDecisionPools>>|null>(null);
  const [mode,setMode]=useState<PoolMode>("raw"),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const key=mechanismKey(filters.gap,filters.coverage,filters.pairScope);
  useEffect(()=>{setPools(null);setError("");if(!active)return;const c=new AbortController();loadDecisionPools(key,c.signal).then(v=>{if(!c.signal.aborted)setPools(v);}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e));});return()=>c.abort();},[key,active,attempt]);
  if(!active)return null;
  if(!pools)return <div className="ad-pending" role={error?"alert":"status"}>{error||"Loading pooling scores…"}{error&&<button className="ad-link-button" onClick={()=>setAttempt(a=>a+1)}>Retry formula comparisons</button>}</div>;
  const row=mode==="raw"?pools.raw.view.primary.scopes[filters.scope]:pools.calibrated.view.primary.stages[mode][filters.scope];
  const main=data.view.primary.scopes[filters.scope];
  if(row.pairs!==main.pairs||row.events!==main.events||row.targets!==main.targets)return <p role="alert">Inconsistent test support.</p>;
  const methodLabels=mode==="raw"?pools.raw.index.method_labels:pools.calibrated.index.method_labels;
  return <div className="ad-detail-body">
    <div className="ad-switch ad-pool-switch" role="group" aria-label="Supporting pooling pipeline">{([['raw','No calibration'],['input','Calibrate models → pool'],['output','Pool → calibrate output']] as const).map(([v,label])=><button key={v} aria-pressed={mode===v} onClick={()=>setMode(v)}>{label}</button>)}</div>
    <PoolingComparisonTable brier={row.brier} methodLabels={methodLabels} testId="ad-pool-table"/>
    <div className="ad-downloads"><a href={`${RAW_POOL_PATH}REPORT.md`}>Raw pooling report ↗</a><a href={`${CAL_POOL_PATH}REPORT.md`}>Calibrated pooling report ↗</a></div>
  </div>;
}

function Verdict({onExplore,baseConfiguration,marketBase,embedded=false}:{onExplore?:()=>void;baseConfiguration?:string;marketBase?:MarketDiversityPerformancePoint|null;embedded?:boolean}){
  const raw=useUncalibratedMethod();
  const [filters,setFilters]=useState<DecisionFilters>(()=>initialDecisionFilters(location.search));
  const [pairMode,setPairMode]=useState(()=>embedded||new URLSearchParams(location.search).get("cc_result")==="pair");
  const [data,setData]=useState<MechanismData|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0),[poolsOpen,setPoolsOpen]=useState(false);
  const key=mechanismKey(filters.gap,filters.coverage,filters.pairScope);
  useEffect(()=>{const c=new AbortController();setData(null);setError("");loadMechanisms(key,c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e));});return()=>c.abort();},[key,attempt]);
  useEffect(()=>{const listener=()=>{setFilters(initialDecisionFilters(location.search));setPairMode(embedded||new URLSearchParams(location.search).get("cc_result")==="pair");};window.addEventListener("popstate",listener);window.addEventListener("hashchange",listener);return()=>{window.removeEventListener("popstate",listener);window.removeEventListener("hashchange",listener);};},[embedded]);
  function changeResult(next:boolean){setPairMode(next);writeDecisionQuery({cc_result:next?"pair":"overall",cc_section:"aggregation-verdict"});}
  function change(patch:Partial<DecisionFilters>){const next={...filters,...patch};setFilters(next);writeDecisionQuery({cc_section:"aggregation-verdict",cc_gap:String(next.gap),cc_coverage:String(next.coverage),cc_scope:next.pairScope,cc_test_scope:next.scope});}
  const summary=data?.view.key===key?decisionSummary(data.view,filters.scope):null,row=summary?.row,defined=!!row?.pairs&&!!row.brier;
  return <section id={embedded?"market-type-selection":"complementarity"} className={`cc-study ad-study${embedded?" ad-embedded":""}`} lang="en">
    <header className="ad-header">{embedded?<h2>Selection vs aggregation</h2>:<h1>Selection vs aggregation</h1>}</header>
    {!embedded&&<div className="ad-result-switch" role="group" aria-label="Aggregation result level"><button aria-pressed={!pairMode} onClick={()=>changeResult(false)}>Overall evidence</button><button aria-pressed={pairMode} onClick={()=>changeResult(true)}>One model pair</button></div>}
    <div className="ad-scope-line"><div className="ad-switch" role="group" aria-label="Aggregation verdict test scope"><button aria-pressed={filters.scope==="all"} onClick={()=>change({scope:"all"})}>All test events</button><button aria-pressed={filters.scope==="complementary"} onClick={()=>change({scope:"complementary"})}>Complementary events only</button></div></div>
    <details className="ad-filters"><summary><span data-testid="ad-context">{row?`${row.pairs.toLocaleString()} model pairs`:'Study scope'} · Train BI gap ≤{filters.gap} · ≥{filters.coverage*100}% coverage</span><b>Change study scope</b></summary><div className="ad-filter-fields">
      <label>Training ability gap<select aria-label="Verdict training ability gap" value={filters.gap} onChange={e=>change({gap:Number(e.target.value) as DecisionFilters['gap']})}><option value="3">BI gap ≤3</option><option value="5">BI gap ≤5</option></select></label>
      <label>Supported type coverage<select aria-label="Verdict type coverage" value={filters.coverage} onChange={e=>change({coverage:Number(e.target.value)})}>{[.5,.6,.7,.8].map(v=><option key={v} value={v}>At least {v*100}%</option>)}</select></label>
      <label>Model-pair scope<select aria-label="Verdict model-pair scope" value={filters.pairScope} onChange={e=>change({pairScope:e.target.value as DecisionFilters['pairScope']})}><option value="all">All exact configurations</option><option value="different_model_version">Different model versions</option><option value="matched_conditions">Same prompt + information</option></select></label>
    </div></details>
    {pairMode?<Suspense fallback={<p className="ad-pending" role="status">Loading pair comparison…</p>}><PairDecision filters={filters} baseConfiguration={baseConfiguration} marketBase={marketBase} raw={raw}/></Suspense>:!data||!summary?<div className="ad-pending" role={error?"alert":"status"}>{error||"Loading comparison…"}{error&&<button className="research-button" onClick={()=>setAttempt(a=>a+1)}>Retry aggregation verdict</button>}</div>:!defined?<p className="ad-pending">No eligible pairs.</p>:<>
      <div className="ad-result-strip"><div className={`ad-effect ${tone(summary.gain)}`} data-testid="ad-effect"><strong>{percent(summary.relative,2)}</strong><span>Brier reduction vs strong single</span></div><div className="ad-facts" data-testid="ad-facts"><div><strong>{score(summary.gain,6,true)}</strong><span>Brier improvement</span></div><div><strong>{percent(summary.pairWins)}</strong><span>pairs improve</span></div><div><strong>{summary.directions.positive}/{summary.directions.total}</strong><span>fixed directions improve</span></div></div></div>
      <section className="ad-comparison"><div className="ad-section-heading"><h3>Pipeline comparison</h3><span>{filters.scope==="all"?"All test events":"Complementary events"} · Brier ↓</span></div><div className="ad-table-scroll"><table className="ad-main-table" data-testid="ad-main-table"><thead><tr><th>Prediction pipeline</th><th>Forecasts / event</th><th>Test Brier ↓</th></tr></thead><tbody>{summary.rows.map((r,k)=><tr key={r.method} className={k===2?"ad-single-row":k===3?"ad-joint-row":""}><th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">{k+1}</span><b>{labels[k]}</b></div></th><td>{k===3?"2":"1 selected"}</td><td>{score(r.brier,6)}</td></tr>)}<UncalibratedAggregationRow brier={row!.brier!} method={raw.method} onChange={raw.choose}/></tbody></table></div></section>
      <div className="ad-supporting">
        <details className="ad-disclosure" onToggle={e=>setPoolsOpen(e.currentTarget.open)}><summary>Pooling methods</summary><PoolingEvidence data={data} filters={filters} active={poolsOpen}/></details>
        <details className="ad-disclosure"><summary>Test directions</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-direction-table"><thead><tr><th>Split / train → test</th><th>Pairs</th><th>Brier improvement</th><th>Pair wins</th></tr></thead><tbody>{data.view.directions.map(d=>{const r=d.scopes[filters.scope],g=brierGain(r.brier,6,7);return <tr key={`${d.split}-${d.fold}`}><th scope="row">{d.split} · {d.fold===0?"A → B":"B → A"}{d.split===data.index.primary_split&&d.fold===data.index.primary_fold?" · primary":""}</th><td>{r.pairs.toLocaleString()}</td><td className={tone(g)}>{score(g,6,true)}</td><td>{percent(r.wins?.[1])}</td></tr>;})}</tbody></table></div></div></details>
        <details className="ad-disclosure"><summary>ECE & downloads</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-ece-table"><thead><tr><th>Pipeline</th><th>ECE ↓</th></tr></thead><tbody>{summary.rows.map((r,k)=><tr key={r.method}><th scope="row">{labels[k]}</th><td>{score(r.ece,6)}</td></tr>)}<tr><th scope="row">Uncalibrated aggregation · {raw.method.label}</th><td>{score(row!.ece?.[raw.method.index],6)}</td></tr></tbody></table></div><div className="ad-downloads"><a href={`${MECHANISM_PATH}REPORT.md`}>Matched comparison report ↗</a><a href={`${MECHANISM_PATH}PROTOCOL.md`}>Study protocol ↗</a><a href={`${MECHANISM_PATH}primary-pair-diagnostics.json.gz`} download>Pair results ↗</a><a href={`${MECHANISM_PATH}all-direction-scores.csv.gz`} download>All test directions ↗</a><a href={`${MECHANISM_PATH}audit.json`}>Numerical audit ↗</a></div></div></details>
      </div>
    </>}
    {onExplore&&<footer className="ad-footer"><button className="ad-explore-button" onClick={onExplore}>Open full research explorer →</button></footer>}
  </section>;
}

export function MarketAggregationDecision({base,baseConfiguration}:{base:MarketDiversityPerformancePoint|null;baseConfiguration:string}){
  return <Verdict embedded baseConfiguration={baseConfiguration} marketBase={base}/>;
}
export default function AggregationDecisionExplorer(){
  const [explore,setExplore]=useState(()=>new URLSearchParams(location.search).get("cc_view")==="explorer");
  useEffect(()=>{const update=()=>setExplore(new URLSearchParams(location.search).get("cc_view")==="explorer");window.addEventListener("popstate",update);return()=>window.removeEventListener("popstate",update);},[]);
  function change(next:boolean){const q=new URLSearchParams(location.search);if(next)q.set("cc_view","explorer");else{q.delete("cc_view");q.set("cc_section","aggregation-verdict");}history.replaceState(null,"",`${location.pathname}?${q}#complementarity`);setExplore(next);window.scrollTo({top:0});}
  return explore?<><div className="ad-back"><button className="ad-link-button" onClick={()=>change(false)}>← Back to the aggregation verdict</button><span>Full research explorer</span></div><Suspense fallback={<section id="complementarity" className="cc-study ad-pending" role="status">Loading full research explorer…</section>}><FullExplorer/></Suspense></>:<Verdict onExplore={()=>change(true)}/>;
}
