import type { AbilityGap,PairScope } from "../types/complementarity";
import type { TestScope } from "./typeSelection";
import { RAW_METHODS,rawGain,type RawAggregate,type RawReference } from "./typeSelectionNoCalibration";
export const CAL_POOL_PATH=`${import.meta.env.BASE_URL}data/type-selection-calibrated-pooling/`;
export type CalibrationStage="input"|"output";
export interface CalAggregate extends RawAggregate { raw_brier:number[]|null;raw_ece:number[]|null;calibration_wins:number[]|null }
export interface CalDirection { split:number;fold:number;stages:Record<CalibrationStage,Record<TestScope,CalAggregate>> }
export interface CalView { key:string;gap:AbilityGap;coverage:number;pair_scope:PairScope;primary:CalDirection;directions:CalDirection[] }
export interface CalIndex { schema_version:1;date:string;exploratory:boolean;stages:CalibrationStage[];methods:string[];method_labels:string[];fixed_methods:number[];learned_methods:number[];views:string[];
  audit:{status:string;pair_directions:number;primary_pairs:number;independent_pairs:number;calibrator_fits:number;max_independent_error:number;max_parent_score_error:number;max_parent_calibrated_selection_error:number;max_gradient:number;input_nonpositive_slopes:number;output_nonpositive_slopes:number} }
export {rawGain as calibratedGain};
export function calibrationGain(row:CalAggregate,method:number):number|null {
  return row.raw_brier&&row.brier?row.raw_brier[method]-row.brier[method]:null;
}
export function calibratedDirections(view:CalView,stage:CalibrationStage,scope:TestScope,method:number,reference:RawReference){
  const defined=view.directions.filter(d=>d.stages[stage][scope].pairs>0);
  return {positive:defined.filter(d=>(rawGain(d.stages[stage][scope],method,reference)??0)>1e-10).length,total:defined.length};
}
export async function loadCalibratedPooling(key:string,signal?:AbortSignal):Promise<{index:CalIndex;view:CalView}>{
  const responses=await Promise.all([fetch(`${CAL_POOL_PATH}index.json`,{signal}),fetch(`${CAL_POOL_PATH}views/${key}.json`,{signal})]);
  for(const r of responses)if(!r.ok)throw new Error(`Calibrated pooling results could not be loaded (${r.status}).`);
  const [index,view]=await Promise.all(responses.map(r=>r.json())) as [CalIndex,CalView];
  if(index.schema_version!==1||!index.exploratory||index.audit?.status!=="PASS"||index.methods?.join("|")!==RAW_METHODS.join("|")||index.stages?.join("|")!=="input|output"||!index.views?.includes(key)||view.key!==key||view.directions?.length!==10||![view.primary,...view.directions].every(d=>["input","output"].every(s=>["all","complementary"].every(t=>!!d?.stages?.[s as CalibrationStage]?.[t as TestScope]))))
    throw new Error("Calibrated pooling results failed the published data contract.");
  return {index,view};
}
