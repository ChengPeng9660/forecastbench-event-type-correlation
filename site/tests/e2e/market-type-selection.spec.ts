import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {DecisionPairIndex,DecisionPair} from "../../src/lib/aggregationDecisionPairs";
import type {MarketDiversityPerformanceData} from "../../src/types/data";

const index=JSON.parse(readFileSync(resolve("public/data/aggregation-decision-pairs/index.json"),"utf8")) as DecisionPairIndex;
const market=JSON.parse(readFileSync(resolve("public/data/polymarket-aggregation/market-diversity-performance.json"),"utf8")) as MarketDiversityPerformanceData;
const filters={gap:3 as const,coverage:.5,pairScope:"all" as const,scope:"all" as const};
const pairsForBase=(pairs:DecisionPairIndex["pairs"],base:string,_filters:typeof filters)=>pairs.filter(p=>(p.model_a===base||p.model_b===base)&&p.train_gap<=3+1e-12&&p.train_coverage>=.5).sort((a,b)=>(a.model_a===base?a.model_b:a.model_a).localeCompare(b.model_a===base?b.model_b:b.model_a));
const pairBaseSide=(p:DecisionPair,base:string)=>p.model_a===base?0:1;
const available=market.points.filter(p=>pairsForBase(index.pairs,p.exact_configuration,filters).length>=2);
const bases=[available.find(p=>p.canonical_model_version.startsWith("GPT-5-"))!,available.find(p=>p.canonical_model_version.startsWith("Claude-3-5"))!];
const pair=(id:string):DecisionPair=>JSON.parse(readFileSync(resolve(`public/data/aggregation-decision-pairs/pairs/${id.slice(2,4)}.json`),"utf8"))[id];

test("the first market chart selects the base for the following experiment",async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?cc_stability=original#market-performance");
  const block=page.locator("#market-type-selection");
  for(const base of bases){
    expect(base).toBeTruthy();
    const marker=page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(base.exact_configuration)}]`);
    await marker.focus();await marker.press("Enter");
    await expect(block.locator(".ad-pair-view")).toHaveAttribute("data-base-configuration",base.exact_configuration);
    await expect(block.getByLabel("Base model",{exact:true})).toHaveCount(0);
    await expect(page.locator(".market-performance-inspector")).toContainText(base.canonical_model_version);
    const partners=pairsForBase(index.pairs,base.exact_configuration,filters);
    await expect(block.getByLabel("Partner model",{exact:true}).locator("option")).toHaveCount(partners.length+1);
    for(const chosen of partners.slice(0,2)){
      await block.getByLabel("Partner model",{exact:true}).selectOption(chosen.id);
      await expect(block.getByTestId("ad-uncalibrated-joint-brier")).toHaveText(pair(chosen.id).scopes.all.pools.raw.brier[7].toFixed(6));
      await expect(block.getByTestId("ad-base-ability")).toContainText(base.model.raw_brier.toFixed(6));
      await expect(block.getByTestId("ad-base-ability")).toContainText(base.model.brier_index.toFixed(2));
      await expect(block.getByTestId("ad-pair-identities").locator("div").first()).toContainText(base.exact_configuration);
    }
    await expect(page).toHaveURL(/#market-performance$/);
    await expect(block.locator(".ad-pending")).toHaveCount(0);
  }
  const current=await block.getByLabel("Partner model",{exact:true}).inputValue();
  await block.getByRole("button",{name:"Complementary events only",exact:true}).click();
  await expect(block.getByTestId("ad-uncalibrated-joint-brier")).toHaveText(pair(current).scopes.complementary.pools.raw.brier[7].toFixed(6));
  await expect(block.getByTestId("ad-base-ability")).toContainText(bases[1].model.raw_brier.toFixed(6));
  await page.reload();
  await expect(block.getByLabel("Partner model",{exact:true})).toHaveValue(current);
  await expect(block.locator(".ad-pair-view")).toHaveAttribute("data-base-configuration",bases[1].exact_configuration);
  await expect(block.getByTestId("ad-uncalibrated-joint-brier")).toHaveText(pair(current).scopes.complementary.pools.raw.brier[7].toFixed(6));
  await block.getByText("Event-type selections",{exact:true}).click();
  const side=pairBaseSide(pair(current),bases[1].exact_configuration),route=pair(current).routes[0];
  await expect(block.getByTestId("ad-pair-routes").locator("tbody tr").first().locator("td").nth(1)).toHaveText((side===0?route.train_brier_a:route.train_brier_b).toFixed(5));
  const order=await page.locator("#market-performance").evaluate(el=>{const chart=el.querySelector(".market-performance-layout")!,experiment=el.querySelector("#market-type-selection")!,later=el.querySelector("#model-market-aggregation")!;return !!(chart.compareDocumentPosition(experiment)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(experiment.compareDocumentPosition(later)&Node.DOCUMENT_POSITION_FOLLOWING);});
  expect(order).toBe(true);
  await block.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("market-linked-selection.png")});
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);expect(width[0]).toBeLessThanOrEqual(width[1]+1);expect(errors).toEqual([]);
});

test("market bases without eligible partners keep their own identity and market score",async({page})=>{
  const empty=market.points.find(p=>p.diversity.prediction_diversity!=null&&pairsForBase(index.pairs,p.exact_configuration,filters).length===0)!;
  expect(empty).toBeTruthy();
  await page.goto("/?cc_stability=original#market-performance");
  const marker=page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(empty.exact_configuration)}]`);
  await marker.focus();await marker.press("Enter");
  const block=page.locator("#market-type-selection");
  await expect(block.locator(".ad-pair-view")).toHaveAttribute("data-base-configuration",empty.exact_configuration);
  await expect(block.getByRole("status")).toContainText("No eligible partners");
  await expect(block.getByTestId("ad-pair-results")).toHaveCount(0);
  await expect(block.getByTestId("ad-base-ability")).toContainText(empty.model.raw_brier.toFixed(6));
  await expect(page).toHaveURL(/#market-performance$/);
});
