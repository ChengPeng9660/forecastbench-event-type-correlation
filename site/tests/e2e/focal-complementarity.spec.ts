import { expect, test, type Page } from "@playwright/test";

const claude = "Claude-2.1 (zero shot with freeze values)";
const kimi = "Kimi-K2-Instruct-0905 (zero shot with freeze values)";

function overviewPoint(page: Page, exact: string) {
  return page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(exact)}]`);
}

test("keeps pair selection and BI/ECE profiles after removing the upper result area", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/#market-performance");
  const block = page.locator("#focal-model-complementarity");
  await expect.poll(async () => {
    await block.evaluate(element => element.scrollIntoView({ block: "center" }));
    return block.locator(".focal-category-profile").count();
  }, { timeout: 20_000 }).toBe(1);

  await expect(block.getByRole("heading", { name: "Who complements the selected model?", exact: true })).toBeVisible();
  await expect(block.getByRole("heading", { name: "Where do their category strengths differ?", exact: true })).toBeVisible();
  await expect(block.locator(".focal-complementarity-scatter")).toHaveCount(0);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveCount(0);
  await expect(block.locator(".focal-pair-picker")).toHaveCount(0);
  await expect(block.locator(".focal-configuration-line")).toHaveCount(0);
  await expect(block).not.toContainText("TEST PERFORMANCE · Y");
  await expect(block).not.toContainText("Gain vs better single");

  const focalSelect = block.getByLabel("Selected focal model", { exact: true });
  const partnerSelect = block.getByLabel("Selected complementary partner");
  await expect(focalSelect).toHaveValue(claude);
  await expect(partnerSelect).toHaveValue("p-baa8649cff5a");
  await expect(block.locator(".focal-category-profile")).toContainText("Focal · Claude-2.1");
  await expect(block.locator(".focal-category-profile")).toContainText("Partner · Mistral-Large-Latest");

  const metricControls = block.getByRole("group", { name: "Category profile metric" });
  await expect(metricControls.getByRole("button")).toHaveCount(2);
  await metricControls.getByRole("button", { name: "ECE ↓", exact: true }).click();
  await expect(block.locator(".focal-category-profile")).toHaveAttribute("data-profile-metric", "ece");
  await expect(block.locator(".focal-category-profile")).toContainText("ECE further left is better");
  await expect(partnerSelect).toHaveValue("p-baa8649cff5a");
  await metricControls.getByRole("button", { name: "Brier Index ↑", exact: true }).click();
  await expect(block.locator(".focal-category-profile")).toHaveAttribute("data-profile-metric", "bi");

  await focalSelect.selectOption(kimi);
  await expect(focalSelect).toHaveValue(kimi);
  await expect(overviewPoint(page, kimi)).toHaveAttribute("aria-pressed", "true");
  await expect(partnerSelect).toHaveValue("p-27031dd0e2bd");
  await expect(block.locator(".focal-category-profile")).toContainText("Focal · Kimi-K2-Instruct-0905");
  await expect(block.locator(".focal-category-profile")).toContainText("Partner · Claude-Sonnet-4-20250514");

  await block.getByRole("button", { name: "Source / platform", exact: true }).click();
  await expect(partnerSelect).toBeEnabled();
  await expect(block.locator(".focal-category-profile")).toContainText("Polymarket");
  await block.getByRole("button", { name: "Event type", exact: true }).click();
  await expect(partnerSelect).toBeEnabled();
  await expect(block.locator(".focal-category-profile")).toBeVisible();

  await expect(block).not.toContainText("Train / test events");
  await expect(block).not.toContainText(/\d+\s*\/\s*\d+\s+events/);
  await expect(block.locator('.focal-category-profile g[opacity="0.35"], .focal-category-profile g[opacity=".35"]')).toHaveCount(0);

  const finalOrder = await page.locator("#market-performance").evaluate(element => {
    const market = element.querySelector("#model-market-aggregation");
    const complementarity = element.querySelector("#focal-model-complementarity");
    return Boolean(market && complementarity && (market.compareDocumentPosition(complementarity) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(finalOrder).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps the streamlined profile inside the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile layout check");
  test.setTimeout(60_000);
  await page.goto("/#market-performance");
  const block = page.locator("#focal-model-complementarity");
  await expect.poll(async () => {
    await block.evaluate(element => element.scrollIntoView({ block: "center" }));
    return block.locator(".focal-category-profile").count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(block.getByLabel("Selected focal model", { exact: true })).toBeVisible();
  await expect(block.getByLabel("Selected complementary partner")).toBeVisible();
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
  const pairColumns = await block.locator(".focal-category-pair-controls").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  const filterColumns = await block.locator(".focal-complementarity-controls").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(pairColumns).toBe(1);
  expect(filterColumns).toBe(1);
});
