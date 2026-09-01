import { expect, test, type Page } from "@playwright/test";

const claude = "Claude-2.1 (zero shot with freeze values)";
const kimi = "Kimi-K2-Instruct-0905 (zero shot with freeze values)";

function overviewPoint(page: Page, exact: string) {
  return page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(exact)}]`);
}

test("links the first-chart exact configuration to its training-screened complementary partners", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/#market-performance");
  const block = page.locator("#focal-model-complementarity");
  await expect.poll(async () => {
    await block.evaluate(element => element.scrollIntoView({ block: "center" }));
    return block.locator(".focal-pair-picker").count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(block.getByRole("heading", { name: "Who complements the selected model?", exact: true })).toBeVisible();
  await expect(page.locator("#within-topic-complementarity")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Do they solve different questions inside the same topic?", exact: true })).toHaveCount(0);
  await expect(block).not.toContainText("Training-only screen.");
  await expect(block).not.toContainText("WHAT THE COMPLETE EXPERIMENT FOUND");
  await expect(block).not.toContainText("Selected-model complementarity details");
  await expect(block.locator(".focal-configuration-line")).toContainText(claude);
  await expect(block.locator(".focal-complementarity-kpis")).toHaveCount(0);
  await expect(block).not.toContainText(/SCREENED PARTNERS|MEAN OOS GAIN|BEATS BOTH|NEAR-SKILL BASELINE|FULL STUDY/);
  await expect(block.locator(".focal-complementarity-point")).toHaveCount(25);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", claude);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Mistral-Large-Latest (zero shot with freeze values)");
  await expect(block.getByLabel("Selected complementary partner")).toHaveValue("p-baa8649cff5a");
  await expect(block.locator(".focal-complementarity-inspector")).toContainText("+3.039 BI");
  await expect(block.locator(".focal-category-profile")).toBeVisible();
  await expect(block.locator(".focal-category-profile")).not.toContainText(/\d+\s*\/\s*\d+\s+events/);
  await expect(block).not.toContainText("Train / test events");
  await expect(block).not.toContainText(/\d+\s*\/\s*\d+\s+events/);
  await expect(block.locator('.focal-category-profile g[opacity="0.35"], .focal-category-profile g[opacity=".35"]')).toHaveCount(0);
  await expect(block.locator(".focal-category-profile figcaption")).not.toContainText("are faded");

  await block.getByRole("button", { name: "Source / platform", exact: true }).click();
  await expect(block).toContainText("No crossed-strength partner under these controls.");

  await block.getByRole("button", { name: "Event type", exact: true }).click();
  await block.getByLabel("Selected-model partner scope").selectOption("matched_conditions");
  await expect(block.locator(".focal-complementarity-point")).toHaveCount(6);
  await block.getByLabel("Selected-model aggregation method").selectOption("simple_mean");
  await expect(block.locator(".focal-complementarity-inspector")).toContainText("+0.712 BI");

  await block.getByLabel("Selected-model partner scope").selectOption("all");
  await block.getByLabel("Selected-model aggregation method").selectOption("cf_directional");
  await overviewPoint(page, kimi).focus();
  await overviewPoint(page, kimi).press("Enter");
  await expect(block.locator(".focal-configuration-line")).toContainText(kimi);
  await expect(block.locator(".focal-complementarity-point")).toHaveCount(29);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", kimi);
  await expect(block.locator(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Kimi-K2-Thinking (zero shot with freeze values)");
  await expect(block).not.toContainText("Train / test events");
  await expect(block).not.toContainText(/\d+\s*\/\s*\d+\s+events/);

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
    return block.locator(".focal-pair-picker").count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(block.locator(".focal-complementarity-point")).toHaveCount(25, { timeout: 20_000 });
  await expect(block.locator(".focal-complementarity-kpis")).toHaveCount(0);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
  const columns = await block.locator(".focal-complementarity-controls").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(1);
});
