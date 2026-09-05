import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ConfigurationPairView } from "../../src/types/configurationPairAggregation";
import type { FreezeAggregationMethodId, FreezeFoldView, MarketDiversityPerformanceData, MarketPerformanceOutcomeId } from "../../src/types/data";

const grok = "Grok-4-Fast-Reasoning (zero shot with freeze values)";
const scratchpad = "DeepSeek-R1 (scratchpad)";
const freezeScratchpad = "DeepSeek-R1 (scratchpad with freeze values)";
const payload = JSON.parse(readFileSync(new URL("../../public/data/model-market-aggregation/summary.json", import.meta.url), "utf8")) as {
  method_order: FreezeAggregationMethodId[];
  points: Array<{ configuration: { exact_configuration: string; provider: string }; views: { all: Record<FreezeFoldView, ConfigurationPairView | null> } }>;
};
const overview = JSON.parse(readFileSync(new URL("../../public/data/polymarket-aggregation/market-diversity-performance.json", import.meta.url), "utf8")) as MarketDiversityPerformanceData;

function expectedMarketWins(method: FreezeAggregationMethodId, direction: FreezeFoldView, outcome: MarketPerformanceOutcomeId) {
  return Object.fromEntries(payload.points.flatMap((point) => {
    const view = point.views.all[direction];
    if (!view || view.train_diversity.prediction_diversity === null || view.methods[method][outcome] === null || view.market[outcome] === null) return [];
    const gain = outcome === "brier_index" ? view.methods[method].brier_index! - view.market.brier_index! : view.market.raw_brier! - view.methods[method].raw_brier!;
    return [[point.configuration.exact_configuration, gain > 1e-12]];
  }));
}

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
  await expect(outcomes.getByRole("button", { name: "Brier Score ↓", exact: true })).toBeVisible();
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
  const highlight = block.getByRole("checkbox", { name: "Model + market aggregation: highlight market wins" });
  await expect(highlight).not.toBeChecked();
  await expect(block.locator(".model-market-point .market-win-badge")).toHaveCount(0);
  await expect(block.locator(".model-market-baseline")).toHaveCount(0);
  await highlight.check();
  for (const outcome of ["brier_index", "raw_brier"] as const) {
    await block.getByRole("button", { name: outcome === "brier_index" ? "Brier Index ↑" : "Brier Score ↓", exact: true }).click();
    for (const method of payload.method_order) {
      await methodControl.selectOption(method);
      for (const direction of ["combined", "a_to_b", "b_to_a"] as const) {
        await directionControl.selectOption(direction);
        const expected = expectedMarketWins(method, direction, outcome);
        await expect.poll(async () => Object.fromEntries(await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), Boolean(point.querySelector(".market-win-badge"))])))).toEqual(expected);
        await expect(block.locator('.model-market-point[data-marker-shape="circle"]')).toHaveCount(Object.keys(expected).length);
      }
    }
  }
  await methodControl.selectOption("ec_w0_56");
  await directionControl.selectOption("combined");
  const before = await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), point.getAttribute("transform"), point.querySelector(".model-market-glyph")?.getAttribute("fill")]));
  await highlight.uncheck();
  await expect(block.locator(".model-market-point .market-win-badge")).toHaveCount(0);
  const after = await block.locator(".model-market-point").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), point.getAttribute("transform"), point.querySelector(".model-market-glyph")?.getAttribute("fill")]));
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

test("overview wins use each configuration's own market and the two highlight switches are independent", async ({ page }) => {
  await page.goto("/#market-performance");
  const top = page.locator("#market-performance");
  const bottom = page.locator("#model-market-aggregation");
  const topToggle = top.getByRole("checkbox", { name: "Model performance: highlight market wins", exact: true });
  const bottomToggle = bottom.getByRole("checkbox", { name: "Model + market aggregation: highlight market wins", exact: true });
  const chart = page.locator(".market-performance-chart");
  await expect(chart).toBeAttached();
  await expect(topToggle).not.toBeChecked();
  await expect(bottomToggle).not.toBeChecked();
  await expect(page.locator(".market-performance-baseline, .model-market-baseline")).toHaveCount(0);
  await page.locator(".market-performance-axis-controls").first().getByRole("button", { name: "Brier Index ↑", exact: true }).click();
  const markerSignature = () => chart.locator(".market-performance-hit").evaluateAll((points) => points.map((point) => {
    const glyph = point.querySelector(".market-performance-point")!;
    return [point.getAttribute("data-configuration"), point.getAttribute("transform"), glyph.tagName, glyph.getAttribute("fill"), glyph.getAttribute("transform")];
  }));
  const before = await markerSignature();
  await topToggle.check();
  const expected = Object.fromEntries(overview.points.filter((point) => point.diversity.prediction_diversity !== null).map((point) => [point.exact_configuration, point.model.brier_index - point.matched_market.brier_index > 1e-12]));
  await expect.poll(async () => Object.fromEntries(await chart.locator(".market-performance-hit").evaluateAll((points) => points.map((point) => [point.getAttribute("data-configuration"), Boolean(point.querySelector(".market-win-badge"))])))).toEqual(expected);
  expect(await markerSignature()).toEqual(before);
  await expect(bottomToggle).not.toBeChecked();
  await expect(bottom.locator(".model-market-point .market-win-badge")).toHaveCount(0);

  const kimi = overviewPoint(page, "Kimi-K2-Instruct-0905 (zero shot with freeze values)");
  await expect(kimi).toHaveAttribute("data-market-comparison", "below");
  await expect(kimi.locator(".market-win-badge")).toHaveCount(0);
  await kimi.focus();
  await kimi.press("Enter");
  await expect(page.locator(".market-performance-inspector .market-win-verdict")).toContainText("Below matched market");

  await bottomToggle.check();
  await topToggle.uncheck();
  await expect(bottomToggle).toBeChecked();
  await expect(chart.locator(".market-win-badge")).toHaveCount(0);
  await expect(bottom.locator(".model-market-point .market-win-badge").first()).toBeAttached();
  await expect(page.locator(".market-performance-baseline, .model-market-baseline")).toHaveCount(0);
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
