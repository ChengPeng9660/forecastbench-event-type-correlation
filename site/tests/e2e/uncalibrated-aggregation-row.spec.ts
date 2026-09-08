import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const read=(path:string)=>JSON.parse(readFileSync(resolve("public/data",path),"utf8"));
const index=read("type-selection-mechanisms/index.json");
const methods=["simple_mean","log_odds_mean","ec_w0_56","piecewise_odds"];
const labels:Record<string,string>={simple_mean:"Simple mean",log_odds_mean:"Log-odds mean",ec_w0_56:"EC · w = 0.56",piecewise_odds:"Piecewise odds"};
const signed=(value:number)=>`${value>0?"+":""}${value.toFixed(6)}`;
const marketId="p-cfe6642e611e",marketPair=read("aggregation-stability/pairs/cf.json")[marketId];
const featuredId="p-cfe6642e611e",featuredPair=read("aggregation-stability/pairs/cf.json")[featuredId];
const typewise=read("typewise-matched-aggregation/views/gap3-coverage50-all.json");

test("expands all four raw rules and removes the three calibrated rows",async({page})=>{
  await page.goto("/?cc_stability=original#complementarity");
  const block=page.locator("#complementarity"),table=block.getByTestId("ad-main-table");
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await expect(table.getByText("Calibrated selection",{exact:true})).toHaveCount(0);
  await expect(table.getByText("Strong single-forecast baseline",{exact:true})).toHaveCount(0);
  await expect(table.getByText("Matched aggregation",{exact:true})).toHaveCount(0);
  await expect(table.getByText("Uncalibrated aggregation",{exact:true})).toHaveCount(4);
  await expect(table.getByRole("columnheader",{name:"Forecasts / event",exact:true})).toHaveCount(0);
  await expect(table.getByRole("columnheader",{name:"Test ECE ↓",exact:true})).toBeVisible();
  await block.getByText("ECE & downloads",{exact:true}).click();
  for(const scope of ["all","complementary"]){
    await block.getByRole("button",{name:scope==="all"?"All test events":"Complementary events only",exact:true}).click();
    const scores=read("aggregation-stability/views/gap3-coverage50-all.json").cohorts.stable.primary.scopes[scope];
    const joint=scores.pools.raw;
    for(const method of methods){
      const m=index.methods.indexOf(method),row=block.getByTestId(`ad-uncalibrated-row-${method}`);
      await expect(row).toContainText(labels[method]);
      await expect(row.getByTestId(`ad-uncalibrated-score-${method}`)).toHaveText(scores.brier[m].toFixed(6));
      await expect(row.getByTestId(`ad-uncalibrated-ece-score-${method}`)).toHaveText(scores.ece[m].toFixed(6));
      await expect(row.getByTestId(`ad-uncalibrated-gain-${method}`)).toContainText(signed(scores.brier[0]-scores.brier[m]));
      await expect(row.getByTestId(`ad-uncalibrated-gain-${method}`)).toContainText(`${(100*Math.abs(scores.brier[0]-scores.brier[m])/scores.brier[0]).toFixed(2)}%`);
      await expect(block.getByTestId(`ad-uncalibrated-ece-${method}`)).toContainText(scores.ece[m].toFixed(6));
    }
    await expect(block.getByTestId("ad-uncalibrated-joint-brier")).toHaveText(joint.brier[7].toFixed(6));
    await expect(block.getByTestId("ad-uncalibrated-joint-ece")).toHaveText(joint.ece[7].toFixed(6));
    await expect(block.getByTestId("ad-uncalibrated-joint-gain")).toContainText(signed(joint.brier[0]-joint.brier[7]));
    const eventType=typewise.cohorts.no_reversal.primary.scopes[scope];
    await expect(block.getByTestId("ad-event-type-joint-brier")).toHaveText(eventType.brier[2].toFixed(6));
    await expect(block.getByTestId("ad-event-type-joint-ece")).toHaveText(eventType.ece[2].toFixed(6));
    await expect(block.getByTestId("ad-event-type-joint-gain")).toContainText(signed(eventType.brier[0]-eventType.brier[2]));
    await expect(block.getByTestId("ad-event-type-vs-global")).toContainText(`ECE ${signed(eventType.ece[1]-eventType.ece[2])}`);
    await expect(block.getByTestId("ad-event-type-ece-summary")).toContainText(eventType.ece[2].toFixed(6));
  }
  await block.getByText("Change study scope",{exact:true}).click();
  await block.getByLabel("Verdict training ability gap",{exact:true}).selectOption("5");
  const changed=read("aggregation-stability/views/gap5-coverage50-all.json").cohorts.stable.primary.scopes.complementary;
  for(const method of methods){
    const m=index.methods.indexOf(method);
    await expect(block.getByTestId(`ad-uncalibrated-score-${method}`)).toHaveText(changed.brier[m].toFixed(6));
    await expect(block.getByTestId(`ad-uncalibrated-ece-score-${method}`)).toHaveText(changed.ece[m].toFixed(6));
  }
  await page.reload();
  await expect(block.getByTestId("ad-uncalibrated-row-simple_mean")).toBeVisible();
  await expect(block.getByTestId("ad-uncalibrated-row-piecewise_odds")).toBeVisible();
  await expect(block.getByTestId("ad-event-type-joint-row")).toBeVisible();
});

