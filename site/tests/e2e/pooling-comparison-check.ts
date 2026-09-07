import {expect,type Locator} from "@playwright/test";

export async function expectPoolingComparison(table:Locator,brier:number[],sorted=false){
  const rows=[
    {label:"Pipeline selection",brier:brier[0],gain:null},
    {label:"Simple mean",brier:brier[2],gain:brier[0]-brier[2]},
    {label:"Log-odds mean",brier:brier[3],gain:brier[0]-brier[3]},
    {label:"EC · w = 0.56",brier:brier[4],gain:brier[0]-brier[4]},
    {label:"Piecewise odds",brier:brier[5],gain:brier[0]-brier[5]},
  ];
  if(sorted)rows.sort((a,b)=>a.brier-b.brier);
  await expect(table.locator("thead th")).toHaveText(["Method","Brier ↓","Gain vs pipeline selection"]);
  await expect(table.locator("tbody th")).toHaveText(rows.map(row=>row.label));
  for(const [i,row] of rows.entries()){
    await expect(table.locator("tbody tr").nth(i).locator("td")).toHaveText([
      row.brier.toFixed(6),row.gain===null?"—":`${row.gain>0?"+":""}${row.gain.toFixed(6)}`,
    ]);
  }
  const header=table.getByRole("columnheader",{name:"Brier ↓",exact:true});
  if(sorted)await expect(header).toHaveAttribute("aria-sort","ascending");
  else await expect(header).not.toHaveAttribute("aria-sort");
}
