import { expect, test } from "@playwright/test";

test("links real pair strengths, gains, controls and shareable filters", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/?cc_lang=en#complementarity");
  const section = page.locator("#complementarity");
  await expect(section.getByRole("heading", { level: 1 })).toHaveText("Similar overall skill. Different strengths.");
  await expect(page.getByTestId("cc-scope")).toContainText("Post-protocol sensitivity · 50%");
  await expect(page.getByLabel("Select exact model pair")).toHaveValue("44_58");
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+0.065");
  if (page.viewportSize()!.width < 700) {
    await page.getByRole("button", { name: "Training strengths", exact: true }).click();
    await expect(page.getByTestId("cc-profile")).toContainText("70.8");
    await page.getByRole("button", { name: "Test transfer", exact: true }).click();
    await expect(page.getByTestId("cc-profile")).toContainText("59.7");
  }
  await page.getByLabel("Complementarity aggregation method").selectOption("cf_directional");
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+0.386");
  await page.getByLabel("Complementarity aggregation method").selectOption("type_shrunk");
  await page.getByLabel("Next pair", { exact: true }).click();
  await expect(page.getByLabel("Select exact model pair")).not.toHaveValue("44_58");
  const newPair = await page.getByLabel("Select exact model pair").inputValue();
  await expect(page).toHaveURL(new RegExp(`cc_pair=${newPair}`));
  await page.reload();
  await expect(page.getByLabel("Select exact model pair")).toHaveValue(newPair);
  await page.getByLabel("Category coverage", { exact: true }).selectOption("0.8");
  await expect(page.getByTestId("cc-scope")).toContainText("Original protocol · 80%");
  await expect(section.locator(".cc-heading-note").first()).toContainText("1 eligible pairs");
  await expect(section.getByRole("tabpanel")).toContainText("No eligible matched controls; not estimable");
  await page.getByRole("tab", { name: "Shuffle category labels" }).click();
  await expect(section.getByRole("tabpanel")).toContainText("Thirty fixed shuffles");
  await page.getByRole("tab", { name: "Time & novel events" }).click();
  await expect(section.getByRole("tabpanel")).toContainText("not untouched future confirmation sets");
  await page.getByRole("button", { name: "Question source / platform", exact: true }).click();
  await page.getByLabel("Category coverage", { exact: true }).selectOption("0.5");
  await expect(section.locator(".cc-heading-note").first()).toContainText("275 eligible pairs");
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(size.width).toBeLessThanOrEqual(size.viewport + 1);
  expect(errors).toEqual([]);
});

test("recovers from a failed study fetch without a stale error", async ({ page }) => {
  let fail = true;
  await page.route("**/data/complementarity/study.json", async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, body: "Unavailable" }); }
    else await route.continue();
  });
  await page.goto("/?cc_lang=en#complementarity");
  await expect(page.locator("#complementarity")).toContainText("Results unavailable");
  await expect(page.getByRole("button", { name: "重新加载 / Try again" })).toBeVisible();
  await page.getByRole("button", { name: "重新加载 / Try again" }).click();
  await expect(page.getByTestId("cc-gain-inspector").locator(".cc-big-number")).toContainText("+0.065");
  await expect(page.getByText("实验数据暂时无法加载 / Results unavailable")).toHaveCount(0);
});
