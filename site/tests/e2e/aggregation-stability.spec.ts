import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data",p),"utf8"));
const index=read("aggregation-stability/index.json"),view=read("aggregation-stability/views/gap3-coverage50-all.json");
const typewise=read("typewise-matched-aggregation/views/gap3-coverage50-all.json");
const loadPair=(id:string)=>read(`aggregation-stability/pairs/${id.slice(2,4)}.json`)[id];
const eligible=(p:any)=>p.train_gap<=3+1e-12&&p.train_coverage>=.5;
const stable=index.pairs.find((p:any)=>eligible(p)&&p.stability==="no_reversal");
const reversed=loadPair("p-8ff6126fb390");

test("defaults to non-reversing complementary pairs without focused scope metadata",async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/#complementarity");
  const section=page.locator("#complementarity");
  await expect(section.getByTestId("ad-cohort-label")).toHaveCount(0);
  await expect(section.getByTestId("ad-main-table").locator("tbody tr")).toHaveCount(7);
  await expect(section.getByTestId("ad-posthoc-label")).toHaveCount(0);
  await expect(section.getByTestId("ad-test-scope-label")).toHaveCount(0);
  await expect(section.getByTestId("ad-context")).toHaveCount(0);
  await expect(section.getByText("Pooling methods",{exact:true})).toHaveCount(0);
  for(const cohort of ["stable","fallback","all","original"]){
    await page.goto(`/?cc_stability=${cohort}&cc_test_scope=all#complementarity`);
    await expect(page).toHaveURL(/cc_stability=stable/);
    await expect(page).toHaveURL(/cc_test_scope=complementary/);
    await expect(section.getByTestId("ad-cohort-label")).toHaveCount(0);
    await expect(section.getByLabel("Complementary-pair group",{exact:true})).toHaveCount(0);
    const expected=view.cohorts.stable.primary.scopes;
    await expect(section.getByTestId("ad-main-table").locator("tbody tr")).toHaveCount(7);
    await expect(section.getByTestId("ad-event-type-joint-row")).toHaveCount(1);
    await expect(section.getByTestId("ad-event-type-unavailable")).toHaveCount(0);
    await expect(section.getByTestId("ad-context")).toHaveCount(0);
    await expect(section.getByText("Pooling methods",{exact:true})).toHaveCount(0);
    const eventType=typewise.cohorts.no_reversal.primary.scopes.complementary;
    await expect(section.getByTestId("ad-event-type-joint-brier")).toHaveText(eventType.brier[2].toFixed(6));
    await expect(section.getByTestId("ad-event-type-joint-ece")).toHaveText(eventType.ece[2].toFixed(6));
    await expect(section.getByTestId("ad-main-table").locator("tbody tr").first()).toContainText(expected.complementary.brier[0].toFixed(6));
    await expect(section.getByTestId("ad-uncalibrated-joint-brier")).toHaveText(expected.complementary.pools.raw.brier[7].toFixed(6));
    await expect(section.getByTestId("ad-uncalibrated-joint-ece")).toHaveText(expected.complementary.pools.raw.ece[7].toFixed(6));
  }
  await page.reload();
  await expect(section.getByTestId("ad-cohort-label")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("stable-complementary-overall.png")});
  expect(errors).toEqual([]);
  const widths=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(widths[0]).toBeLessThanOrEqual(widths[1]+1);
});

test("a reversed pair stays hidden through old cohort links and can switch to an eligible partner",async({page},testInfo)=>{
  const section=page.locator("#complementarity"),table=section.getByTestId("ad-pair-main-table");
  for(const cohort of ["fallback","all","original"]){
    await page.goto(`/?cc_stability=${cohort}&cc_result=pair&cc_pair=${reversed.id}&cc_base=${encodeURIComponent(reversed.model_a)}&cc_test_scope=complementary#complementarity`);
    await expect(page).toHaveURL(/cc_stability=stable/);
    await expect(page).toHaveURL(/cc_test_scope=complementary/);
    await expect(section.getByTestId("ad-pair-results")).toHaveCount(0);
    await expect(section.getByRole("status")).toContainText("outside the No reversals group");
    await expect(section.getByRole("button",{name:"View this pair with overall fallback",exact:true})).toHaveCount(0);
    await expect(section.getByLabel("Partner model",{exact:true}).locator(`option[value="${reversed.id}"]`)).toHaveCount(0);
  }
  const partner=await section.getByLabel("Partner model",{exact:true}).locator("option").evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).find(Boolean)!);
  const expected=loadPair(partner);
  await section.getByLabel("Partner model",{exact:true}).selectOption(partner);
  await expect(section.getByTestId("ad-stability-status")).toHaveCount(0);
  await expect(section.getByTestId("ad-pair-main-table")).toBeVisible();
  await expect(table.locator("tbody tr").first()).toContainText(expected.scopes.complementary.brier[0].toFixed(6));
  await page.reload();
  await expect(section.getByTestId("ad-stability-status")).toHaveCount(0);
  await expect(section.getByTestId("ad-pair-main-table")).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath("no-reversal-pair-recovery.png")});
});

