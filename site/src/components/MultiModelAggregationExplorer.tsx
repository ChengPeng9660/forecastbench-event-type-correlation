import {useEffect,useMemo,useState} from 'react';
import {loadTeamIndex,loadTeam,teamPaths,choosePath,subsetKey,TEAM_PATH,type TeamIndex,type TeamRecord} from '../lib/multiModelAggregation';
import type {TestScope} from '../lib/typeSelection';
import {score} from '../lib/complementarity';
import {writeDecisionQuery} from '../lib/aggregationDecisionPairs';
import '../multiModelAggregation.css';

type Mode='calibrated'|'raw';
const readState=()=>{const q=new URLSearchParams(location.search);return {size:Number(q.get('cc_team_size'))||0,path:(q.get('cc_team_path')??'').split(',').filter(Boolean).map(Number),base:q.get('cc_base')??'',mode:q.get('cc_team_mode')==='raw'?'raw' as const:'calibrated' as const};};
const gainClass=(n:number)=>n>1e-10?'ad-positive':n< -1e-10?'ad-negative':'';
const typeLabel=(type:string)=>(({climate_weather:'Climate / weather',entertainment_culture:'Entertainment / culture',finance:'Finance / economics'} as Record<string,string>)[type]??type.charAt(0).toUpperCase()+type.slice(1));

function GrowthChart({rows,baseline,method}:{rows:{n:number;brier:number[]}[];baseline:number;method:number}){
  const values=rows.flatMap(r=>[r.brier[baseline],r.brier[method]]),lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.2,.0005);
  const bottom=Math.max(0,lo-pad),top=hi+pad,x=(n:number)=>rows.length===1?360:90+(n-2)*540/(rows.length-1),y=(v:number)=>240-(v-bottom)/(top-bottom)*185;
  return <div className="mm-chart" data-testid="mm-chart"><div className="mm-chart-legend"><span className="mm-baseline">{baseline===1?'Strong single':'Type-based selection'}</span><span className="mm-joint">Matched aggregation{method===3?' · no calibration':''}</span></div>
    <svg viewBox="0 0 720 300" role="img" aria-label="Brier score as the number of models increases; lower is better">
      {[0,.25,.5,.75,1].map(t=>{const v=bottom+t*(top-bottom);return <g key={t}><line x1="90" x2="630" y1={y(v)} y2={y(v)} stroke="#e8dfee"/><text x="76" y={y(v)+4} textAnchor="end">{v.toFixed(4)}</text></g>;})}
      {[baseline,method].map((m,i)=><g key={m} className={i?'mm-joint-line':'mm-baseline-line'}><polyline points={rows.map(r=>`${x(r.n)},${y(r.brier[m])}`).join(' ')} fill="none" strokeWidth={i?3:2} strokeDasharray={i?undefined:'6 5'}/>{rows.map(r=><circle key={r.n} cx={x(r.n)} cy={y(r.brier[m])} r="5"><title>{r.n} models · Brier {r.brier[m].toFixed(6)}</title></circle>)}</g>)}
      {rows.map(r=><text key={r.n} x={x(r.n)} y="269" textAnchor="middle">{r.n} models</text>)}<text x="360" y="294" textAnchor="middle">Same test events at every model count · Brier ↓</text>
    </svg></div>;
}