test("shows the selected pair's complementary event types and specialist side",async({page},testInfo)=>{
  await page.goto(`/?cc_stability=stable&cc_result=pair&cc_pair=${featuredId}&cc_base=${encodeURIComponent(featuredPair.model_a)}&cc_test_scope=complementary#complementarity`);
  const block=page.locator("#complementarity"),types=block.getByTestId("ad-complementary-types"),table=block.getByTestId("ad-pair-main-table");
  await expect(types).toBeVisible();
  const complementary=featuredPair.routes.filter((route:any)=>route.complementary);
  await expect(types.getByTestId("ad-complementary-type")).toHaveCount(complementary.length);
  for(const route of complementary){
    const label=route.type==="health"?"Health":route.type==="politics"?"Politics":route.type;
    const chip=types.getByTestId("ad-complementary-type").filter({hasText:label});
    await expect(chip).toContainText(route.selected===0?"Base specialist":"Partner specialist");
  }
  await expect(types).toContainText("Health");
  await expect(types).toContainText("Politics");
  for(const method of methods){
    const m=index.methods.indexOf(method);
    await expect(table.getByTestId(`ad-uncalibrated-score-${method}`)).toHaveText(featuredPair.scopes.complementary.brier[m].toFixed(6));
    await expect(table.getByTestId(`ad-uncalibrated-ece-score-${method}`)).toHaveText(featuredPair.scopes.complementary.ece[m].toFixed(6));
  }
  await expect(table.getByTestId("ad-uncalibrated-joint-ece")).toHaveText(featuredPair.scopes.complementary.pools.raw.ece[7].toFixed(6));
  await types.screenshot({path:testInfo.outputPath("pair-complementary-event-types.png")});
});

test("market pair keeps every raw rule expanded across partner and scope changes",async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/?cc_stability=original&cc_base=${encodeURIComponent(marketPair.model_a)}&cc_pair=${marketId}&cc_raw_method=ec_w0_56#market-performance`);
  const block=page.locator("#market-type-selection"),table=block.getByTestId("ad-pair-main-table");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  for(const scope of ["all","complementary"]){
    await block.getByRole("button",{name:scope==="all"?"All test events":"Complementary events only",exact:true}).click();
    for(const method of methods){
      const m=index.methods.indexOf(method),scores=marketPair.scopes[scope];
      await expect(table.getByTestId(`ad-uncalibrated-score-${method}`)).toHaveText(scores.brier[m].toFixed(6));
      await expect(table.getByTestId(`ad-uncalibrated-ece-score-${method}`)).toHaveText(scores.ece[m].toFixed(6));
      await expect(table.getByTestId(`ad-uncalibrated-gain-${method}`)).toContainText(signed(scores.brier[0]-scores.brier[m]));
    }
  }
  const nextPartner=await block.getByLabel("Partner model",{exact:true}).locator("option").evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).find(value=>value&&value!=="p-cfe6642e611e")!);
  await block.getByLabel("Partner model",{exact:true}).selectOption(nextPartner);
  const partner=await block.getByLabel("Partner model",{exact:true}).inputValue();
  const changed=read(`aggregation-stability/pairs/${partner.slice(2,4)}.json`)[partner];
  for(const method of methods){
    const m=index.methods.indexOf(method);
    await expect(table.getByTestId(`ad-uncalibrated-score-${method}`)).toHaveText(changed.scopes.complementary.brier[m].toFixed(6));
    await expect(table.getByTestId(`ad-uncalibrated-ece-score-${method}`)).toHaveText(changed.scopes.complementary.ece[m].toFixed(6));
  }
  await table.screenshot({path:testInfo.outputPath("expanded-raw-pipeline-rows.png")});
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);expect(errors).toEqual([]);
});

test("legacy raw-method query values no longer collapse the four rules",async({page})=>{
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${marketId}&cc_raw_method=joint_model#complementarity`);
  const table=page.getByTestId("ad-pair-main-table");
  for(const method of methods)await expect(table.getByTestId(`ad-uncalibrated-row-${method}`)).toBeVisible();
  await expect(table.getByLabel("Uncalibrated aggregation method")).toHaveCount(0);
});
