import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ConfigurationPairView } from "../../src/types/configurationPairAggregation";
import type { FreezeAggregationMethodId, FreezeFoldView } from "../../src/types/data";

const grok = "Grok-4-Fast-Reasoning (zero shot with freeze values)";
const scratchpad = "DeepSeek-R1 (scratchpad)";
const freezeScratchpad = "DeepSeek-R1 (scratchpad with freeze values)";
const payload = JSON.parse(readFileSync(new URL("../../public/data/model-market-aggregation/summary.json", import.meta.url), "utf8")) as {
  method_order: FreezeAggregationMethodId[];
  points: Array<{ configuration: { exact_configuration: string; provider: string }; views: { all: Record<FreezeFoldView, ConfigurationPairView | null> } }>;
};

function overviewPoint(page: Page, exact: string) {
  return page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(exact)}]`);
}

test("adds the final model-market block and follows the exact overview selection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#market-performance");
  const block = page.locator("#model-market-aggregation");
  await expect(block.getByRole("heading", { name: "Model + market aggregation", exact: true })).toBeVisible();
  await expect(block.locator(".model-market-point").first()).toBeAttached();
  const metrics = block.getByRole("group", { name: "Model + market diversity metric" });
  await expect(metrics.getByRole("button")).toHaveCount(5);
  for (const label of ["Prediction diversity", "Adjusted POG", "High-loss diversity", "Adjusted-loss diversity", "Total variation (TV)"]) {
    await expect(metrics.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  const outcomes = block.getByRole("group", { name: "Model + market performance outcome" });
  await expect(outcomes.getByRole("button")).toHaveCount(2);
  await expect(outcomes.getByRole("button", { name: "Raw Brier Score ↓", exact: true })).toBeVisible();
  await expect(outcomes.getByRole("button", { name: "Brier Index ↑", exact: true })).toBeVisible();
  await expect(block.getByLabel("Model + market aggregation method").locator("option")).toHaveCount(6);

  for (const exact of [grok, scratchpad, freezeScratchpad]) {
    await overviewPoint(page, exact).focus();
    await overviewPoint(page, exact).press("Enter");
    await expect(overviewPoint(page, exact)).toHaveAttribute("aria-pressed", "true");
    await expect(block.locator(`.model-market-point[data-configuration=${JSON.stringify(exact)}]`)).toHaveAttribute("aria-pressed", "true");
    await expect(block.locator("[data-selected-configuration]")).toHaveAttribute("data-selected-configuration", exact);
    await expect(page.locator(".configuration-pair-base")).toHaveText(exact);
  }
  const order = await page.locator("#market-performance").evaluate((element) => {
    const pair = element.querySelector("#configuration-pair-aggregation");
    const market = element.querySelector("#model-market-aggregation");
    return Boolean(pair && market && (pair.compareDocumentPosition(market) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
  await expect(page).toHaveURL(/#market-performance$/);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
  expect(errors).toEqual([]);
});

test("uses the published paired-market comparison for every unchanged method and direction", async ({ page }) => {
  await page.goto("/#market-performance");
  const block = page.locator("#model-market-aggregation");
  const methodControl = block.getByLabel("Model + market aggregation method");
  const directionControl = block.getByLabel("Model + market cross-fit direction");
  await expect(block.locator(".model-market-point").first()).toBeAttached();
  for (const method of payload.method_order) {
    await methodControl.selectOption(method);
    for (const direction of ["combined", "a_to_b", "b_to_a"] as const) {
      await directionControl.selectOption(direction);
      const expected = Object.fromEntries(payload.points.flatMap((point) => {
        const view = point.views.all[direction];
        if (!view || view.train_diversity.prediction_diversity === null || view.methods[method].brier_index === null) return [];
        return [[point.configuration.exact_configuration, view.methods[method].beats_market ? "triangle" : "circle"]];
      }));
      await expect.poll(async () => Object.fromEntries(await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), point.getAttribute("data-marker-shape")])))).toEqual(expected);
    }
  }
  await methodControl.selectOption("ec_w0_56");
  await directionControl.selectOption("combined");
  const before = await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), point.getAttribute("data-marker-shape")]));
  await block.getByRole("button", { name: "Raw Brier Score ↓", exact: true }).click();
  await expect(block.getByRole("img")).toHaveAccessibleName(/Raw Brier/);
  const after = await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), point.getAttribute("data-marker-shape")]));
  expect(after).toEqual(before);
  await block.getByRole("button", { name: "Total variation (TV)", exact: true }).click();
  await expect(block.getByRole("img")).toHaveAccessibleName(/Total variation/);
  await block.getByLabel("Model + market train sample").selectOption("near_bi");
  await expect(block.getByLabel("Model + market train sample")).toHaveValue("near_bi");
  await expect(block.locator(".model-market-point").first()).toBeAttached();
  await page.getByLabel("Market performance provider", { exact: true }).selectOption("OpenAI");
  const names = new Set(payload.points.filter((point) => point.configuration.provider === "OpenAI").map((point) => point.configuration.exact_configuration));
  const visible = await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => point.getAttribute("data-configuration")));
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.every((name) => name !== null && names.has(name))).toBe(true);
});


test("retains the exact selection when its overview high-loss coordinate is undefined", async ({ page }) => {
  const exact = "Claude-Opus-4-1-20250805 (scratchpad with freeze values)";
  await page.goto("/#market-performance");
  const block = page.locator("#model-market-aggregation");
  const bottom = block.locator(`.model-market-point[data-configuration=${JSON.stringify(exact)}]`);
  await expect(bottom).toBeAttached();
  await page.getByRole("group", { name: "Market performance diversity metric", exact: true }).getByRole("button", { name: "High-loss diversity", exact: true }).click();
  await expect(overviewPoint(page, exact)).toHaveCount(0);
  await bottom.focus();
  await bottom.press("Enter");
  await expect(bottom).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.market-performance-hit[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(".market-performance-inspector")).toContainText(exact);
  await expect(page.locator(".market-performance-inspector")).toContainText("undefined diversity or performance");
  await page.getByRole("group", { name: "Market performance diversity metric", exact: true }).getByRole("button", { name: "Prediction diversity", exact: true }).click();
  await expect(overviewPoint(page, exact)).toHaveAttribute("aria-pressed", "true");
});
