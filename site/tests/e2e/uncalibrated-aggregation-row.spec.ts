import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const read=(path:string)=>JSON.parse(readFileSync(resolve("public/data",path),"utf8"));
const index=read("type-selection-mechanisms/index.json");
const methods=["simple_mean","log_odds_mean","ec_w0_56","piecewise_odds"];
const id="p-8ff6126fb390",pair=read("aggregation-decision-pairs/pairs/8f.json")[id];
const signed=(value:number)=>`${value>0?"+":""}${value.toFixed(6)}`;

test("fifth row uses the four raw formulas and the raw selection comparator for every scope",async({page})=>{
  await page.goto("/?cc_stability=original#complementarity");
  const block=page.locator("#complementarity"),row=block.getByTestId("ad-uncalibrated-row");
  await expect(block.getByTestId("ad-main-table").locator("tbody tr")).toHaveCount(6);
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("simple_mean");
  await block.getByText("ECE & downloads",{exact:true}).click();
  for(const scope of ["all","complementary"]){
    await block.getByRole("button",{name:scope==="all"?"All test events":"Complementary events only",exact:true}).click();
    const scores=read("type-selection-mechanisms/views/gap3-coverage50-all.json").primary.scopes[scope];
    const joint=read("type-selection-no-calibration/views/gap3-coverage50-all.json").primary.scopes[scope];
    const firstFour=await block.getByTestId("ad-main-table").locator("tbody tr").evaluateAll(rows=>rows.slice(0,4).map(r=>r.textContent));
    for(const method of methods){
      await row.getByLabel("Uncalibrated aggregation method").selectOption(method);
      const m=index.methods.indexOf(method),gain=scores.brier[0]-scores.brier[m];
      await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(scores.brier[m].toFixed(6));
      await expect(row.getByTestId("ad-uncalibrated-gain")).toContainText(signed(gain));
      await expect(row.getByTestId("ad-uncalibrated-gain")).toContainText(`${(100*Math.abs(gain)/scores.brier[0]).toFixed(2)}%`);
      await expect(block.locator(".ad-ece-table tbody tr").nth(4)).toContainText(scores.ece[m].toFixed(6));
      await expect(block.getByTestId("ad-uncalibrated-joint-row").locator("td").last()).toHaveText(joint.brier[7].toFixed(6));
      await expect(block.locator(".ad-ece-table tbody tr").last()).toContainText(joint.ece[7].toFixed(6));
      expect(await block.getByTestId("ad-main-table").locator("tbody tr").evaluateAll(rows=>rows.slice(0,4).map(r=>r.textContent))).toEqual(firstFour);
    }
  }
  await block.getByText("Change study scope",{exact:true}).click();
  await block.getByLabel("Verdict training ability gap",{exact:true}).selectOption("5");
  const changed=read("type-selection-mechanisms/views/gap5-coverage50-all.json").primary.scopes.complementary;
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(changed.brier[index.methods.indexOf("piecewise_odds")].toFixed(6));
  await page.reload();
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("piecewise_odds");
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(changed.brier[index.methods.indexOf("piecewise_odds")].toFixed(6));
});

test("market pair fifth row stays uncalibrated across partner and test scope changes",async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/?cc_stability=original&cc_base=${encodeURIComponent(pair.model_a)}&cc_pair=${id}&cc_raw_method=ec_w0_56#market-performance`);
  const block=page.locator("#market-type-selection"),row=block.getByTestId("ad-uncalibrated-row");
  await expect(block.getByTestId("ad-pair-main-table").locator("tbody tr")).toHaveCount(6);
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("ec_w0_56");
  for(const scope of ["all","complementary"]){
    await block.getByRole("button",{name:scope==="all"?"All test events":"Complementary events only",exact:true}).click();
    for(const method of methods){
      await row.getByLabel("Uncalibrated aggregation method").selectOption(method);
      const m=index.methods.indexOf(method),scores=pair.scopes[scope];
      await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(scores.brier[m].toFixed(6));
      await expect(row.getByTestId("ad-uncalibrated-gain")).toContainText(signed(scores.brier[0]-scores.brier[m]));
      await expect(block.getByTestId("ad-uncalibrated-joint-row").locator("td").last()).toHaveText(scores.pools.raw.brier[7].toFixed(6));
      await expect(block.getByTestId("ad-pair-main-table").locator("tbody tr").nth(3)).toContainText(scores.brier[7].toFixed(6));
    }
  }
  await expect(block.getByTestId("ad-pair-effect")).toContainText("1.27%");
  await block.getByText("Pooling methods",{exact:true}).click();
  await block.getByRole("button",{name:"Calibrate models → pool",exact:true}).click();
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(pair.scopes.complementary.brier[4].toFixed(6));
  await block.getByText("Pooling methods",{exact:true}).click();
  await block.getByRole("button",{name:"Previous partner",exact:false}).click();
  const partner=await block.getByLabel("Partner model",{exact:true}).inputValue();
  const changed=read(`aggregation-decision-pairs/pairs/${partner.slice(2,4)}.json`)[partner];
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("piecewise_odds");
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(changed.scopes.complementary.brier[4].toFixed(6));
  await expect(block.getByTestId("ad-uncalibrated-joint-row").locator("td").last()).toHaveText(changed.scopes.complementary.pools.raw.brier[7].toFixed(6));
  await block.getByLabel("Partner model",{exact:true}).selectOption(id);
  await row.getByLabel("Uncalibrated aggregation method").selectOption("simple_mean");
  await page.reload();
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("simple_mean");
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText("0.190222");
  await expect(page).toHaveURL(/#market-performance$/);
  await block.getByTestId("ad-pair-main-table").screenshot({path:testInfo.outputPath("six-pipeline-rows.png")});
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);expect(errors).toEqual([]);
});

test("invalid raw method values return to the fixed simple mean",async({page})=>{
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${id}&cc_raw_method=joint_model#complementarity`);
  const row=page.getByTestId("ad-uncalibrated-row");
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("simple_mean");
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(pair.scopes.all.brier[1].toFixed(6));
  await expect(row.getByTestId("ad-uncalibrated-gain")).toContainText("higher");
  await row.getByLabel("Uncalibrated aggregation method").selectOption("log_odds_mean");
  await page.getByRole("button",{name:"Overall evidence",exact:true}).click();
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("log_odds_mean");
  await page.getByRole("button",{name:"One model pair",exact:true}).click();
  await expect(row.getByLabel("Uncalibrated aggregation method")).toHaveValue("log_odds_mean");
  await expect(row.getByTestId("ad-uncalibrated-score")).toHaveText(pair.scopes.all.brier[2].toFixed(6));
});
