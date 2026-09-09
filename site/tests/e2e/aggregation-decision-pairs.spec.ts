import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>JSON.parse(readFileSync(resolve("public/data/aggregation-stability",p),"utf8"));
const id="p-feba1dc1f7ef",pair=read("pairs/fe.json")[id];

test("opens base and partner controls while retaining the exact raw scores",async({page},testInfo)=>{
  const requests:string[]=[],errors:string[]=[];
  page.on("request",r=>requests.push(r.url()));page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?cc_stability=original#complementarity");
  const section=page.locator("#complementarity");
  await expect(section.getByTestId("ad-effect")).toContainText("0.56%");
  expect(requests.some(u=>u.includes("/aggregation-decision-pairs/"))).toBe(false);
  await section.getByRole("button",{name:"One model pair",exact:true}).click();
  await section.getByLabel("Base model",{exact:true}).selectOption(pair.model_a);
  await section.getByLabel("Partner model",{exact:true}).selectOption(id);
  await expect(section.getByTestId("ad-pair-identities")).toContainText(pair.model_a);
  await expect(section.getByTestId("ad-pair-effect")).toContainText("Brier reduction");
  await expect(section.getByTestId("ad-pair-facts")).toContainText("+0.001430");
  await expect(section.getByTestId("ad-effect")).toHaveCount(0);
  const table=section.getByTestId("ad-pair-main-table");
  for(const m of [0,1,2,3,4])await expect(table).toContainText(pair.scopes.complementary.brier[m].toFixed(6));
  await expect(table).toContainText(pair.scopes.complementary.pools.raw.brier[7].toFixed(6));
  await expect(page).toHaveURL(new RegExp(`cc_pair=${id}`));
  await expect(section.locator("details[open]")).toHaveCount(0);
  await expect(section.locator(".ad-verdict,.ad-comparison-note,.ad-footnote,.ad-reading")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("base-partner-picker.png")});
  await expect(section.getByTestId("ad-test-scope-label")).toHaveCount(0);
  await expect(section.getByTestId("ad-cohort-label")).toHaveCount(0);
  await expect(section.getByTestId("ad-context")).toHaveCount(0);
  await expect(section.getByText("Pooling methods",{exact:true})).toHaveCount(0);
  await expect(section.locator("[data-testid=ad-pair-results] > .ad-pair-context")).toHaveCount(0);
  await expect(section.getByTestId("ad-stability-status")).toHaveCount(0);
  await expect(section.locator(".ad-pair-browse")).not.toContainText("eligible partners");
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
  const nextPair=read(`pairs/${next.slice(2,4)}.json`)[next];
  await expect(section.getByTestId("ad-pair-identities").locator("div").nth(1)).toContainText(nextPair.model_a===pair.model_a?nextPair.model_b:nextPair.model_a);
  await section.getByLabel("Base model",{exact:true}).selectOption(pair.model_b);
  await section.getByLabel("Partner model",{exact:true}).selectOption(id);
  await expect(section.getByTestId("ad-pair-identities").locator("div").first()).toContainText(pair.model_b);
  await section.getByText("Event-type selections",{exact:true}).click();
  const first=section.getByTestId("ad-pair-routes").locator("tbody tr").first();
  await expect(first.locator("td").nth(1)).toHaveText(pair.routes[0].train_brier_b.toFixed(5));
  await expect(first.locator("td").nth(3)).toHaveText(pair.routes[0].selected===1?"Base":"Partner");
  await expect(section.getByTestId("ad-pair-main-table")).toContainText(pair.scopes.complementary.pools.raw.brier[7].toFixed(6));
  await section.getByRole("button",{name:"Overall evidence",exact:true}).click();
  await expect(section.getByTestId("ad-effect")).toContainText("0.56%");
});

test("pair view omits pooling methods while retaining event-type evidence",async({page})=>{
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${id}#complementarity`);
  const section=page.locator("#complementarity");
  await expect(section.getByText("Pooling methods",{exact:true})).toHaveCount(0);
  await expect(section.getByTestId("ad-pair-pool-table")).toHaveCount(0);
  await expect(section.getByText("Test directions",{exact:true})).toHaveCount(0);
  await expect(section.getByTestId("ad-pair-directions")).toHaveCount(0);
  await section.getByText("Event-type selections",{exact:true}).click();
  await expect(section.getByTestId("ad-pair-routes").locator("tbody tr")).toHaveCount(pair.routes.length);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(width[0]).toBeLessThanOrEqual(width[1]+1);
});

test("pair data failure supports retry without stale scores",async({page})=>{
  let fail=true;
  await page.route("**/aggregation-stability/pairs/fe.json",async route=>{if(fail)await route.fulfill({status:503,body:"Unavailable"});else await route.continue();});
  await page.goto(`/?cc_stability=original&cc_result=pair&cc_pair=${id}#complementarity`);
  const section=page.locator("#complementarity");
  await expect(section.getByRole("alert")).toContainText("503");
  await expect(section.getByTestId("ad-pair-results")).toHaveCount(0);
  fail=false;await section.getByRole("button",{name:"Retry selected pair",exact:true}).click();
  await expect(section.getByTestId("ad-pair-facts")).toContainText("+0.001430");
});
