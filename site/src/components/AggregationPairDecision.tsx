import {useEffect,useMemo,useState} from "react";
import {score} from "../lib/complementarity";
import type {DecisionFilters,PoolMode} from "../lib/aggregationDecision";
import {DECISION_PAIR_PATH,loadDecisionPairIndex,loadDecisionPair,pairDecisionSummary,pairHasBase,pairPartner,pairBaseSide,pairsForBase,writeDecisionQuery,type DecisionPairIndex,type DecisionPair} from "../lib/aggregationDecisionPairs";
import type {MarketDiversityPerformancePoint} from "../types/data";
import {UncalibratedAggregationRow,type UncalibratedChoice} from "./UncalibratedAggregationRow";

const pct=(v:number|null,digits=1)=>v==null?"—":`${(100*v).toFixed(digits)}%`;
const color=(v:number)=>v>1e-10?"ad-positive":v< -1e-10?"ad-negative":"";
const labels=["Type-based selection","Calibrated selection","Strong single-forecast baseline","Matched aggregation"];
const typeNames:Record<string,string>={health:"Health",politics:"Politics",sports:"Sports",finance:"Finance / economics",technology:"Technology",climate_weather:"Climate / weather",entertainment_culture:"Entertainment / culture"};
const modes=[['raw','No calibration'],['input','Calibrate models → pool'],['output','Pool → calibrate output']] as const;

