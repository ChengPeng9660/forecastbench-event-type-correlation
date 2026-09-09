import {useEffect,useMemo,useState} from "react";
import {score} from "../lib/complementarity";
import type {DecisionFilters} from "../lib/aggregationDecision";
import {DECISION_PAIR_PATH,loadDecisionPairIndex,loadDecisionPair,pairDecisionSummary,pairHasBase,pairPartner,pairBaseSide,pairsForBase,writeDecisionQuery,type DecisionPairIndex,type DecisionPair} from "../lib/aggregationDecisionPairs";
import {EventTypeJointRow,UNCALIBRATED_METHODS,UncalibratedAggregationRows,UncalibratedJointRow} from "./UncalibratedAggregationRow";
import {STABILITY_PATH} from "../lib/aggregationStability";

const typeNames:Record<string,string>={health:"Health",politics:"Politics",sports:"Sports",finance:"Finance / economics",technology:"Technology",climate_weather:"Climate / weather",entertainment_culture:"Entertainment / culture"};

function PairEvidence({pair,index,filters,base}:{pair:DecisionPair;index:DecisionPairIndex;filters:DecisionFilters;base:string}){
  const {row:r}=pairDecisionSummary(pair,filters),side=pairBaseSide(pair,base);
  const typewise=pair.typewise?.scopes[filters.scope];
  const fallback=!!pair.stability&&pair.stability!=="no_reversal";
  const referenceLabel=fallback?"overall selection":"type selection",selectionLabel=fallback?"Overall selection (train)":"Type-based selection";
  const rawJointBrier=r.pools.raw.brier[7],complementaryRoutes=pair.routes.filter(route=>route.complementary);
  const [activeType,setActiveType]=useState(complementaryRoutes[0]?.type??"");
  const activeRoute=complementaryRoutes.find(route=>route.type===activeType);
  const eventType=pair.typewise?.event_types[activeType];
  const partner=pairPartner(pair,base);
  return <div data-testid="ad-pair-results">
    <section className="ad-complementary-types" aria-label="Complementary event types" data-testid="ad-complementary-types">
      <div className="ad-complementary-heading"><div><span>PAIR COMPLEMENTARITY</span><h3>Complementary event types</h3></div><p>Select an event type to compare both models and the two matched aggregation rules.</p></div>
      <div className="ad-type-list" aria-label="Choose an event type">{complementaryRoutes.map(route=>{const baseSpecialist=route.selected===side,active=route.type===activeType;return <button type="button" className={`ad-type-chip ${baseSpecialist?"ad-type-base":"ad-type-partner"}`} aria-pressed={active} aria-controls="ad-event-type-performance" onClick={()=>setActiveType(route.type)} key={route.type} data-testid="ad-complementary-type"><b>{typeNames[route.type]??route.type}</b><span>{baseSpecialist?"Base":"Partner"} specialist{active?" · Selected":""}</span></button>;})}</div>
      {eventType&&activeRoute&&<div className="ad-event-type-performance" id="ad-event-type-performance" data-testid="ad-event-type-performance" aria-live="polite">
        <div className="ad-event-type-performance-heading"><div><span>EVENT-TYPE PERFORMANCE</span><h4>{typeNames[activeType]??activeType}</h4></div><p>{eventType.events.toLocaleString()} test events · {eventType.targets.toLocaleString()} targets · lower is better</p></div>
        <div className="ad-table-scroll"><table className="ad-event-type-table"><thead><tr><th>Prediction pipeline</th><th>Test Brier ↓</th><th>Test ECE ↓</th></tr></thead><tbody>
          <tr data-testid="ad-event-type-base-row"><th scope="row"><b>Base model</b><small>{activeRoute.selected===side?"Selected specialist":"Second forecast"} · {base}</small></th><td>{score(eventType.brier[side],6)}</td><td>{score(eventType.ece[side],6)}</td></tr>
          <tr data-testid="ad-event-type-partner-row"><th scope="row"><b>Partner model</b><small>{activeRoute.selected===1-side?"Selected specialist":"Second forecast"} · {partner}</small></th><td>{score(eventType.brier[1-side],6)}</td><td>{score(eventType.ece[1-side],6)}</td></tr>
          <tr className="ad-event-type-global-row" data-testid="ad-event-type-global-row"><th scope="row"><b>Matched aggregation · no calibration</b><small>One global train-fitted weight</small></th><td>{score(eventType.brier[2],6)}</td><td>{score(eventType.ece[2],6)}</td></tr>
          <tr className="ad-event-type-weight-row" data-testid="ad-event-type-weight-row"><th scope="row"><b>Matched aggregation · event-type weights</b><small>Train-fitted weight for {typeNames[activeType]??activeType}</small></th><td>{score(eventType.brier[3],6)}</td><td>{score(eventType.ece[3],6)}</td></tr>
        </tbody></table></div>
      </div>}
    </section>
    <section className="ad-comparison"><div className="ad-section-heading"><h3>Pipeline comparison</h3><span>{filters.scope==="all"?"All test events":"Complementary events"} · Brier &amp; ECE ↓</span></div>
      <div className="ad-table-scroll"><table className="ad-main-table" data-testid="ad-pair-main-table"><thead><tr><th>Prediction pipeline</th><th>Test Brier ↓</th><th>Test ECE ↓</th></tr></thead><tbody><tr><th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">1</span><b>{selectionLabel}</b></div></th><td>{score(r.brier[0],6)}</td><td>{score(r.ece[0],6)}</td></tr><UncalibratedAggregationRows brier={r.brier} ece={r.ece} referenceLabel={referenceLabel}/><UncalibratedJointRow brier={rawJointBrier} ece={r.pools.raw.ece[7]} referenceBrier={r.brier[0]} referenceLabel={referenceLabel}/>{typewise&&<EventTypeJointRow brier={typewise.brier[2]} ece={typewise.ece[2]} referenceBrier={typewise.brier[0]} globalBrier={typewise.brier[1]} globalEce={typewise.ece[1]} referenceLabel={referenceLabel}/>}</tbody></table></div>
    </section>
    <div className="ad-supporting">
      <details className="ad-disclosure"><summary>Event-type selections</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-direction-table" data-testid="ad-pair-routes"><thead><tr><th>Event type</th><th>Train events</th><th>{pair.stability?"Base train Brier":"Base Brier"}</th><th>{pair.stability?"Partner train Brier":"Partner Brier"}</th><th>{pair.stability?"Policy model":"Selected model"}</th><th>Support</th>{pair.stability&&<><th>Test events</th><th>Base test Brier</th><th>Partner test Brier</th><th>Type advantage</th></>}</tr></thead><tbody>{pair.routes.map(t=><tr key={t.type}><th scope="row">{typeNames[t.type]??t.type}</th><td>{t.train_events}</td><td>{score(side===0?t.train_brier_a:t.train_brier_b,5)}</td><td>{score(side===0?t.train_brier_b:t.train_brier_a,5)}</td><td>{(t.policy_selected??t.selected)===side?"Base":"Partner"}</td><td>{t.fallback?"Overall fallback":t.complementary?"Complementary":"Supported"}</td>{pair.stability&&<><td>{t.test_events}</td><td>{score(side===0?t.test_brier_a:t.test_brier_b,5)}</td><td>{score(side===0?t.test_brier_b:t.test_brier_a,5)}</td><td>{({retained:"Retained",reversed:"Reversed",tied:"Tie · no reversal",unverified:"No test events",not_complementary:"Outside complementary set"} as Record<string,string>)[t.test_status??""]}</td></>}</tr>)}</tbody></table></div><div className="ad-pair-context">Single-model test Brier · Base {score(r.single_brier[side],6)} · Partner {score(r.single_brier[1-side],6)}</div></div></details>
      <details className="ad-disclosure"><summary>ECE & downloads</summary><div className="ad-detail-body"><div className="ad-table-scroll"><table className="ad-ece-table"><thead><tr><th>Pipeline</th><th>ECE ↓</th></tr></thead><tbody><tr><th scope="row">{selectionLabel}</th><td>{score(r.ece[0],6)}</td></tr>{UNCALIBRATED_METHODS.map(method=><tr key={method.id} data-testid={`ad-uncalibrated-ece-${method.id}`}><th scope="row">Uncalibrated aggregation · {method.label}</th><td>{score(r.ece[method.index],6)}</td></tr>)}<tr><th scope="row">Matched aggregation · no calibration</th><td>{score(r.pools.raw.ece[7],6)}</td></tr>{typewise&&<tr data-testid="ad-event-type-ece-summary"><th scope="row">Matched aggregation · event-type weights</th><td>{score(typewise.ece[2],6)}</td></tr>}</tbody></table></div><div className="ad-downloads"><button className="ad-link-button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(pair,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=`${pair.id}-aggregation.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Pair scores ↓</button><a href={`${index.post_hoc?STABILITY_PATH:DECISION_PAIR_PATH}${index.post_hoc?"source-manifest.json":"provenance.json"}`}>Data provenance ↗</a></div></div></details>
    </div>
  </div>;
}

