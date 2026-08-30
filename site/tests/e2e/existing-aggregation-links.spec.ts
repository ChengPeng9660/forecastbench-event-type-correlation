import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ExistingAggregationLink } from "../../src/lib/existingAggregationLinks";

const index = JSON.parse(readFileSync(new URL("../../src/data/existingAggregationLinks.json", import.meta.url), "utf8")) as { entries: Record<string, ExistingAggregationLink[]> };
const market = JSON.parse(readFileSync(new URL("../../public/data/polymarket-aggregation/market-diversity-performance.json", import.meta.url), "utf8")) as { points: Array<{ exact_configuration: string }> };

const grok = "Grok-4-Fast-Reasoning (zero shot with freeze values)";

test("opens existing cross-fit and fixed results for the exact selected configuration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const view of ["crossfit", "fixed"]) {
    await page.goto("/?metric=total_variation&near_bi=0#market-performance");
    const point = page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(grok)}]`);
    await point.click();
    const inspector = page.locator(".market-performance-inspector");
    await expect(inspector.getByRole("link")).toHaveCount(2);
    await inspector.getByRole("link", { name: view === "crossfit" ? "Open existing cross-fit pair results →" : "Open existing fixed-pair results →", exact: true }).click();
    await expect(page).toHaveURL(/#upper-left-pairs$/);
    await expect.poll(() => new URL(page.url()).searchParams.get("upper_left_base")).toBe(grok);
    await expect.poll(() => new URL(page.url()).searchParams.get("metric")).toBe("total_variation");
    const block = page.locator(`#upper-left-${view}`);
    await expect(block.getByLabel(/focal model$/)).toHaveValue(grok);
    if (view === "crossfit") await expect(block.getByLabel("Minimum OOS directions")).toHaveValue("1");
    await expect(block.locator(".upper-left-point-hit").first()).toBeVisible();
    await expect.poll(async () => (await block.boundingBox())?.y).toBeLessThan(80);
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(width[0]).toBeLessThanOrEqual(width[1] + 1);
  }
  expect(errors).toEqual([]);
});

test("labels a broader-support link and presets the existing fixed-focal experiment", async ({ page }) => {
  const [exact, links] = Object.entries(index.entries).find(([, values]) => values.some((link) => link.page === "fixed-focal-no-freeze"))!;
  const link = links.find((item) => item.page === "fixed-focal-no-freeze")!;
  await page.goto("/#market-performance");
  // Select by the complete published key, not a canonical-name approximation.
  const exactPoint = page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(exact)}]`);
  await exactPoint.click();
  const inspector = page.locator(".market-performance-inspector");
  await expect(inspector).toContainText("Dataset + market questions: broader support than this overview");
  await inspector.getByRole("link", { name: "Open existing fixed-base cross-fit results →", exact: true }).click();
  await expect(page).toHaveURL(/#fixed-focal-no-freeze$/);
  const expected = (link.params as { nofreeze_base: string }).nofreeze_base;
  await expect(page.getByLabel("Without-freeze base model")).toHaveValue(expected);
});

test("offers the new experiment without inventing earlier links for an unsupported exact configuration", async ({ page }) => {
  const unsupported = market.points.find((point) => !Object.hasOwn(index.entries, point.exact_configuration))!;
  await page.goto("/#market-performance");
  const point = page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(unsupported.exact_configuration)}]`);
  await point.focus();
  await point.press("Enter");
  const inspector = page.locator(".market-performance-inspector");
  await expect(inspector.getByRole("button", { name: "Explore aggregation ↓", exact: true })).toBeVisible();
  await expect(inspector.getByRole("link")).toHaveCount(0);
  await expect(page.locator("#configuration-pair-aggregation .configuration-pair-base")).toContainText(unsupported.exact_configuration);
});

test("supports keyboard selection before following an existing-results link", async ({ page }) => {
  await page.goto("/#market-performance");
  const point = page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(grok)}]`);
  await point.focus();
  await point.press("Enter");
  await expect(point).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/#market-performance$/);
  await expect(page.locator(".market-performance-inspector").getByRole("link")).toHaveCount(2);
});

test("opens sparse published cross-fit results with the visible one-direction preset", async ({ page }) => {
  const sparse = "Grok-4-Fast-Non-Reasoning (zero shot with freeze values)";
  await page.goto("/#market-performance");
  await page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(sparse)}]`).click();
  await page.locator(".market-performance-inspector").getByRole("link", { name: "Open existing cross-fit pair results →", exact: true }).click();
  const block = page.locator("#upper-left-crossfit");
  await expect(block.getByLabel(/focal model$/)).toHaveValue(sparse);
  await expect(block.getByLabel("Minimum OOS directions")).toHaveValue("1");
  await expect(block.locator(".upper-left-point-hit").first()).toBeVisible();
  await expect(block).toContainText("not every pair appears in all 20");
  await page.goto("/#upper-left-pairs");
  await expect(page.getByLabel("Minimum OOS directions")).toHaveValue("10");
});
