import { expect, test } from "@playwright/test";

test("keeps the original market metrics and all configuration filters with TV", async ({ page }) => {
  await page.goto("/#market-performance");
  const section = page.locator("#market-performance");
  const diversity = section.getByRole("group", { name: "Market performance diversity metric" });
  await expect(diversity.getByRole("button")).toHaveCount(5);
  for (const label of ["Prediction diversity", "Adjusted POG", "High-loss diversity", "Adjusted-loss diversity"]) {
    await expect(diversity.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await diversity.getByRole("button", { name: "Total variation (TV)", exact: true }).click();
  await expect(section.getByRole("img")).toHaveAccessibleName(/Total variation \(TV\)/);
  await expect(diversity.getByRole("button", { name: "Total variation (TV)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await section.getByLabel("Market performance provider").selectOption("OpenAI");
  await section.getByRole("group", { name: "Market performance prompt filter" }).getByRole("button", { name: "Zero shot", exact: true }).click();
  await expect(section.getByLabel("Market performance provider")).toHaveValue("OpenAI");
  await expect(section.getByRole("group", { name: "Market performance prompt filter" }).getByRole("button", { name: "Zero shot", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(section.locator(".market-performance-hit").first()).toBeAttached();
  await expect(section.locator(".market-performance-baseline")).toBeAttached();
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
});

for (const id of ["gain", "polymarket-aggregation", "freeze-correlation", "without-freeze-base", "fixed-focal-no-freeze", "upper-left-pairs"]) {
  test(`offers TV without removing the ${id} experiment`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?near_bi=0#${id}`);
    const section = page.locator(`#${id}`);
    const role = id === "gain" || id === "polymarket-aggregation" ? "tab" : "button";
    const controls = section.getByRole(role, { name: "Total variation (TV)", exact: true });
    await expect(controls.first()).toBeVisible();
    const count = await controls.count();
    for (let index = 0; index < count; index += 1) await controls.nth(index).click();
    await expect(section.getByRole("img", { name: /Total variation \(TV\)/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Same-sample diagnostic", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("supports TV in the topic matrix, global matrix, and stability controls", async ({ page }) => {
  await page.goto("/?metric=total_variation&near_bi=0#matrix");
  await expect(page.getByLabel("Metric", { exact: true })).toHaveValue("total_variation");
  await expect(page.getByTestId("heatmap").locator(".heat-cell.value").first()).toBeVisible();
  await page.goto("/?global_metric=total_variation&near_bi=0#global");
  await expect(page.locator("#global").getByRole("tab", { name: "Total variation (TV)", exact: true })).toHaveClass(/active/);
  await expect(page.locator("#global .heat-cell.value").first()).toBeVisible();
  await page.goto("/#stability");
  const stability = page.locator("#stability");
  await stability.getByRole("tab", { name: "Total variation (TV)", exact: true }).click();
  await expect(stability.getByRole("tab", { name: "Total variation (TV)", exact: true })).toHaveClass(/active/);
});
