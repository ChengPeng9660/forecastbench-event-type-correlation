import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {expectPoolingComparison} from "./pooling-comparison-check";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data",p),"utf8"));
const index=read("aggregation-stability/index.json"),view=read("aggregation-stability/views/gap3-coverage50-all.json");
const loadPair=(id:string)=>read(`aggregation-stability/pairs/${id.slice(2,4)}.json`)[id];
const eligible=(p:any)=>p.train_gap<=3+1e-12&&p.train_coverage>=.5;
const stable=index.pairs.find((p:any)=>eligible(p)&&p.stability==="no_reversal");
const reversed=loadPair("p-8ff6126fb390");

test("defaults to non-reversing complementary pairs and recomputes each pooled comparator",async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/#complementarity");
  const section=page.locator("#complementarity"),group=section.getByLabel("Complementary-pair group",{exact:true});
  await expect(group).toHaveValue("stable");
  await expect(section.getByTestId("ad-posthoc-label")).toHaveText("Post-hoc · test-defined groups");
  for(const cohort of ["stable","fallback","all"]){
    await group.selectOption(cohort);
    const expected=view.cohorts[cohort].primary.scopes;
    await expect(section.getByTestId("ad-context")).toContainText(`${expected.all.pairs.toLocaleString()} model pairs`);
    const disclosure=section.getByText("Pooling methods",{exact:true}).locator("..");
    if(!await disclosure.evaluate(el=>(el as HTMLDetailsElement).open))await section.getByText("Pooling methods",{exact:true}).click();
    for(const [scope,label] of [["all","All test events"],["complementary","Complementary events only"]]){
      await section.getByRole("button",{name:label,exact:true}).click();
      await expect(section.getByTestId("ad-main-table").locator("tbody tr").first()).toContainText(expected[scope].brier[0].toFixed(6));
      for(const [mode,label] of [["raw","No calibration"],["input","Calibrate models → pool"],["output","Pool → calibrate output"]]){
        await section.getByRole("group",{name:"Supporting pooling pipeline",exact:true}).getByRole("button",{name:label,exact:true}).click();
        await section.getByLabel("Pooling table sort order",{exact:true}).selectOption("brier");
        await expectPoolingComparison(section.getByTestId("ad-pool-table"),expected[scope].pools[mode].brier,true);
      }
    }
  }
  await group.selectOption("stable");await page.reload();
  await expect(group).toHaveValue("stable");
  await page.screenshot({path:testInfo.outputPath("stable-complementary-overall.png")});
  expect(errors).toEqual([]);
  const widths=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(widths[0]).toBeLessThanOrEqual(widths[1]+1);
});

test("a reversed complementary pair is excluded by default and can be opened with train-overall fallback",async({page},testInfo)=>{
  await page.goto(`/?cc_result=pair&cc_pair=${reversed.id}&cc_base=${encodeURIComponent(reversed.model_a)}&cc_test_scope=complementary#complementarity`);
  const section=page.locator("#complementarity"),table=section.getByTestId("ad-pair-main-table");
  await expect(section.getByTestId("ad-pair-results")).toHaveCount(0);
  await expect(section.getByRole("status")).toContainText("a type reversal");
  await section.getByRole("button",{name:"View this pair with overall fallback",exact:true}).click();
  await expect(section.getByLabel("Complementary-pair group",{exact:true})).toHaveValue("fallback");
  await expect(section.getByLabel("Partner model",{exact:true})).toHaveValue(reversed.id);
  await expect(section.getByTestId("ad-stability-status")).toContainText(`Training-overall model: ${reversed.model_a}`);
  await expect(table.locator("tbody tr").first()).toContainText("Overall selection (train)");
  await expect(table.locator("tbody tr").first()).toContainText(reversed.scopes.complementary.single_brier[0].toFixed(6));
  await section.getByText("Pooling methods",{exact:true}).click();
  for(const [mode,label] of [["raw","No calibration"],["input","Calibrate models → pool"],["output","Pool → calibrate output"]]){
    await section.getByRole("group",{name:"Pair pooling pipeline",exact:true}).getByRole("button",{name:label,exact:true}).click();
    await expectPoolingComparison(section.getByTestId("ad-pair-pool-table"),reversed.scopes.complementary.pools[mode].brier);
  }
  await section.getByText("Event-type selections",{exact:true}).click();
  const health=section.getByTestId("ad-pair-routes").getByRole("row").filter({hasText:"Health"});
  await expect(health).toContainText("Reversed");await expect(health).toContainText("29");
  await section.getByTestId("ad-stability-status").scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("reversed-overall-fallback.png")});
  await page.reload();await expect(table.locator("tbody tr").first()).toContainText("0.198036");
  await expect(page).toHaveURL(/cc_stability=fallback/);
});

test("no-reversal partner options contain only complementary pairs whose type edges remain unflipped",async({page})=>{
  await page.goto(`/?cc_result=pair&cc_pair=${stable.id}&cc_base=${encodeURIComponent(stable.model_a)}#complementarity`);
  const section=page.locator("#complementarity");
  const partners=index.pairs.filter((p:any)=>eligible(p)&&p.stability==="no_reversal"&&(p.model_a===stable.model_a||p.model_b===stable.model_a));
  await expect(section.getByLabel("Partner model",{exact:true}).locator("option")).toHaveCount(partners.length+1);
  await expect(section.getByTestId("ad-stability-status")).toContainText("No type reversals");
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
  await expect(block.getByLabel("Complementary-pair group",{exact:true})).toHaveValue("stable");
  await expect(block.locator(".ad-pair-view")).toHaveAttribute("data-base-configuration",base.exact_configuration);
  const ids=await block.getByLabel("Partner model",{exact:true}).locator("option").evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).filter(Boolean));
  expect(ids.length).toBeGreaterThan(0);
  for(const id of ids)expect(loadPair(id).stability).toBe("no_reversal");
  await block.getByLabel("Partner model",{exact:true}).selectOption(ids[0]);
  await expect(block.getByTestId("ad-stability-status")).toContainText("No type reversals");
  await expect(block.getByTestId("ad-base-ability")).toContainText(base.model.raw_brier.toFixed(6));
  await block.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("market-stable-pairs.png")});
  await expect(page).toHaveURL(/#market-performance$/);
});

test("stability data failures support retry without displaying older scores",async({page})=>{
  let fail=true;
  await page.route("**/aggregation-stability/views/gap3-coverage50-all.json",async route=>{if(fail)await route.fulfill({status:503,body:"Unavailable"});else await route.continue();});
  await page.goto("/#complementarity");
  await expect(page.getByRole("alert")).toContainText("503");await expect(page.getByTestId("ad-main-table")).toHaveCount(0);
  fail=false;await page.getByRole("button",{name:"Retry aggregation verdict",exact:true}).click();
  await expect(page.getByTestId("ad-context")).toContainText(`${view.cohorts.stable.primary.scopes.all.pairs.toLocaleString()} model pairs`);
});
