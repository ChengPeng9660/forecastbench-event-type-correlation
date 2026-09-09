import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const read=(p:string)=>JSON.parse(readFileSync(resolve('public/data/multi-model-aggregation',p),'utf8'));
const index=read('index.json'),four=index.groups.find((g:any)=>g.models.length===4),record=read(`teams/${four.id.slice(2,4)}.json`)[four.id];
const key=(p:number[])=>[...p].sort((a,b)=>a-b).join(',');
const selectedUrl=(hash='complementarity')=>`/?cc_result=multi&cc_team_size=4&cc_team_path=${four.paths[0].join(',')}&cc_base=${encodeURIComponent(index.models[four.paths[0][0]])}&cc_test_scope=complementary#${hash}`;

async function checkRows(block:any,path:number[],team:any,scope:string,mode:string){
 const b=mode==='calibrated'?1:0,m=mode==='calibrated'?2:3,rows=block.getByTestId('mm-results').locator('tbody tr');
 await expect(rows).toHaveCount(path.length-1);
 for(let n=2;n<=path.length;n++){
  const current=team.subsets[key(path.slice(0,n))].scopes[scope];
  await expect(rows.nth(n-2).locator('td').nth(0)).toHaveText(current.brier[b].toFixed(6));
  await expect(rows.nth(n-2).locator('td').nth(1)).toHaveText(current.brier[m].toFixed(6));
  await expect(block.getByTestId('mm-support')).toContainText(`${current.events.toLocaleString()} test events`);
  await expect(block.getByTestId('mm-support')).toContainText(`${current.targets.toLocaleString()} test targets`);
 }
}

test('model-count growth uses matched complementary support in both calibration modes',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(selectedUrl());
 const block=page.locator('#complementarity');
 await expect(block.getByRole('button',{name:'2–4 models',exact:true})).toHaveCount(0);
 await expect(block.getByTestId('mm-explorer')).toContainText('Every model has a specialty');
 await expect(block.getByTestId('ad-test-scope-label')).toHaveCount(0);
 await expect(block.getByText('Pooling methods',{exact:true})).toHaveCount(0);
 await expect(block.getByRole('button',{name:'All test events',exact:true})).toHaveCount(0);
 await expect(block.locator('.mm-context')).not.toContainText('Post-hoc');
 for(const [mode,label] of [['calibrated','Match + calibrate'],['raw','Match only · no calibration']]){
  await block.getByRole('button',{name:label,exact:true}).click();await checkRows(block,four.paths[0],record,'complementary',mode);
 }
 await block.getByRole('button',{name:'Match + calibrate',exact:true}).click();
 await block.getByText('Type specialists',{exact:true}).click();
 for(const id of four.models)await expect(block.locator('.mm-specialists')).toContainText(index.models[id]);
 await block.getByTestId('mm-chart').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('model-count-explorer.png')});
 await page.reload();await checkRows(block,four.paths[0],record,'complementary','calibrated');
 const widths=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(widths[0]).toBeLessThanOrEqual(widths[1]+1);expect(errors).toEqual([]);
});

test('changing inclusion order and final team rebinds every score, and pair view retains row six',async({page})=>{
 await page.goto(selectedUrl());const block=page.locator('#complementarity');
 await expect(block.getByTestId('mm-results').locator('tbody tr')).toHaveCount(3);
 const alternatives=await block.getByLabel('Team model 2',{exact:true}).locator('option').evaluateAll(o=>o.map(x=>(x as HTMLOptionElement).value));
 const next=alternatives.find(v=>Number(v)!==four.paths[0][1]);expect(next).toBeTruthy();
 await block.getByLabel('Team model 2',{exact:true}).selectOption(next!);
 const path=(new URL(page.url()).searchParams.get('cc_team_path')??'').split(',').map(Number);
 const team=index.groups.find((g:any)=>key(g.models)===key(path));const data=read(`teams/${team.id.slice(2,4)}.json`)[team.id];
 await checkRows(block,path,data,'complementary','calibrated');
 await block.getByLabel('Number of models',{exact:true}).selectOption('3');await expect(block.getByTestId('mm-results').locator('tbody tr')).toHaveCount(2);
 await block.getByLabel('Number of models',{exact:true}).selectOption('2');await expect(block.getByTestId('mm-results').locator('tbody tr')).toHaveCount(1);
 await block.getByRole('button',{name:'Overall evidence',exact:true}).click();await expect(block.getByTestId('ad-main-table').locator('tbody tr')).toHaveCount(7);
 await expect(block.getByRole('button',{name:'2–4 models',exact:true})).toHaveCount(0);
 const legacy=new URL(page.url());legacy.searchParams.set('cc_result','multi');await page.goto(legacy.href);
 await expect(block.getByLabel('Number of models',{exact:true})).toHaveValue('2');
});

test('market base stays linked to the model-count explorer and missing teams remain explicit',async({page})=>{
 await page.goto(selectedUrl('market-performance'));const block=page.locator('#market-type-selection');
 await expect(block.locator('.ad-fixed-base')).toContainText(index.models[four.paths[0][0]]);
 await expect(block.getByLabel('Team base model',{exact:true})).toHaveCount(0);await checkRows(block,four.paths[0],record,'complementary','calibrated');
 const noFour=index.groups.find((g:any)=>g.models.length===2&&!index.groups.some((h:any)=>h.models.length===4&&h.models.includes(g.models[0]))).models[0];
 await page.goto(`/?cc_result=multi&cc_team_size=4&cc_base=${encodeURIComponent(index.models[noFour])}#complementarity`);
 await expect(page.getByRole('status')).toContainText('No eligible 4-model team');await expect(page.getByTestId('mm-results')).toHaveCount(0);
 await page.getByLabel('Team base model',{exact:true}).selectOption(String(four.paths[0][0]));await expect(page.getByTestId('mm-results').locator('tbody tr')).toHaveCount(3);
});

test('failed model-count loading can be retried',async({page})=>{
 let fail=true;await page.route('**/multi-model-aggregation/index.json',async route=>{if(fail)await route.fulfill({status:503,body:'Unavailable'});else await route.continue();});
 await page.goto(selectedUrl());await expect(page.getByRole('alert')).toContainText('503');await expect(page.getByTestId('mm-results')).toHaveCount(0);
 fail=false;await page.getByRole('button',{name:'Retry model-count explorer',exact:true}).click();await expect(page.getByTestId('mm-results').locator('tbody tr')).toHaveCount(3);
});
