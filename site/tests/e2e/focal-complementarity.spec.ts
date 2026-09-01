import { expect, test, type Locator, type Page } from "@playwright/test";

const claude = "Claude-2.1 (zero shot with freeze values)";
const kimi = "Kimi-K2-Instruct-0905 (zero shot with freeze values)";

function overviewPoint(page: Page, exact: string) {
  return page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(exact)}]`);
}

function kpi(block: Locator, label: string) {
  return block.locator(".focal-complementarity-kpis > div").filter({ hasText: label });
}

test("links the first-chart exact configuration to its training-screened complementary partners", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/#market-performance");
  const block = page.locator("#focal-model-complementarity");
  await expect.poll(async () => {
    await block.evaluate(element => element.scrollIntoView({ block: "center" }));
    return block.locator(".focal-complementarity-kpis").count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(block.getByRole("heading", { name: "Who complements the selected model?", exact: true })).toBeVisible();
  await expect(block.locator(".focal-configuration-line")).toContainText(claude);
  await expect(kpi(block, "SCREENED PARTNERS").locator("dd")).toHaveText("25", { timeout: 20_000 });
  await expect(kpi(block, "SCREENED PARTNERS")).toContainText("54 near-skill candidates");
  await expect(block.locator(".focal-complementarity-point")).toHaveCount(25);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", claude);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Mistral-Large-Latest (zero shot with freeze values)");
  await expect(block.getByLabel("Selected complementary partner")).toHaveValue("p-baa8649cff5a");
  await expect(block.locator(".focal-complementarity-inspector")).toContainText("+3.039 BI");
  await expect(block.locator(".focal-category-profile")).toBeVisible();

  await block.getByRole("button", { name: "Source / platform", exact: true }).click();
  await expect(kpi(block, "SCREENED PARTNERS").locator("dd")).toHaveText("0");
  await expect(block).toContainText("No crossed-strength partner under these controls.");

  await block.getByRole("button", { name: "Event type", exact: true }).click();
  await block.getByLabel("Selected-model partner scope").selectOption("matched_conditions");
  await expect(kpi(block, "SCREENED PARTNERS").locator("dd")).toHaveText("6");
  await expect(kpi(block, "SCREENED PARTNERS")).toContainText("10 near-skill candidates");
  await block.getByLabel("Selected-model aggregation method").selectOption("simple_mean");
  await expect(block.locator(".focal-complementarity-inspector")).toContainText("+0.712 BI");

  await block.getByLabel("Selected-model partner scope").selectOption("all");
  await block.getByLabel("Selected-model aggregation method").selectOption("cf_directional");
  await overviewPoint(page, kimi).focus();
  await overviewPoint(page, kimi).press("Enter");
  await expect(block.locator(".focal-configuration-line")).toContainText(kimi);
  await expect(kpi(block, "SCREENED PARTNERS").locator("dd")).toHaveText("29");
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", kimi);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Kimi-K2-Thinking (zero shot with freeze values)");

  const finalOrder = await page.locator("#market-performance").evaluate(element => {
    const market = element.querySelector("#model-market-aggregation");
    const complementarity = element.querySelector("#focal-model-complementarity");
    return Boolean(market && complementarity && (market.compareDocumentPosition(complementarity) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(finalOrder).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps the selected-model block inside the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile layout check");
  test.setTimeout(60_000);
  await page.goto("/#market-performance");
  const block = page.locator("#focal-model-complementarity");
  await expect.poll(async () => {
    await block.evaluate(element => element.scrollIntoView({ block: "center" }));
    return block.locator(".focal-complementarity-kpis").count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(kpi(block, "SCREENED PARTNERS").locator("dd")).toHaveText("25", { timeout: 20_000 });
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
  const columns = await block.locator(".focal-complementarity-controls").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(1);
});