function querySelection(){const q=new URLSearchParams(location.search);return {id:q.get("cc_pair")??"",base:q.get("cc_base")??""};}
export default function AggregationPairDecision({filters,baseConfiguration}:{filters:DecisionFilters;baseConfiguration?:string}){
  const [index,setIndex]=useState<DecisionPairIndex|null>(null),[pair,setPair]=useState<DecisionPair|null>(null);
  const [error,setError]=useState(""),[pairError,setPairError]=useState(""),[attempt,setAttempt]=useState(0),[pairAttempt,setPairAttempt]=useState(0);
  const [selection,setSelection]=useState(querySelection);
  const postHoc=filters.stability!=="original";
  useEffect(()=>{const c=new AbortController();setIndex(null);setError("");loadDecisionPairIndex(c.signal,postHoc).then(v=>{if(!c.signal.aborted)setIndex(v);}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e));});return()=>c.abort();},[attempt,postHoc]);
  useEffect(()=>{const restore=()=>setSelection(querySelection());window.addEventListener("popstate",restore);window.addEventListener("hashchange",restore);return()=>{window.removeEventListener("popstate",restore);window.removeEventListener("hashchange",restore);};},[]);
  const saved=index?.pairs.find(p=>p.id===selection.id);
  const base=baseConfiguration??(selection.base||saved?.model_a||index?.pairs[0]?.model_a||"");
  const models=useMemo(()=>[...new Set(index?.pairs.flatMap(p=>[p.model_a,p.model_b])??[])].sort((a,b)=>a.localeCompare(b)),[index]);
  const eligible=useMemo(()=>index?pairsForBase(index.pairs,base,filters):[],[index,base,filters.gap,filters.coverage,filters.pairScope,filters.stability]);
  const baseChanged=!!selection.base&&selection.base!==base;
  const meta=!baseChanged?eligible.find(p=>p.id===selection.id):undefined,position=eligible.findIndex(p=>p.id===meta?.id);
  function choose(id:string){setSelection({id,base});writeDecisionQuery({cc_pair:id,cc_base:base,cc_result:"pair"});}
  useEffect(()=>{if(!index||!base)return;if(baseChanged||!selection.id||!selection.base&&saved&&!pairHasBase(saved,base)){const next=eligible.find(p=>p.id===selection.id)??eligible[0];setSelection({id:next?.id??"",base});writeDecisionQuery({cc_base:base,cc_pair:next?.id??""});}},[index,base,baseChanged,selection.id,selection.base,saved,eligible]);
  useEffect(()=>{setPair(null);setPairError("");if(!meta||!index)return;const c=new AbortController();loadDecisionPair(meta,index,c.signal).then(p=>{if(!c.signal.aborted)setPair(p);}).catch(e=>{if(!c.signal.aborted)setPairError(String(e.message??e));});return()=>c.abort();},[meta,index,pairAttempt]);
  if(!index)return <div className="ad-pending" role={error?"alert":"status"}>{error||"Loading model pairs…"}{error&&<button className="ad-link-button" onClick={()=>setAttempt(v=>v+1)}>Retry pair list</button>}</div>;
  return <section className="ad-pair-view" aria-label="Individual model-pair results" data-base-configuration={base}>
    <div className="ad-pair-picker">{baseConfiguration===undefined?<label>Base model<select aria-label="Base model" value={base} onChange={e=>{setSelection({id:"",base:e.target.value});writeDecisionQuery({cc_base:e.target.value,cc_pair:""});}}>{base&&!models.includes(base)&&<option value={base}>{base}</option>}{models.map(model=><option key={model} value={model}>{model}</option>)}</select></label>:<div className="ad-fixed-base"><span>BASE MODEL · MARKET CHART</span><b>{base}</b></div>}<label>Partner model<select aria-label="Partner model" value={meta?.id??""} onChange={e=>choose(e.target.value)}><option value="" disabled>Select partner</option>{eligible.map(p=><option key={p.id} value={p.id}>{pairPartner(p,base)}</option>)}</select></label></div>
    <div className="ad-pair-browse"><div><button onClick={()=>choose(eligible[position-1].id)} disabled={position<=0}>← Previous partner</button><span>{position>=0?`${position+1} / ${eligible.length}`:"—"}</span><button onClick={()=>choose(eligible[position+1].id)} disabled={position<0||position>=eligible.length-1}>Next partner →</button></div></div>
    {!meta?<div role="status" className="ad-pending">{eligible.length?"Selected pair is outside the current filters. Select a partner.":"No eligible partners for this base model and training scope."}{saved?.stability&&saved.stability!=="no_reversal"&&filters.stability==="stable"&&<span className="ad-empty-reversal">This pair is outside the No reversals group. Choose a listed partner to view results.</span>}</div>:!pair||pair.id!==meta.id?<div className="ad-pending" role={pairError?"alert":"status"}>{pairError||"Loading pair scores…"}{pairError&&<button className="ad-link-button" onClick={()=>setPairAttempt(v=>v+1)}>Retry selected pair</button>}</div>:<PairEvidence key={pair.id} pair={pair} index={index} filters={filters} base={base}/>}
  </section>;
}
