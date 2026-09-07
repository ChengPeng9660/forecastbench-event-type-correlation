import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {expectPoolingComparison} from "./pooling-comparison-check";

test("leads legacy section links with the matched verdict and keeps details closed",async({page},testInfo)=>{
  const requests:string[]=[],errors:string[]=[];
  page.on("request",r=>requests.push(r.url()));page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?cc_stability=original&cc_section=type-selection-calibrated-pooling&type=finance_economics#complementarity");
  const section=page.locator("#complementarity");
  await expect(section.getByRole("heading",{level:1})).toHaveText("Selection vs aggregation");
  await expect(page.getByTestId("ad-effect")).toContainText("1.31%");
  await expect(page.getByTestId("ad-facts")).toContainText("+0.001889");
  await expect(page.getByTestId("ad-facts")).toContainText("89.1%");
  await expect(page.getByTestId("ad-main-table").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("ad-main-table")).toContainText("0.144590");
  await expect(page.getByTestId("ad-main-table")).toContainText("0.142701");
  await expect(section.locator("details[open]")).toHaveCount(0);
  await expect(page.locator("#type-selection-calibrated-pooling")).toHaveCount(0);
  await expect(page.getByLabel("Select exact model pair")).toHaveCount(0);
  expect(requests.some(u=>u.includes("/data/complementarity/study.json"))).toBe(false);
  expect(requests.some(u=>u.includes("/data/type-selection-calibrated-pooling/"))).toBe(false);
  await page.screenshot({path:testInfo.outputPath("aggregation-verdict-first-screen.png")});
  await page.getByRole("group",{name:"Aggregation verdict test scope",exact:true}).getByRole("button",{name:"Complementary events only",exact:true}).click();
  await expect(page.getByTestId("ad-effect")).toContainText("1.06%");
  await expect(page.getByTestId("ad-facts")).toContainText("79.6%");
  await expect(page.getByTestId("ad-main-table")).toContainText("0.139624");
  await expect(page).toHaveURL(/cc_test_scope=complementary/);
  await page.reload();await expect(page.getByTestId("ad-effect")).toContainText("1.06%");
  await page.getByRole("heading",{name:"Pipeline comparison",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath("aggregation-verdict-comparison.png")});
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);expect(errors).toEqual([]);
});

test("compares four pools with the matching selection and sorts every calibration mode",async({page},testInfo)=>{
  const read=(name:string)=>JSON.parse(readFileSync(resolve(`public/data/${name}/views/gap3-coverage50-all.json`),"utf8"));
  const raw=read("type-selection-no-calibration"),calibrated=read("type-selection-calibrated-pooling");
  await page.goto("/?cc_stability=original#complementarity");
  await page.getByText("Pooling methods",{exact:true}).click();
  const table=page.getByTestId("ad-pool-table"),sort=page.getByLabel("Pooling table sort order",{exact:true});
  for(const [scope,scopeLabel] of [["all","All test events"],["complementary","Complementary events only"]]){
    await page.getByRole("group",{name:"Aggregation verdict test scope",exact:true}).getByRole("button",{name:scopeLabel,exact:true}).click();
    for(const [mode,label] of [["raw","No calibration"],["input","Calibrate models → pool"],["output","Pool → calibrate output"]]){
      await page.getByRole("group",{name:"Supporting pooling pipeline",exact:true}).getByRole("button",{name:label,exact:true}).click();
      const brier=mode==="raw"?raw.primary.scopes[scope].brier:calibrated.primary.stages[mode][scope].brier;
      await sort.selectOption("method");await expectPoolingComparison(table,brier);
      await sort.selectOption("brier");await expectPoolingComparison(table,brier,true);
    }
  }
  await expect(page).toHaveURL(/cc_pool_sort=brier/);
  await table.locator("..").locator("..").screenshot({path:testInfo.outputPath("pooling-comparison-sorted.png")});
  await page.reload();await page.getByText("Pooling methods",{exact:true}).click();
  await expect(sort).toHaveValue("brier");await expectPoolingComparison(table,raw.primary.scopes.complementary.brier,true);
  await page.getByText("Test directions",{exact:true}).click();
  await expect(page.locator(".ad-direction-table tbody tr")).toHaveCount(10);
  await page.getByText("ECE & downloads",{exact:true}).click();
  await expect(page.getByRole("link",{name:"Matched comparison report ↗",exact:true})).toHaveAttribute("href",/type-selection-mechanisms\/REPORT.md$/);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);
});

test("preserves training filters and makes the full explorer reachable",async({page})=>{
  await page.goto("/?cc_stability=original#complementarity");
  await page.getByText("Change study scope",{exact:true}).click();
  await page.getByLabel("Verdict training ability gap",{exact:true}).selectOption("5");
  await expect(page.getByTestId("ad-context")).toContainText("2,805 model pairs");
  await page.getByLabel("Verdict training ability gap",{exact:true}).selectOption("3");
  await page.getByLabel("Verdict model-pair scope",{exact:true}).selectOption("matched_conditions");
  await expect(page.getByTestId("ad-context")).toContainText("624 model pairs");
  await expect(page.getByTestId("ad-effect")).toContainText("1.11%");
  await page.getByRole("button",{name:"Open full research explorer →",exact:true}).click();
  await expect(page).toHaveURL(/cc_view=explorer/);
  await expect(page.getByLabel("Exact configuration pair scope",{exact:true})).toHaveValue("matched_conditions");
  await page.getByRole("button",{name:"← Back to the aggregation verdict",exact:true}).click();
  await expect(page.getByTestId("ad-context")).toContainText("624 model pairs");
  await expect(page.getByLabel("Select exact model pair")).toHaveCount(0);
});

test("recovers the verdict from a fetch failure",async({page})=>{
  let fail=true;
  await page.route("**/data/type-selection-mechanisms/views/gap3-coverage50-all.json",async route=>{
    if(fail){await route.fulfill({status:503,body:"Unavailable"});}else await route.continue();
  });
  await page.goto("/?cc_stability=original#complementarity");
  await expect(page.getByRole("alert")).toContainText("503");
  await expect(page.getByTestId("ad-effect")).toHaveCount(0);
  fail=false;
  await page.getByRole("button",{name:"Retry aggregation verdict",exact:true}).click();
  await expect(page.getByTestId("ad-effect")).toContainText("1.31%");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
