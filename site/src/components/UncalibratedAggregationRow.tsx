import {Fragment} from "react";
import {score} from "../lib/complementarity";

export const UNCALIBRATED_METHODS=[
  {id:"simple_mean",label:"Simple mean",description:"Average the two probabilities",index:1},
  {id:"log_odds_mean",label:"Log-odds mean",description:"Average the two logits",index:2},
  {id:"ec_w0_56",label:"EC · w = 0.56",description:"Scale the summed logits by 0.56",index:3},
  {id:"piecewise_odds",label:"Piecewise odds",description:"Use thresholded odds pooling",index:4},
] as const;

function Gain({before,after,referenceLabel,testId}:{before:number;after:number;referenceLabel:string;testId?:string}){
  const gain=before-after,relative=before>0?100*gain/before:null;
  return <small data-testid={testId} className={gain>1e-10?"ad-positive":gain< -1e-10?"ad-negative":""}>
    Brier gain vs {referenceLabel}: {score(gain,6,true)}{relative!=null&&` (${Math.abs(relative).toFixed(2)}% ${relative<0?"higher":"lower"})`}
  </small>;
}

export function UncalibratedAggregationRows({brier,ece,referenceLabel="type selection"}:{brier:readonly number[];ece:readonly number[]|null;referenceLabel?:string}){
  return <>{UNCALIBRATED_METHODS.map((method,index)=>{
    const suffix=String.fromCharCode(97+index);
    return <Fragment key={method.id}>
      <tr className={`ad-raw-row${index===0?" ad-raw-row-first":""}`} data-testid={`ad-uncalibrated-row-${method.id}`} data-aggregation-rule={method.id}>
        <th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">2{suffix}</span><div className="ad-raw-method">
          <span className="ad-raw-kind">Uncalibrated aggregation</span>
          <b>{method.label}</b>
          <small className="ad-raw-description">{method.description}</small>
          <Gain before={brier[0]} after={brier[method.index]} referenceLabel={referenceLabel} testId={`ad-uncalibrated-gain-${method.id}`}/>
        </div></div></th>
        <td data-testid={`ad-uncalibrated-score-${method.id}`}>{score(brier[method.index],6)}</td>
        <td data-testid={`ad-uncalibrated-ece-score-${method.id}`}>{score(ece?.[method.index],6)}</td>
      </tr>
    </Fragment>;
  })}</>;
}

export function UncalibratedJointRow({brier,ece,referenceBrier,referenceLabel="type selection"}:{brier:number|null;ece:number|null|undefined;referenceBrier:number|null;referenceLabel?:string}){
  return <tr className="ad-raw-joint-row" data-testid="ad-uncalibrated-joint-row">
    <th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">3</span><div className="ad-raw-method">
      <span className="ad-raw-kind">Learned raw rule</span>
      <b>Matched aggregation · no calibration</b>
      {brier!=null&&referenceBrier!=null&&<Gain before={referenceBrier} after={brier} referenceLabel={referenceLabel} testId="ad-uncalibrated-joint-gain"/>}
    </div></div></th>
    <td data-testid="ad-uncalibrated-joint-brier">{score(brier,6)}</td>
    <td data-testid="ad-uncalibrated-joint-ece">{score(ece,6)}</td>
  </tr>;
}

export function EventTypeJointRow({brier,ece,referenceBrier,globalBrier,globalEce,referenceLabel="type selection"}:{brier:number|null;ece:number|null;referenceBrier:number|null;globalBrier:number|null;globalEce:number|null;referenceLabel?:string}){
  const globalBrierGain=globalBrier!=null&&brier!=null?globalBrier-brier:null;
  const globalEceGain=globalEce!=null&&ece!=null?globalEce-ece:null;
  return <tr className="ad-raw-joint-row ad-raw-typewise-row" data-testid="ad-event-type-joint-row">
    <th scope="row"><div className="ad-pipeline-label"><span className="ad-row-number">4</span><div className="ad-raw-method">
      <span className="ad-raw-kind">Learned by event type · exploratory</span>
      <b>Matched aggregation · event-type weights</b>
      <small className="ad-raw-description">Type-normalized training · no calibration</small>
      {brier!=null&&referenceBrier!=null&&<Gain before={referenceBrier} after={brier} referenceLabel={referenceLabel} testId="ad-event-type-joint-gain"/>}
      {globalBrierGain!=null&&globalEceGain!=null&&<small className="ad-typewise-global" data-testid="ad-event-type-vs-global">Vs global weight · Brier {score(globalBrierGain,6,true)} · ECE {score(globalEceGain,6,true)}</small>}
    </div></div></th>
    <td data-testid="ad-event-type-joint-brier">{score(brier,6)}</td>
    <td data-testid="ad-event-type-joint-ece">{score(ece,6)}</td>
  </tr>;
}
