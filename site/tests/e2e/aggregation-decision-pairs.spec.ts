import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data/aggregation-decision-pairs",p),"utf8"));
const id="p-feba1dc1f7ef",pair=read("pairs/fe.json")[id];

test("opens exact pair scores on demand and preserves losing results",async({page},testInfo)=>{
  const requests:string[]=[],errors:string[]=[];
  page.on("request",r=>requests.push(r.url()));page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/#complementarity");
  await expect(page.getByTestId("ad-effect")).toContainText("1.31%");
  expect(requests.some(u=>u.includes("/aggregation-decision-pairs/"))).toBe(false);
  await page.getByRole("button",{name:"One model pair",exact:true}).click();
  await page.getByLabel("Verdict model pair",{exact:true}).selectOption(id);
  await expect(page.getByTestId("ad-pair-identities")).toContainText(pair.model_a);
  await expect(page.getByTestId("ad-pair-title")).toHaveText("Aggregation is worse for this pair.");
  await expect(page.getByTestId("ad-pair-effect")).toContainText("relative Brier increase");
  await expect(page.getByTestId("ad-pair-facts")).toContainText("-0.000238");
  await expect(page.getByTestId("ad-effect")).toHaveCount(0);
  const table=page.getByTestId("ad-pair-main-table");
  for(const m of [0,5,6,7])await expect(table).toContainText(pair.scopes.all.brier[m].toFixed(6));
  await expect(page).toHaveURL(new RegExp(`cc_pair=${id}`));
  await expect(page.locator("#complementarity details[open]")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("individual-pair-picker.png")});
  await page.getByRole("heading",{name:"How much does aggregation add?",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath("individual-pair-comparison.png")});
  await page.getByRole("button",{name:"Complementary events only",exact:true}).click();
  for(const m of [0,5,6,7])await expect(table).toContainText(pair.scopes.complementary.brier[m].toFixed(6));
  await page.reload();await expect(table).toContainText(pair.scopes.complementary.brier[7].toFixed(6));
  expect(requests.some(u=>u.endsWith("primary-pair-diagnostics.json.gz")||u.includes("/complementarity/study.json"))).toBe(false);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);expect(errors).toEqual([]);
  if(testInfo.project.name==="chromium"){
    await page.setViewportSize({width:1094,height:720});
    const middleWidth=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
    expect(middleWidth[0]).toBeLessThanOrEqual(middleWidth[1]+1);
  }
});

test("switches pairs and never substitutes overall means or a filtered-out pair",async({page})=>{
  await page.goto(`/?cc_result=pair&cc_pair=${id}#complementarity`);
  await expect(page.getByTestId("ad-pair-results")).toBeVisible();
  await page.getByRole("button",{name:"Next pair →",exact:true}).click();
  const next=await page.getByLabel("Verdict model pair",{exact:true}).inputValue();expect(next).not.toBe(id);
  await expect(page.getByTestId("ad-pair-results")).toContainText(next);
  await page.getByRole("button",{name:"← Previous pair",exact:true}).click();
  await expect(page.getByTestId("ad-pair-results")).toContainText(id);
  await page.getByLabel("Search model pairs",{exact:true}).fill("p-001112c40ea7");
  await page.getByLabel("Verdict model pair",{exact:true}).selectOption("p-001112c40ea7");
  await expect(page.getByTestId("ad-pair-results")).toContainText("p-001112c40ea7");
  await page.getByLabel("Search model pairs",{exact:true}).fill("");
  await page.getByLabel("Verdict model pair",{exact:true}).selectOption(id);
  await page.getByText("Change study scope",{exact:true}).click();
  await page.getByLabel("Verdict model-pair scope",{exact:true}).selectOption("matched_conditions");
  await expect(page.getByTestId("ad-pair-results")).toHaveCount(0);
  await expect(page.getByText("The selected pair is not eligible for the current training filters.",{exact:false})).toBeVisible();
  await expect(page.getByTestId("ad-effect")).toHaveCount(0);
  await page.getByRole("button",{name:"Overall evidence",exact:true}).click();
  await expect(page.getByTestId("ad-effect")).toContainText("1.11%");
});

test("pair supporting evidence uses exact scores in every pooling mode",async({page})=>{
  await page.goto(`/?cc_result=pair&cc_pair=${id}#complementarity`);
  await page.getByText("Compare pooling methods for this pair",{exact:true}).click();
  for(const [mode,label] of [["raw","No calibration"],["input","Calibrate models → pool"],["output","Pool → calibrate output"]]){
    await page.getByRole("group",{name:"Pair pooling pipeline",exact:true}).getByRole("button",{name:label,exact:true}).click();
    const table=page.getByTestId("ad-pair-pool-table");
    await expect(table.locator("tbody tr")).toHaveCount(8);
    await expect(table).toContainText(pair.scopes.all.pools[mode].brier[8].toFixed(6));
    const gain=pair.scopes.all.brier[6]-pair.scopes.all.pools[mode].brier[8];
    await expect(table).toContainText(`${gain>0?"+":""}${gain.toFixed(6)}`);
  }
  await page.getByText("Check this pair across test directions",{exact:true}).click();
  await expect(page.getByTestId("ad-pair-directions").locator("tbody tr")).toHaveCount(pair.directions.filter((d:any)=>d.train_gap<=3+1e-12&&d.train_coverage>=.5).length);
  await page.getByText("Which event types choose each model?",{exact:true}).click();
  await expect(page.getByTestId("ad-pair-routes").locator("tbody tr")).toHaveCount(pair.routes.length);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(width[0]).toBeLessThanOrEqual(width[1]+1);
});

test("pair data failure supports retry without showing stale scores",async({page})=>{
  let fail=true;
  await page.route("**/aggregation-decision-pairs/pairs/fe.json",async route=>{if(fail)await route.fulfill({status:503,body:"Unavailable"});else await route.continue();});
  await page.goto(`/?cc_result=pair&cc_pair=${id}#complementarity`);
  await expect(page.getByRole("alert")).toContainText("503");
  await expect(page.getByTestId("ad-pair-results")).toHaveCount(0);
  fail=false;await page.getByRole("button",{name:"Retry selected pair",exact:true}).click();
  await expect(page.getByTestId("ad-pair-title")).toHaveText("Aggregation is worse for this pair.");
});