test("no-reversal partner options contain only complementary pairs whose type edges remain unflipped",async({page})=>{
  await page.goto(`/?cc_result=pair&cc_pair=${stable.id}&cc_base=${encodeURIComponent(stable.model_a)}#complementarity`);
  const section=page.locator("#complementarity");
  const partners=index.pairs.filter((p:any)=>eligible(p)&&p.stability==="no_reversal"&&(p.model_a===stable.model_a||p.model_b===stable.model_a));
  await expect(section.getByLabel("Partner model",{exact:true}).locator("option")).toHaveCount(partners.length+1);
  await expect(section.getByTestId("ad-stability-status")).toHaveCount(0);
  await expect(section.getByTestId("ad-pair-main-table")).toBeVisible();
  await expect(section.getByTestId("ad-pair-main-table").locator("tbody tr").first()).toContainText("Type-based selection");
  const available=await section.getByLabel("Partner model",{exact:true}).locator("option").evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).filter(Boolean));
  expect(available.sort()).toEqual(partners.map((p:any)=>p.id).sort());
});

test("market chart selection keeps the base and restricts partners to no reversals",async({page},testInfo)=>{
  const market=read("polymarket-aggregation/market-diversity-performance.json");
  const base=market.points.find((m:any)=>m.diversity.prediction_diversity!=null&&index.pairs.some((p:any)=>eligible(p)&&p.stability==="no_reversal"&&(p.model_a===m.exact_configuration||p.model_b===m.exact_configuration)));
  await page.goto("/#market-performance");
  const marker=page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(base.exact_configuration)}]`);
  await marker.focus();await marker.press("Enter");
  const block=page.locator("#market-type-selection");
  await expect(block.getByTestId("ad-cohort-label")).toHaveCount(0);
  await expect(block.locator(".ad-pair-view")).toHaveAttribute("data-base-configuration",base.exact_configuration);
  const ids=await block.getByLabel("Partner model",{exact:true}).locator("option").evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).filter(Boolean));
  expect(ids.length).toBeGreaterThan(0);
  for(const id of ids)expect(loadPair(id).stability).toBe("no_reversal");
  await block.getByLabel("Partner model",{exact:true}).selectOption(ids[0]);
  await expect(block.getByTestId("ad-stability-status")).toHaveCount(0);
  await expect(block.getByTestId("ad-base-ability")).toHaveCount(0);
  await expect(block.getByTestId("ad-uncalibrated-joint-brier")).toHaveText(loadPair(ids[0]).scopes.complementary.pools.raw.brier[7].toFixed(6));
  await expect(block.getByTestId("ad-uncalibrated-joint-ece")).toHaveText(loadPair(ids[0]).scopes.complementary.pools.raw.ece[7].toFixed(6));
  await block.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("market-stable-pairs.png")});
  await expect(page).toHaveURL(/#market-performance$/);
});

test("stability data failures support retry without displaying older scores",async({page})=>{
  let fail=true;
  await page.route("**/aggregation-stability/views/gap3-coverage50-all.json",async route=>{if(fail)await route.fulfill({status:503,body:"Unavailable"});else await route.continue();});
  await page.goto("/#complementarity");
  await expect(page.getByRole("alert")).toContainText("503");await expect(page.getByTestId("ad-main-table")).toHaveCount(0);
  fail=false;await page.getByRole("button",{name:"Retry aggregation verdict",exact:true}).click();
  await expect(page.getByTestId("ad-main-table").locator("tbody tr")).toHaveCount(7);
});
