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

test("keeps heatmap selection visible without a detail sidebar", async ({ page }) => {
  await page.goto("/?metric=adjusted_pog&min_n=50");
  const cell = page.getByTestId("heatmap").locator("button.heat-cell").first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await expect(cell).toHaveClass(/is-active/);
  await expect(page.getByText("PAIR DETAIL")).toHaveCount(0);
});

test("keeps the research workspace usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
  await page.goto("/");
  await expect(page.getByLabel("Event type")).toBeVisible();
  await expect(page.getByTestId("heatmap")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model pair ranking" })).toBeVisible();
});

test("renders an English-only interface", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Forecast Model Dependence Atlas" })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Han}/u);
});

test("keeps 30 heatmap models in release order within a compact matrix", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("heatmap").locator(".heat-cell")).toHaveCount(900);
  const result = await page.evaluate(async () => {
    const models = await (await fetch("./data/models.json")).json() as Array<{ name: string; release_order: number }>;
    const releaseOrder = new Map(models.map((model) => [model.name, model.release_order]));
    const names = [...document.querySelectorAll<HTMLElement>(".row-label span")].map((element) => element.innerText);
    const values = names.map((name) => releaseOrder.get(name) ?? Number.MAX_SAFE_INTEGER);
    const height = Math.round(document.querySelector(".heatmap-grid")?.getBoundingClientRect().height ?? 0);
    return {
      count: names.length,
      sorted: values.every((value, index) => index === 0 || values[index - 1] <= value),
      height,
    };
  });
  expect(result).toEqual({ count: 30, sorted: true, height: expect.any(Number) });
  expect(result.height).toBeLessThan(1_000);
});
