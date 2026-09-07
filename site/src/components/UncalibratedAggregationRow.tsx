import {useEffect,useState} from "react";
import {score} from "../lib/complementarity";
import {writeDecisionQuery} from "../lib/aggregationDecisionPairs";

const METHODS=[
  {id:"simple_mean",label:"Simple mean",index:1},
  {id:"log_odds_mean",label:"Log-odds mean",index:2},
  {id:"ec_w0_56",label:"EC · w = 0.56",index:3},
  {id:"piecewise_odds",label:"Piecewise odds",index:4},
] as const;
type Method=typeof METHODS[number];
export type UncalibratedChoice={method:Method;choose:(id:string)=>void};

function readMethod():Method {
  const id=new URLSearchParams(location.search).get("cc_raw_method");
  return METHODS.find(method=>method.id===id)??METHODS[0];
}

export function useUncalibratedMethod():UncalibratedChoice{
  const [method,setMethod]=useState(readMethod);
  useEffect(()=>{
    const restore=()=>setMethod(readMethod());
    window.addEventListener("popstate",restore);window.addEventListener("hashchange",restore);
    return()=>{window.removeEventListener("popstate",restore);window.removeEventListener("hashchange",restore);};
  },[]);
  function choose(id:string){
    const next=METHODS.find(candidate=>candidate.id===id)??METHODS[0];
    setMethod(next);writeDecisionQuery({cc_raw_method:next.id});
  }
  return {method,choose};
}

export function UncalibratedAggregationRow({brier,method,onChange}:{brier:readonly number[];method:Method;onChange:(id:string)=>void}){
  const value=brier[method.index],gain=brier[0]-value,relative=brier[0]>0?100*gain/brier[0]:null;
  return <tr className="ad-raw-row" data-testid="ad-uncalibrated-row">
    <th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">5</span><div className="ad-raw-method">
      <b>Uncalibrated aggregation</b>
      <select aria-label="Uncalibrated aggregation method" value={method.id} onChange={event=>onChange(event.target.value)}>{METHODS.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>
      <small data-testid="ad-uncalibrated-gain" className={gain>1e-10?"ad-positive":gain< -1e-10?"ad-negative":""}>Brier gain vs type selection: {score(gain,6,true)}{relative!=null&&` (${Math.abs(relative).toFixed(2)}% ${relative<0?"higher":"lower"})`}</small>
    </div></div></th>
    <td>2</td><td data-testid="ad-uncalibrated-score">{score(value,6)}</td>
  </tr>;
}
