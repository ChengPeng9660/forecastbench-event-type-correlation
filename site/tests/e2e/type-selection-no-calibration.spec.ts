import { expect,test } from "@playwright/test";

test("compares raw pooling on both scopes and changes the duplicate baseline",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?cc_section=type-selection-no-calibration#complementarity");
  const section=page.locator("#type-selection-no-calibration");
  await expect(section.getByRole("heading",{name:"Does a second raw forecast help?"})).toBeVisible();
  await expect(section.getByTestId("nc-context")).toContainText("2,431 pairs");
  await expect(section.getByTestId("nc-finding")).toContainText("3 of the four");
  await expect(section.getByTestId("nc-learned")).toContainText("+0.002783");
  await expect(section.getByTestId("nc-finding")).toContainText("-0.003277");
  await section.getByLabel("Raw pooling comparison baseline").selectOption("duplicate");
  await expect(section.getByTestId("nc-finding")).toContainText("+0.004186");
  await section.getByRole("button",{name:"Complementary events only",exact:true}).click();
  await expect(section.getByTestId("nc-learned")).toContainText("+0.001915");
  await section.getByLabel("Raw pooling comparison baseline").selectOption("selection");
  await expect(section.getByTestId("nc-finding")).toContainText("1 of the four");
  await expect(section.getByTestId("nc-finding")).toContainText("-0.006818");
  await section.getByText("Inspect agreement groups, fallback events and learned weights",{exact:true}).click();
  await section.getByLabel("Raw pooling diagnostic method").selectOption("7");
  await expect(section.getByRole("rowheader",{name:"Both high",exact:true})).toBeVisible();
  await page.getByLabel("Train BI gap limit",{exact:true}).selectOption("5");
  await expect(section.getByTestId("nc-context")).toContainText("2,805 pairs");
  await page.getByLabel("Exact configuration pair scope").selectOption("matched_conditions");
  await expect(section.getByTestId("nc-context")).toContainText("Same prompt + information");
  const sizes=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(sizes[0]).toBeLessThanOrEqual(sizes[1]+1);
  await expect(section.getByRole("link",{name:"Raw pooling report ↗",exact:true})).toHaveAttribute("href",/type-selection-no-calibration\/REPORT.md$/);
  expect(errors).toEqual([]);
});

test("recovers a failed raw-pooling fetch and preserves the original experiment",async({page})=>{
  let fail=true;
  await page.route("**/data/type-selection-no-calibration/views/gap3-coverage50-all.json",async route=>{
    if(fail){fail=false;await route.fulfill({status:503,body:"Unavailable"});}else await route.continue();
  });
  await page.goto("/?cc_section=type-selection-no-calibration#complementarity");
  const section=page.locator("#type-selection-no-calibration");
  await expect(section.getByRole("alert")).toContainText("503");
  await expect(page.getByTestId("ts-all")).toContainText("0.15728");
  await section.getByRole("button",{name:"Retry raw pooling results",exact:true}).click();
  await expect(section.getByTestId("nc-context")).toContainText("2,431 pairs");
  await expect(section.getByRole("alert")).toHaveCount(0);
});
