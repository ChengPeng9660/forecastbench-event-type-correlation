import { expect, test } from "@playwright/test";

test("presents the unweighted gap sensitivity and shareable pair explorer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#complementarity");
  const section = page.locator("#complementarity");
  await expect(section.getByRole("heading", { level: 1 })).toHaveText("Can category-aware aggregation beat both models?");
  await expect(section).toHaveAttribute("lang", "en");
  await expect(section.getByRole("button", { name: "中文", exact: true })).toHaveCount(0);
  expect(await section.textContent()).not.toMatch(/[\u3400-\u9fff]/u);
  await expect(page.getByTestId("cc-scope")).toContainText("Main sensitivity · Training BI gap ≤ 3");
  await expect(page.getByTestId("cc-scope")).toContainText("Uniform target weights (1/n); no Dataset/Market 50:50 balancing");
  await expect(page.getByLabel("Select exact model pair")).toHaveValue("44_58");
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+0.535");
  await expect(section.locator(".cc-heading-note").first()).toContainText("226 eligible pairs");
  await expect(section).toContainText("92.0%");
  await expect(section).toContainText("10 / 10");
  await expect(section).toContainText("92.3%");

  if (page.viewportSize()!.width < 700) {
    await page.getByRole("button", { name: "Training strengths", exact: true }).click();
    await expect(page.getByTestId("cc-profile")).toContainText("Overall");
    await page.getByRole("button", { name: "Test transfer", exact: true }).click();
  }

  await page.getByLabel("Complementarity aggregation method").selectOption("cf_directional");
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+0.453");
  await page.getByLabel("Complementarity aggregation method").selectOption("type_shrunk");
  await page.getByLabel("Next pair", { exact: true }).click();
  const newPair = await page.getByLabel("Select exact model pair").inputValue();
  expect(newPair).not.toBe("44_58");
  await expect(page).toHaveURL(new RegExp(`cc_pair=${newPair}`));
  await page.reload();
  await expect(page.getByLabel("Select exact model pair")).toHaveValue(newPair);

  await page.getByLabel("Train BI gap limit", { exact: true }).selectOption("5");
  await expect(page.getByTestId("cc-scope")).toContainText("Wider robustness · Training BI gap ≤ 5");
  await expect(section.locator(".cc-heading-note").first()).toContainText("241 eligible pairs");
  await page.getByLabel("Train BI gap limit", { exact: true }).selectOption("3");
  await page.getByLabel("Category coverage", { exact: true }).selectOption("0.8");
  await expect(section.locator(".cc-heading-note").first()).toContainText("122 eligible pairs");
  await page.getByRole("button", { name: "Question source / platform", exact: true }).click();
  await page.getByLabel("Category coverage", { exact: true }).selectOption("0.5");
  await expect(section.locator(".cc-heading-note").first()).toContainText("432 eligible pairs");
  await expect(section).toContainText("91.1%");
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
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+0.535");
  await expect(page.getByText("Results unavailable")).toHaveCount(0);
});
