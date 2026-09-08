import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {expectPoolingComparison} from "./pooling-comparison-check";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data/aggregation-decision-pairs",p),"utf8"));
const id="p-feba1dc1f7ef",pair=read("pairs/fe.json")[id];

test("opens base and partner controls while retaining the exact raw scores",async({page},testInfo)=>{
  const requests:string[]=[],errors:string[]=[];
  page.on("request",r=>requests.push(r.url()));page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?cc_stability=original#complementarity");
  const section=page.locator("#complementarity");
  await expect(section.getByTestId("ad-effect")).toContainText("1.77%");
  expect(requests.some(u=>u.includes("/aggregation-decision-pairs/"))).toBe(false);
  await section.getByRole("button",{name:"One model pair",exact:true}).click();
  await section.getByLabel("Base model",{exact:true}).selectOption(pair.model_a);
  await section.getByLabel("Partner model",{exact:true}).selectOption(id);
  await expect(section.getByTestId("ad-pair-identities")).toContainText(pair.model_a);
  await expect(section.getByTestId("ad-pair-effect")).toContainText("Brier reduction");
  await expect(section.getByTestId("ad-pair-facts")).toContainText("+0.001134");
  await expect(section.getByTestId("ad-effect")).toHaveCount(0);
  const table=section.getByTestId("ad-pair-main-table");
  for(const m of [0,1,2,3,4])await expect(table).toContainText(pair.scopes.all.brier[m].toFixed(6));
  await expect(table).toContainText(pair.scopes.all.pools.raw.brier[7].toFixed(6));
  await expect(page).toHaveURL(new RegExp(`cc_pair=${id}`));
  await expect(section.locator("details[open]")).toHaveCount(0);
  await expect(section.locator(".ad-verdict,.ad-comparison-note,.ad-footnote,.ad-reading")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("base-partner-picker.png")});
  await section.getByRole("button",{name:"Complementary events only",exact:true}).click();
  for(const m of [0,1,2,3,4])await expect(table).toContainText(pair.scopes.complementary.brier[m].toFixed(6));
  await expect(table).toContainText(pair.scopes.complementary.pools.raw.brier[7].toFixed(6));
  await page.reload();await expect(table).toContainText(pair.scopes.complementary.pools.raw.brier[7].toFixed(6));
  expect(requests.some(u=>u.endsWith("primary-pair-diagnostics.json.gz")||u.includes("/complementarity/study.json"))).toBe(false);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);expect(errors).toEqual([]);
});

test("pins the base while browsing partners and orients both sides correctly",async({page})=>{
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${id}#complementarity`);
  const section=page.locator("#complementarity");
  await expect(section.getByTestId("ad-pair-results")).toBeVisible();
  await section.getByRole("button",{name:"Next partner →",exact:true}).click();
  const next=await section.getByLabel("Partner model",{exact:true}).inputValue();expect(next).not.toBe(id);
  await expect(section.getByLabel("Base model",{exact:true})).toHaveValue(pair.model_a);
  await expect(section.getByTestId("ad-pair-results")).toContainText(next);
  await section.getByLabel("Base model",{exact:true}).selectOption(pair.model_b);
  await section.getByLabel("Partner model",{exact:true}).selectOption(id);
  await expect(section.getByTestId("ad-pair-identities").locator("div").first()).toContainText(pair.model_b);
  await section.getByText("Event-type selections",{exact:true}).click();
  const first=section.getByTestId("ad-pair-routes").locator("tbody tr").first();
  await expect(first.locator("td").nth(1)).toHaveText(pair.routes[0].train_brier_b.toFixed(5));
  await expect(first.locator("td").nth(3)).toHaveText(pair.routes[0].selected===1?"Base":"Partner");
  await expect(section.getByTestId("ad-pair-main-table")).toContainText(pair.scopes.all.pools.raw.brier[7].toFixed(6));
  await section.getByText("Change study scope",{exact:true}).click();
  await section.getByLabel("Verdict model-pair scope",{exact:true}).selectOption("matched_conditions");
  await expect(section.getByTestId("ad-pair-results")).toHaveCount(0);
  await expect(section.getByRole("status")).toContainText(/outside the current filters|No eligible partners/);
  await expect(section.getByTestId("ad-effect")).toHaveCount(0);
  await section.getByRole("button",{name:"Overall evidence",exact:true}).click();
  await expect(section.getByTestId("ad-effect")).toContainText("1.60%");
});

test("pair pooling compares selection and four pools with persistent Brier sorting",async({page},testInfo)=>{
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${id}#complementarity`);
  const section=page.locator("#complementarity");
  await section.getByText("Pooling methods",{exact:true}).click();
  const table=section.getByTestId("ad-pair-pool-table"),sort=section.getByLabel("Pooling table sort order",{exact:true});
  await expectPoolingComparison(table,pair.scopes.all.pools.raw.brier);
  await sort.selectOption("brier");
  for(const [scope,scopeLabel] of [["all","All test events"],["complementary","Complementary events only"]]){
    await section.getByRole("button",{name:scopeLabel,exact:true}).click();
    for(const [mode,label] of [["raw","No calibration"],["input","Calibrate models → pool"],["output","Pool → calibrate output"]]){
      await section.getByRole("group",{name:"Pair pooling pipeline",exact:true}).getByRole("button",{name:label,exact:true}).click();
      await expectPoolingComparison(table,pair.scopes[scope].pools[mode].brier,true);
    }
  }
  await table.locator("..").locator("..").screenshot({path:testInfo.outputPath("pair-pooling-sorted.png")});
  await page.reload();await section.getByText("Pooling methods",{exact:true}).click();
  await expect(sort).toHaveValue("brier");await expectPoolingComparison(table,pair.scopes.complementary.pools.raw.brier,true);
  await sort.selectOption("method");await expectPoolingComparison(table,pair.scopes.complementary.pools.raw.brier);
  await section.getByText("Test directions",{exact:true}).click();
  await expect(section.getByTestId("ad-pair-directions").locator("tbody tr")).toHaveCount(pair.directions.filter((d:any)=>d.train_gap<=3+1e-12&&d.train_coverage>=.5).length);
  await section.getByText("Event-type selections",{exact:true}).click();
  await expect(section.getByTestId("ad-pair-routes").locator("tbody tr")).toHaveCount(pair.routes.length);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(width[0]).toBeLessThanOrEqual(width[1]+1);
});

test("pair data failure supports retry without stale scores",async({page})=>{
  let fail=true;
  await page.route("**/aggregation-decision-pairs/pairs/fe.json",async route=>{if(fail)await route.fulfill({status:503,body:"Unavailable"});else await route.continue();});
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${id}#complementarity`);
  const section=page.locator("#complementarity");
  await expect(section.getByRole("alert")).toContainText("503");
  await expect(section.getByTestId("ad-pair-results")).toHaveCount(0);
  fail=false;await section.getByRole("button",{name:"Retry selected pair",exact:true}).click();
  await expect(section.getByTestId("ad-pair-facts")).toContainText("+0.001134");
});
