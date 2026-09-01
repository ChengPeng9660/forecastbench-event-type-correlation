import { expect, test } from "@playwright/test";

test("presents five existing aggregation methods and the shareable pair explorer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#complementarity");
  const section = page.locator("#complementarity");
  await expect(section.getByRole("heading", { level: 1 })).toHaveText("Can category complementarity identify pairs that aggregate well?");
  await expect(section).toHaveAttribute("lang", "en");
  await expect(section.getByRole("button", { name: "中文", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /GitHub/i })).toHaveCount(0);
  expect(await section.textContent()).not.toMatch(/[\u3400-\u9fff]/u);
  await expect(page.getByTestId("cc-scope")).toContainText("Main sensitivity · Training BI gap ≤ 3");
  await expect(page.getByTestId("cc-scope")).toContainText("Uniform target weights (1/n); no Dataset/Market 50:50 balancing");
  await expect(section).toContainText("313 exact configurations");
  await expect(section).toContainText("96 model versions");
  await expect(page.getByLabel("Exact configuration pair scope")).toHaveValue("all");
  await expect(page.getByLabel("Exact configuration pair scope").locator("option")).toHaveText([
    "All exact configurations", "Different model versions", "Same prompt + information",
  ]);
  await expect(page.getByLabel("Select exact model pair")).toHaveValue("p-baa8649cff5a");
  await expect(page.getByLabel("Complementarity aggregation method")).toHaveValue("cf_directional");
  await expect(page.getByLabel("Complementarity aggregation method").locator("option")).toHaveText([
    "Simple mean", "Log-odds mean", "EC · w = 0.56", "Piecewise odds", "Directional CF",
  ]);
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+3.039");
  await expect(section.locator(".cc-heading-note").first()).toContainText("2449 eligible pairs");
  await expect(section).toContainText("96.6%");
  await expect(section).toContainText("10 / 10");
  await expect(section).toContainText("313 exact configurations from 96 model versions");

  if (page.viewportSize()!.width < 700) {
    await page.getByRole("button", { name: "Training strengths", exact: true }).click();
    await expect(page.getByTestId("cc-profile")).toContainText("Overall");
    await page.getByRole("button", { name: "Test transfer", exact: true }).click();
  }

  await page.getByLabel("Complementarity aggregation method").selectOption("piecewise_odds");
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+1.108");
  await page.getByLabel("Complementarity aggregation method").selectOption("cf_directional");
  await page.getByLabel("Next pair", { exact: true }).click();
  const newPair = await page.getByLabel("Select exact model pair").inputValue();
  expect(newPair).not.toBe("p-baa8649cff5a");
  await expect(page).toHaveURL(new RegExp(`cc_pair=${newPair}`));
  await page.reload();
  await expect(page.getByLabel("Select exact model pair")).toHaveValue(newPair);

  await page.getByLabel("Train BI gap limit", { exact: true }).selectOption("5");
  await expect(page.getByTestId("cc-scope")).toContainText("Wider robustness · Training BI gap ≤ 5");
  await expect(section.locator(".cc-heading-note").first()).toContainText("2834 eligible pairs");
  await page.getByLabel("Train BI gap limit", { exact: true }).selectOption("3");
  await page.getByLabel("Category coverage", { exact: true }).selectOption("0.8");
  await expect(section.locator(".cc-heading-note").first()).toContainText("706 eligible pairs");
  await page.getByRole("button", { name: "Question source / platform", exact: true }).click();
  await page.getByLabel("Category coverage", { exact: true }).selectOption("0.5");
  await expect(section.locator(".cc-heading-note").first()).toContainText("3126 eligible pairs");
  await expect(section).toContainText("90.7%");
  await page.getByLabel("Exact configuration pair scope").selectOption("matched_conditions");
  await expect(section.locator(".cc-heading-note").first()).toContainText("989 eligible pairs");
  await expect(section).toContainText("87.5%");
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  expect(errors).toEqual([]);
});

test("recovers from a failed study fetch without keeping a stale error", async ({ page }) => {
  let fail = true;
  await page.route("**/data/complementarity/study.json", async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, body: "Unavailable" }); }
    else await route.continue();
  });
  await page.goto("/?cc_lang=zh#complementarity");
  await expect(page).not.toHaveURL(/cc_lang=/);
  await expect(page.locator("#complementarity")).toContainText("Results unavailable");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+3.039");
  await expect(page.getByText("Results unavailable")).toHaveCount(0);
});

test("normalizes obsolete category-aggregation links to Directional CF", async ({ page }) => {
  await page.goto("/?cc_method=type_shrunk#complementarity");
  await expect(page).toHaveURL(/cc_method=cf_directional/);
  await expect(page.getByLabel("Complementarity aggregation method")).toHaveValue("cf_directional");
});
