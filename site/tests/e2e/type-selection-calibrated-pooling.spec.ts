import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const view=JSON.parse(readFileSync(resolve("public/data/type-selection-calibrated-pooling/views/gap3-coverage50-all.json"),"utf8"));
const signed=(n:number)=>`${n>=0?"+":""}${n.toFixed(6)}`;

test("switches both calibration locations, scopes and duplicate controls",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?cc_section=type-selection-calibrated-pooling#complementarity");
  const section=page.locator("#type-selection-calibrated-pooling");
  await expect(section.getByRole("heading",{name:"Does calibration change the value of a second forecast?",exact:true})).toBeVisible();
  await expect(section.getByTestId("cp-context")).toContainText("2,431 pairs");
  for(const stage of ["input","output"] as const){
    await section.getByRole("button",{name:stage==="input"?"Calibrate models → pool":"Pool → calibrate output",exact:true}).click();
    await expect(section.getByTestId("cp-context")).toContainText(stage==="input"?"Input calibration":"Output calibration");
    for(const scope of ["all","complementary"] as const){
      await section.getByRole("button",{name:scope==="all"?"All test events":"Complementary events only",exact:true}).click();
      const r=view.primary.stages[stage][scope];
      await expect(section.getByTestId("cp-baselines")).toContainText(r.brier[0].toFixed(6));
      await section.getByLabel("Calibrated pooling comparison baseline").selectOption("selection");
      await expect(section.getByTestId("cp-finding")).toContainText(signed(r.brier[0]-r.brier[6]));
      await expect(section.getByTestId("cp-learned")).toContainText(signed(r.brier[0]-r.brier[7]));
      await section.getByLabel("Calibrated pooling comparison baseline").selectOption("duplicate");
      await expect(section.getByTestId("cp-finding")).toContainText(signed(r.duplicate_brier[6]-r.brier[6]));
    }
  }
  await section.getByText("Inspect calibrated gains by original forecast group",{exact:true}).click();
  await section.getByLabel("Calibrated pooling diagnostic method").selectOption("6");
  await expect(section.getByRole("rowheader",{name:"Both high",exact:true})).toBeVisible();
  await page.getByLabel("Train BI gap limit",{exact:true}).selectOption("5");
  await expect(section.getByTestId("cp-context")).toContainText("2,805 pairs");
  await page.getByLabel("Exact configuration pair scope").selectOption("matched_conditions");
  await expect(section.getByTestId("cp-context")).toContainText("Same prompt + information");
  const sizes=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(sizes[0]).toBeLessThanOrEqual(sizes[1]+1);
  await expect(section.getByRole("link",{name:"Calibrated pooling report ↗",exact:true})).toHaveAttribute("href",/type-selection-calibrated-pooling\/REPORT.md$/);
  expect(errors).toEqual([]);
});

test("retries calibrated pooling data without breaking the raw experiment",async({page})=>{
  let fail=true;
  await page.route("**/data/type-selection-calibrated-pooling/views/gap3-coverage50-all.json",async route=>{
    if(fail){fail=false;await route.fulfill({status:503,body:"Unavailable"});}else await route.continue();
  });
  await page.goto("/?cc_section=type-selection-calibrated-pooling#complementarity");
  const section=page.locator("#type-selection-calibrated-pooling");
  await expect(section.getByRole("alert")).toContainText("503");
  await expect(page.getByTestId("nc-context")).toContainText("2,431 pairs");
  await section.getByRole("button",{name:"Retry calibrated pooling results",exact:true}).click();
  await expect(section.getByTestId("cp-context")).toContainText("2,431 pairs");
  await expect(section.getByRole("alert")).toHaveCount(0);
});
