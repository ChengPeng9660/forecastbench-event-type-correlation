import { expect, test } from "@playwright/test";

test("links mechanism diagnostics to test scope, confidence threshold and training filters", async ({page}) => {
  const errors: string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/?cc_section=type-selection-mechanisms#complementarity");
  const section=page.locator("#type-selection-mechanisms");
  await expect(section.getByRole("heading",{name:"Does agreement justify more confidence?"})).toBeVisible();
  await expect(section.getByTestId("tm-context")).toContainText("2,431 pairs");
  await expect(section.getByTestId("tm-context")).toContainText("All test events");
  await expect(section.getByTestId("tm-total-gain")).toHaveText("+0.002594");
  await section.getByRole("button",{name:"Complementary events only",exact:true}).click();
  await expect(section.getByTestId("tm-total-gain")).toHaveText("+0.000209");
  await section.getByLabel("Mechanism gain comparison").selectOption("4");
  await expect(section.getByRole("img")).toHaveAttribute("aria-label",/EC vs log-odds mean/);
  await section.getByLabel("Mechanism confidence cutoff").selectOption("2");
  await expect(section.getByLabel("Mechanism confidence cutoff")).toHaveValue("2");
  await section.getByText("Compare group probabilities with observed frequencies",{exact:true}).click();
  await expect(section.getByRole("columnheader",{name:"Outcome frequency",exact:true})).toBeVisible();
  await expect(section.getByTestId("tm-score-table")).toContainText("Type-adjusted joint model");
  await page.getByLabel("Train BI gap limit",{exact:true}).selectOption("5");
  await expect(section.getByTestId("tm-context")).toContainText("2,805 pairs");
  await page.getByLabel("Exact configuration pair scope").selectOption("matched_conditions");
  await expect(section.getByTestId("tm-context")).toContainText("Same prompt + information");
  await expect(section.getByRole("link",{name:"Mechanism report ↗",exact:true})).toHaveAttribute("href",/type-selection-mechanisms\/REPORT.md$/);
  const width=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]+1);
  expect(errors).toEqual([]);
});

test("recovers from unavailable mechanism results without blocking parent comparison",async({page})=>{
  let fail=true;
  await page.route("**/data/type-selection-mechanisms/views/gap3-coverage50-all.json",async route=>{
    if(fail){fail=false;await route.fulfill({status:503,body:"Unavailable"});}else await route.continue();
  });
  await page.goto("/?cc_section=type-selection-mechanisms#complementarity");
  const section=page.locator("#type-selection-mechanisms");
  await expect(section.getByRole("alert")).toContainText("503");
  await expect(page.getByTestId("ts-all")).toContainText("0.15728");
  await section.getByRole("button",{name:"Retry mechanism results",exact:true}).click();
  await expect(section.getByTestId("tm-context")).toContainText("2,431 pairs");
  await expect(section.getByRole("alert")).toHaveCount(0);
});
