import { expect, test } from "@playwright/test";

test("filters event type and metric through reproducible URL state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#matrix").getByRole("heading", { name: "Adjusted Pairwise Oracle Gain" })).toBeVisible();
  await page.getByLabel("Metric").selectOption("high_loss_lift");
  await expect(page.locator("#matrix").getByRole("heading", { name: "Adjusted High-loss Lift" })).toBeVisible();
  await expect(page).toHaveURL(/metric=high_loss_lift/);
  const secondType = await page.getByLabel("Event type").locator("option").nth(1).getAttribute("value");
  expect(secondType).toBeTruthy();
  await page.getByLabel("Event type").selectOption(secondType!);
  await expect(page).toHaveURL(new RegExp(`type=${secondType}`));
});

test("links heatmap selection to the pair inspector", async ({ page }) => {
  await page.goto("/?metric=adjusted_pog&min_n=50");
  const cell = page.getByTestId("heatmap").locator("button.heat-cell").first();
  await cell.click();
  await expect(page.getByTestId("pair-inspector")).toContainText("AUDIT ID");
});

test("keeps the research workspace usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
  await page.goto("/");
  await expect(page.getByLabel("Event type")).toBeVisible();
  await expect(page.getByTestId("heatmap")).toBeVisible();
  await expect(page.getByRole("heading", { name: "模型对排名" })).toBeVisible();
});