function PairEvidence({pair,index,filters,base,raw}:{pair:DecisionPair;index:DecisionPairIndex;filters:DecisionFilters;base:string;raw:UncalibratedChoice}){
  const [mode,setMode]=useState<PoolMode>("raw");
  const s=pairDecisionSummary(pair,filters),r=s.row,pool=r.pools[mode],side=pairBaseSide(pair,base);
  const negative=s.gain< -1e-10;
  return <div data-testid="ad-pair-results">
    <div className="ad-pair-identities" data-testid="ad-pair-identities"><div><span>BASE MODEL</span><b>{base}</b></div><div><span>PARTNER MODEL</span><b>{pairPartner(pair,base)}</b></div></div>
    <div className="ad-pair-context">{pair.id} · Primary {index.primary_split} / {index.primary_fold===0?"A → B":"B → A"} · Train BI gap {score(pair.train_gap,2)} · Coverage {pct(pair.train_coverage)}</div>
    <div className="ad-result-strip"><div className={`ad-effect ${color(s.gain)}`} data-testid="ad-pair-effect"><strong>{pct(s.relative==null?null:Math.abs(s.relative),2)}</strong><span>Brier {negative?"increase":"reduction"} vs strong single</span></div><div className="ad-facts" data-testid="ad-pair-facts"><div><strong className={color(s.gain)}>{score(s.gain,6,true)}</strong><span>Brier improvement</span></div><div><strong>{r.events.toLocaleString()}</strong><span>test events · {r.targets.toLocaleString()} targets</span></div><div><strong>{s.positive}/{s.directions.length}</strong><span>eligible directions improve</span></div></div></div>
    <section className="ad-comparison"><div className="ad-section-heading"><h3>Pipeline comparison</h3><span>{filters.scope==="all"?"All test events":"Complementary events"} · Brier ↓</span></div>
      <div className="ad-table-scroll"><table className="ad-main-table" data-testid="ad-pair-main-table"><thead><tr><th>Prediction pipeline</th><th>Forecasts / event</th><th>Test Brier ↓</th></tr></thead><tbody>{[0,5,6,7].map((m,k)=><tr key={m} className={k===2?"ad-single-row":k===3?"ad-joint-row":""}><th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">{k+1}</span><b>{labels[k]}</b></div></th><td>{k===3?"2":"1 selected"}</td><td>{score(r.brier[m],6)}</td></tr>)}<UncalibratedAggregationRow brier={r.brier} method={raw.method} onChange={raw.choose}/></tbody></table></div>
    </section>
    <div className="ad-supporting">
      <details className="ad-disclosure"><summary>Pooling methods</summary><div className="ad-detail-body">
        <div className="ad-switch ad-pool-switch" role="group" aria-label="Pair pooling pipeline">{modes.map(([v,label])=><button key={v} aria-pressed={mode===v} onClick={()=>setMode(v)}>{label}</button>)}</div>
        <div className="ad-table-scroll"><table className="ad-pool-table" data-testid="ad-pair-pool-table"><thead><tr><th>Method</th><th>Brier ↓</th><th>Gain vs pipeline selection</th><th>Gain vs strong single</th></tr></thead><tbody>{[2,3,4,5,6,7,8,9].map(m=><tr key={m}><th scope="row">{index.pool_labels[m]}</th><td>{score(pool.brier[m],6)}</td><td className={color(pool.brier[0]-pool.brier[m])}>{score(pool.brier[0]-pool.brier[m],6,true)}</td><td className={color(r.brier[6]-pool.brier[m])}>{score(r.brier[6]-pool.brier[m],6,true)}</td></tr>)}</tbody></table></div>
      </div></details>
      <details className="ad-disclosure"><summary>Test directions</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-direction-table" data-testid="ad-pair-directions"><thead><tr><th>Eligible split / direction</th><th>Events</th><th>Strong single Brier</th><th>Joint Brier</th><th>Improvement</th></tr></thead><tbody>{s.directions.map(d=>{const ds=d.scopes[filters.scope],g=ds.brier[2]!-ds.brier[3]!;return <tr key={`${d.split}-${d.fold}`}><th scope="row">{d.split} · {d.fold===0?"A → B":"B → A"}{d.split===index.primary_split&&d.fold===index.primary_fold?" · primary":""}</th><td>{ds.events}</td><td>{score(ds.brier[2],6)}</td><td>{score(ds.brier[3],6)}</td><td className={color(g)}>{score(g,6,true)}</td></tr>;})}</tbody></table></div></div></details>
      <details className="ad-disclosure"><summary>Event-type selections</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-direction-table" data-testid="ad-pair-routes"><thead><tr><th>Event type</th><th>Train events</th><th>Base Brier</th><th>Partner Brier</th><th>Selected model</th><th>Support</th></tr></thead><tbody>{pair.routes.map(t=><tr key={t.type}><th scope="row">{typeNames[t.type]??t.type}</th><td>{t.train_events}</td><td>{score(side===0?t.train_brier_a:t.train_brier_b,5)}</td><td>{score(side===0?t.train_brier_b:t.train_brier_a,5)}</td><td>{t.selected===side?"Base":"Partner"}</td><td>{t.fallback?"Overall fallback":t.complementary?"Complementary":"Supported"}</td></tr>)}</tbody></table></div><div className="ad-pair-context">Single-model test Brier · Base {score(r.single_brier[side],6)} · Partner {score(r.single_brier[1-side],6)}</div></div></details>
      <details className="ad-disclosure"><summary>ECE & downloads</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-ece-table"><thead><tr><th>Pipeline</th><th>ECE ↓</th></tr></thead><tbody>{[0,5,6,7].map((m,k)=><tr key={m}><th scope="row">{labels[k]}</th><td>{score(r.ece[m],6)}</td></tr>)}<tr><th scope="row">Uncalibrated aggregation · {raw.method.label}</th><td>{score(r.ece[raw.method.index],6)}</td></tr></tbody></table></div><div className="ad-downloads"><button className="ad-link-button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(pair,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=`${pair.id}-aggregation.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Pair scores ↓</button><a href={`${DECISION_PAIR_PATH}provenance.json`}>Data provenance ↗</a></div></div></details>
    </div>
  </div>;
}

function querySelection(){const q=new URLSearchParams(location.search);return {id:q.get("cc_pair")??"",base:q.get("cc_base")??""};}
export default function AggregationPairDecision({filters,baseConfiguration,marketBase,raw}:{filters:DecisionFilters;baseConfiguration?:string;marketBase?:MarketDiversityPerformancePoint|null;raw:UncalibratedChoice}){
  const [index,setIndex]=useState<DecisionPairIndex|null>(null),[pair,setPair]=useState<DecisionPair|null>(null);
  const [error,setError]=useState(""),[pairError,setPairError]=useState(""),[attempt,setAttempt]=useState(0),[pairAttempt,setPairAttempt]=useState(0);
  const [selection,setSelection]=useState(querySelection);
  useEffect(()=>{const c=new AbortController();setError("");loadDecisionPairIndex(c.signal).then(v=>{if(!c.signal.aborted)setIndex(v);}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e));});return()=>c.abort();},[attempt]);
  useEffect(()=>{const restore=()=>setSelection(querySelection());window.addEventListener("popstate",restore);window.addEventListener("hashchange",restore);return()=>{window.removeEventListener("popstate",restore);window.removeEventListener("hashchange",restore);};},[]);
  const saved=index?.pairs.find(p=>p.id===selection.id);
  const base=baseConfiguration??(selection.base||saved?.model_a||index?.pairs[0]?.model_a||"");
  const models=useMemo(()=>[...new Set(index?.pairs.flatMap(p=>[p.model_a,p.model_b])??[])].sort((a,b)=>a.localeCompare(b)),[index]);
  const eligible=useMemo(()=>index?pairsForBase(index.pairs,base,filters):[],[index,base,filters.gap,filters.coverage,filters.pairScope]);
  const baseChanged=!!selection.base&&selection.base!==base;
  const meta=!baseChanged?eligible.find(p=>p.id===selection.id):undefined,position=eligible.findIndex(p=>p.id===meta?.id);
  function choose(id:string){setSelection({id,base});writeDecisionQuery({cc_pair:id,cc_base:base,cc_result:"pair"});}
  useEffect(()=>{if(!index||!base)return;if(baseChanged||!selection.id||!selection.base&&saved&&!pairHasBase(saved,base)){const next=eligible.find(p=>p.id===selection.id)??eligible[0];setSelection({id:next?.id??"",base});writeDecisionQuery({cc_base:base,cc_pair:next?.id??""});}},[index,base,baseChanged,selection.id,selection.base,saved,eligible]);
  useEffect(()=>{setPair(null);setPairError("");if(!meta||!index)return;const c=new AbortController();loadDecisionPair(meta,index,c.signal).then(p=>{if(!c.signal.aborted)setPair(p);}).catch(e=>{if(!c.signal.aborted)setPairError(String(e.message??e));});return()=>c.abort();},[meta,index,pairAttempt]);
  if(!index)return <div className="ad-pending" role={error?"alert":"status"}>{error||"Loading model pairs…"}{error&&<button className="ad-link-button" onClick={()=>setAttempt(v=>v+1)}>Retry pair list</button>}</div>;
  return <section className="ad-pair-view" aria-label="Individual model-pair results" data-base-configuration={base}>
    <div className="ad-pair-picker">{baseConfiguration===undefined?<label>Base model<select aria-label="Base model" value={base} onChange={e=>{setSelection({id:"",base:e.target.value});writeDecisionQuery({cc_base:e.target.value,cc_pair:""});}}>{base&&!models.includes(base)&&<option value={base}>{base}</option>}{models.map(model=><option key={model} value={model}>{model}</option>)}</select></label>:<div className="ad-fixed-base"><span>BASE MODEL · MARKET CHART</span><b>{base}</b></div>}<label>Partner model<select aria-label="Partner model" value={meta?.id??""} onChange={e=>choose(e.target.value)}><option value="" disabled>Select partner</option>{eligible.map(p=><option key={p.id} value={p.id}>{pairPartner(p,base)}</option>)}</select></label></div>
    {marketBase&&marketBase.exact_configuration===base&&<div className="ad-base-ability" data-testid="ad-base-ability"><span>POLYMARKET · ALL EVENT TYPES</span><b>Brier {score(marketBase.model.raw_brier,6)}</b><b>BI {score(marketBase.model.brier_index,2)}</b><span>{marketBase.n_events} events</span></div>}
    <div className="ad-pair-browse"><span>{eligible.length} eligible partners</span><div><button onClick={()=>choose(eligible[position-1].id)} disabled={position<=0}>← Previous partner</button><span>{position>=0?`${position+1} / ${eligible.length}`:"—"}</span><button onClick={()=>choose(eligible[position+1].id)} disabled={position<0||position>=eligible.length-1}>Next partner →</button></div></div>
    {!meta?<p role="status" className="ad-pending">{eligible.length?"Selected pair is outside the current filters. Select a partner.":"No eligible partners for this base model and training scope."}</p>:!pair||pair.id!==meta.id?<div className="ad-pending" role={pairError?"alert":"status"}>{pairError||"Loading pair scores…"}{pairError&&<button className="ad-link-button" onClick={()=>setPairAttempt(v=>v+1)}>Retry selected pair</button>}</div>:<PairEvidence key={pair.id} pair={pair} index={index} filters={filters} base={base} raw={raw}/>}
  </section>;
}
