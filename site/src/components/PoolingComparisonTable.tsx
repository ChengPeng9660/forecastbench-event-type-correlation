import {useEffect,useState} from "react";
import {score} from "../lib/complementarity";
import {writeDecisionQuery} from "../lib/aggregationDecisionPairs";

type SortOrder="method"|"brier";
const readSort=():SortOrder=>new URLSearchParams(location.search).get("cc_pool_sort")==="brier"?"brier":"method";

export function PoolingComparisonTable({brier,methodLabels,testId}:{brier:readonly number[]|null;methodLabels:readonly string[];testId:string}){
  const [sort,setSort]=useState(readSort);
  useEffect(()=>{
    const restore=()=>setSort(readSort());
    window.addEventListener("popstate",restore);window.addEventListener("hashchange",restore);
    return()=>{window.removeEventListener("popstate",restore);window.removeEventListener("hashchange",restore);};
  },[]);
  const methods=[0,2,3,4,5];
  if(sort==="brier")methods.sort((a,b)=>(brier?.[a]??Infinity)-(brier?.[b]??Infinity)||a-b);
  return <>
    <label className="ad-pool-sort">Sort by
      <select aria-label="Pooling table sort order" value={sort} onChange={event=>{
        const next=event.target.value as SortOrder;setSort(next);writeDecisionQuery({cc_pool_sort:next});
      }}><option value="method">Method order</option><option value="brier">Brier: low to high</option></select>
    </label>
    <div className="ad-table-scroll"><table className="ad-pool-table" data-testid={testId}>
      <thead><tr><th scope="col">Method</th><th scope="col" aria-sort={sort==="brier"?"ascending":undefined}>Brier ↓</th><th scope="col">Gain vs pipeline selection</th></tr></thead>
      <tbody>{methods.map(method=>{
        const gain=brier?brier[0]-brier[method]:null;
        return <tr key={method} className={method===0?"ad-pool-baseline":""}>
          <th scope="row">{method===0?"Pipeline selection":methodLabels[method]}</th>
          <td>{score(brier?.[method],6)}</td>
          <td className={gain==null||Math.abs(gain)<1e-10?"":gain>0?"ad-positive":"ad-negative"}>{method===0?"—":score(gain,6,true)}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </>;
}