export default function MultiModelAggregationExplorer({scope,baseConfiguration}:{scope:TestScope;baseConfiguration?:string}){
  const [index,setIndex]=useState<TeamIndex|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [selection,setSelection]=useState(readState),[team,setTeam]=useState<TeamRecord|null>(null),[teamError,setTeamError]=useState(''),[teamAttempt,setTeamAttempt]=useState(0);
  useEffect(()=>{const c=new AbortController();setError('');loadTeamIndex(c.signal).then(v=>{if(!c.signal.aborted)setIndex(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[attempt]);
  useEffect(()=>{const restore=()=>setSelection(readState());window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('hashchange',restore);};},[]);
  const baseName=baseConfiguration??selection.base;
  const base=index?index.models.indexOf(baseName):-1;
  const fallbackBase=index?(index.groups.find(g=>g.models.length===4)??index.groups[0])?.models[0]:undefined;
  const actualBase=base>=0?base:baseName?-1:fallbackBase;
  const sizes=index?[2,3,4].filter(n=>teamPaths(index,n,actualBase).length):[];
  const size=[2,3,4].includes(selection.size)?selection.size:Math.max(...sizes,2);
  const options=useMemo(()=>index?teamPaths(index,size,actualBase):[],[index,size,actualBase]);
  const chosen=choosePath(options,selection.path),path=chosen?.path??[],meta=chosen?.team;
  const modelIds=index?[...new Set(index.groups.filter(g=>g.models.length===size).flatMap(g=>g.paths.map(p=>p[0])))].sort((a,b)=>index.models[a].localeCompare(index.models[b])):[];
  useEffect(()=>{setTeam(null);setTeamError('');if(!meta)return;const c=new AbortController();loadTeam(meta,c.signal).then(v=>{if(!c.signal.aborted)setTeam(v);}).catch(e=>{if(!c.signal.aborted)setTeamError(e.message);});return()=>c.abort();},[meta,teamAttempt]);
  function change(patch:Partial<typeof selection>){const next={...selection,...patch};setSelection(next);writeDecisionQuery({cc_result:'multi',cc_team_size:String(next.size||size),cc_team_path:next.path.join(','),cc_team_mode:next.mode,cc_base:baseConfiguration??(next.base||(actualBase!=null&&index?index.models[actualBase]:''))});}
  if(!index)return <div className="ad-pending" role={error?'alert':'status'}>{error||'Loading complementary teams…'}{error&&<button className="ad-link-button" onClick={()=>setAttempt(n=>n+1)}>Retry model-count explorer</button>}</div>;
  const mode:Mode=selection.mode,baseline=mode==='calibrated'?1:0,method=mode==='calibrated'?2:3;
  const loaded=team?.id===meta?.id?team:null;
  const rows=loaded?Array.from({length:path.length-1},(_,i)=>({n:i+2,...loaded.subsets[subsetKey(path.slice(0,i+2))].scopes[scope]})):[];
  const first=rows[0],last=rows[rows.length-1],improvement=first&&last?first.brier[method]-last.brier[method]:null;
  return <div className="mm-explorer" data-testid="mm-explorer">
    <div className="mm-context"><span>Every model has a specialty · No reversals</span><span>Post-hoc · Train BI range ≤3 · ≥50% type coverage</span></div>
    <div className="mm-pickers">
      {baseConfiguration===undefined?<label>Base model<select aria-label="Team base model" value={actualBase??''} onChange={e=>change({base:index.models[Number(e.target.value)],path:[],size})}>{actualBase!=null&&!modelIds.includes(actualBase)&&<option value={actualBase}>{baseName||index.models[actualBase]} · no eligible team</option>}{modelIds.map(m=><option key={m} value={m}>{index.models[m]}</option>)}</select></label>:<div className="ad-fixed-base"><span>BASE MODEL · MARKET CHART</span><b>{baseConfiguration}</b></div>}
      <label>Number of models<select aria-label="Number of models" value={size} onChange={e=>change({size:Number(e.target.value),path})}>{[2,3,4].map(n=><option key={n} value={n}>{n} models · {index.groups.filter(g=>g.models.length===n&&g.paths.some(p=>p[0]===(actualBase??-1))).length} eligible teams</option>)}</select></label>
      {Array.from({length:size-1},(_,i)=>i+1).map(position=>{const possible=[...new Set(options.filter(o=>o.path.slice(0,position).every((m,j)=>m===path[j])).map(o=>o.path[position]))].sort((a,b)=>index.models[a].localeCompare(index.models[b]));return <label key={position}>Model {position+1}<select aria-label={`Team model ${position+1}`} value={path[position]??''} disabled={!possible.length} onChange={e=>{const prefix=[...path.slice(0,position),Number(e.target.value)];const next=choosePath(options.filter(o=>prefix.every((m,j)=>o.path[j]===m)),path);change({path:next?.path??prefix});}}>{!possible.length&&<option value="">No eligible model</option>}{possible.map(m=><option key={m} value={m}>{index.models[m]}</option>)}</select></label>;})}
    </div>
    {!meta?<p className="ad-pending" role="status">No eligible {size}-model team for this base. Choose another base or model count.</p>:!loaded?<div className="ad-pending" role={teamError?'alert':'status'}>{teamError||'Loading matched model-count scores…'}{teamError&&<button className="ad-link-button" onClick={()=>setTeamAttempt(n=>n+1)}>Retry selected team</button>}</div>:<>
      <div className="mm-support" data-testid="mm-support"><b>{loaded.train_events.toLocaleString()} train events · {last.events.toLocaleString()} test events · {last.targets.toLocaleString()} test targets</b><span>Shared by every model count · intersection of all {size} selected models · primary {index.primary_split} A → B</span></div>
      <div className="ad-switch mm-mode" role="group" aria-label="Model-count calibration"><button aria-pressed={mode==='calibrated'} onClick={()=>change({mode:'calibrated',path})}>Match + calibrate</button><button aria-pressed={mode==='raw'} onClick={()=>change({mode:'raw',path})}>Match only · no calibration</button></div>
      {rows.length>1&&<p className={`mm-effect ${gainClass(improvement!)}`} data-testid="mm-effect">{first.n} → {last.n} models: Brier {improvement!>=0?'reduction':'increase'} <b>{score(Math.abs(improvement!),6)}</b> ({(100*Math.abs(improvement!)/first.brier[method]).toFixed(2)}%)</p>}
      <GrowthChart rows={rows} baseline={baseline} method={method}/>
      <div className="ad-table-scroll"><table className="mm-results" data-testid="mm-results"><thead><tr><th>Models</th><th>{baseline===1?'Strong single':'Type selection'} Brier ↓</th><th>Matched aggregation Brier ↓</th><th>{baseline===1?'Gain vs strong single':'Gain vs type selection'}</th><th>Gain vs previous count</th></tr></thead><tbody>{rows.map((r,i)=>{const gain=r.brier[baseline]-r.brier[method],step=i?rows[i-1].brier[method]-r.brier[method]:null;return <tr key={r.n}><th scope="row">{r.n}</th><td>{score(r.brier[baseline],6)}</td><td>{score(r.brier[method],6)}</td><td className={gainClass(gain)}>{score(gain,6,true)}</td><td className={step==null?'':gainClass(step)}>{score(step,6,true)}</td></tr>;})}</tbody></table></div>
      <details className="ad-disclosure"><summary>Type specialists</summary><div className="ad-detail-body mm-specialists">{loaded.routes.filter(r=>r.complementary).map(r=><div key={r.type}><span>{typeLabel(r.type)}</span><b>{index.models[loaded.models[r.selected]]}</b><small>{r.train_events} train / {r.test_events} test events · advantage retained</small></div>)}</div></details>
      <div className="ad-downloads"><a href={`${TEAM_PATH}PROTOCOL.md`}>Study protocol ↗</a><a href={`${TEAM_PATH}teams/${loaded.id.slice(2,4)}.json`}>Team scores ↗</a><a href={`${TEAM_PATH}audit.json`}>Numerical audit ↗</a></div>
    </>}
  </div>;
}
