import { expect, test, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "GPT-5.1-2025-11-13 (zero shot with freeze values)";
const sparsePartner = "Claude-Opus-4-1-20250805 (zero shot)";
const outlierPartner = "Grok-4-1-Fast-Non-Reasoning (zero shot with freeze values)";
const rawMinimum = -30.06787521079258;

function valueFor(container: Locator, label: string) {
  return container.locator("div").filter({ has: container.page().getByText(label, { exact: true }) }).locator("dd");
}

test("real GPT-5.1 high-loss data retains the negative extreme while hiding nulls, one-valued points, and explanations", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#market-performance");
  const overview = page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(base)}]`);
  await expect(overview).toBeAttached();
  await overview.focus();
  await overview.press("Enter");

  const block = page.locator("#configuration-pair-aggregation");
  await expect(block.locator(".configuration-pair-base")).toHaveText(base);
  await block.getByLabel("Exact configuration aggregation method").selectOption("cf_directional");
  const metric = block.getByRole("group", { name: "Exact configuration diversity metric" });
  await metric.getByRole("button", { name: "High-loss diversity", exact: true }).click();
  const kpis = block.locator(".configuration-pair-kpis");

  // The all-direction scores exist, but every one of the 46 coordinates has
  // at least one undefined training fold. Missing X must not become 0 or 1.
  await expect(valueFor(kpis, "VISIBLE PARTNERS")).toHaveText("0");
  await expect(block.locator(".configuration-pair-point")).toHaveCount(0);
  await expect(block.getByText("No pair estimates to plot in this view.", { exact: true })).toBeVisible();
  await expect(block.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveCount(0);
  await expect(block.getByText("How to interpret this metric", { exact: true })).toHaveCount(0);
  await expect(block.getByText(/view\(s\) have an undefined selected diversity metric/)).toHaveCount(0);

  await block.getByLabel("Exact configuration train sample").selectOption("near_bi");
  await expect(valueFor(kpis, "VISIBLE PARTNERS")).toHaveText("1");
  await expect(valueFor(kpis, "RETAINED DIRECTIONS")).toHaveText("8–8");
  await expect(valueFor(kpis, "PEARSON r")).toHaveText("—");
  await expect(block.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveCount(0);
  await expect(block.getByText("How to interpret this metric", { exact: true })).toHaveCount(0);
  await expect(block.getByText(/Spearman ρ: —/)).toBeVisible();
  await expect(block.getByText(/Limited retained directions: 1 displayed pair\(s\)/)).toBeVisible();

  // Adequate total target support is not a substitute for marginal high-loss
  // counts or retained-direction coverage: the retained extreme still passes.
  await block.getByLabel("Exact configuration support").selectOption("at_least_50");
  await expect(block.locator(".configuration-pair-point")).toHaveCount(1);
  await expect(valueFor(kpis, "SMALL-SUPPORT PAIRS")).toHaveText("0");
  await expect(valueFor(kpis, "RETAINED DIRECTIONS")).toHaveText("8–8");
  await expect(valueFor(kpis, "PEARSON r")).toHaveText("—");

  const chart = block.locator(".configuration-pair-chart");
  await expect(chart).toContainText("signed-log display; raw ticks");
  const ticks = await chart.locator("text.market-performance-tick").evaluateAll((nodes) => nodes
    .filter((node) => Number(node.getAttribute("y")) === 416)
    .map((node) => ({ raw: Number(node.textContent), position: Number(node.getAttribute("x")) })));
  expect(ticks.length).toBeGreaterThanOrEqual(6);
  expect(Math.min(...ticks.map((tick) => tick.raw))).toBe(-30.068);
  expect(Math.max(...ticks.map((tick) => tick.raw))).toBe(1);
  const signedLog = (value: number) => Math.sign(value) * Math.log1p(Math.abs(value));
  const expectedPosition = (raw: number) => 80 + (signedLog(raw) - signedLog(rawMinimum))
    / (signedLog(1) - signedLog(rawMinimum)) * 870;
  for (const tick of ticks) {
    expect(Number.isFinite(tick.position)).toBe(true);
    expect(Math.abs(tick.position - expectedPosition(tick.raw))).toBeLessThan(0.2);
  }
  const independence = ticks.find((tick) => tick.raw === 0);
  expect(independence).toBeDefined();
  // This distinguishes signed-log geometry from a relabeled linear axis.
  const linearZero = 80 + -rawMinimum / (1 - rawMinimum) * 870;
  expect(Math.abs(independence!.position - linearZero)).toBeGreaterThan(100);

  const outlier = chart.locator(`.configuration-pair-point[data-partner=${JSON.stringify(outlierPartner)}]`);
  await expect(outlier).toHaveAttribute("aria-label", /High-loss diversity: -30\.068/);
  await expect(outlier).toHaveAttribute("transform", /^translate\(80 /);
  await outlier.focus();
  const inspector = block.locator(".configuration-pair-inspector");
  await expect(valueFor(inspector, "High-loss diversity")).toHaveText("-30.068");
  await expect(valueFor(inspector, "Retained training directions")).toHaveText("8/20");

  const sparse = chart.locator(`.configuration-pair-point[data-partner=${JSON.stringify(sparsePartner)}]`);
  await expect(sparse).toHaveCount(0);
  await expect(block.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveCount(0);
  await expect(block.getByText("How to interpret this metric", { exact: true })).toHaveCount(0);

  // Changing the display metric restores the excluded exact partner and its
  // original method scores; no stored predictions or losses were changed.
  await metric.getByRole("button", { name: "Prediction diversity", exact: true }).click();
  await expect(sparse).toBeAttached();
  await sparse.focus();
  await expect(valueFor(inspector, "Aggregation BI ↑")).toHaveText("81.22");
  await expect(valueFor(inspector, "Gain vs base")).toHaveText("-93.5%");
  await expect(valueFor(inspector, "Retained training directions")).toHaveText("2/20");
  await metric.getByRole("button", { name: "High-loss diversity", exact: true }).click();
  await expect(sparse).toHaveCount(0);

  const screenshot = testInfo.outputPath("gpt-5-1-high-loss-near-bi.png");
  await block.screenshot({ path: screenshot, animations: "disabled" });
  await testInfo.attach("GPT-5.1 raw high-loss diagnostics", { path: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
});

test("overview High-loss removes its explanation and exact-one points without changing other metrics or selection", async ({ page }) => {
  const payload = JSON.parse(readFileSync(new URL("../../public/data/polymarket-aggregation/market-diversity-performance.json", import.meta.url), "utf8")) as {
    points: Array<{ exact_configuration: string; diversity: { high_loss_lift: number | null } }>;
  };
  const finite = payload.points.filter((point) => point.diversity.high_loss_lift !== null && Number.isFinite(point.diversity.high_loss_lift));
  const missing = payload.points.filter((point) => point.diversity.high_loss_lift === null);
  const ones = finite.filter((point) => point.diversity.high_loss_lift === 1);
  const eligible = finite.filter((point) => point.diversity.high_loss_lift !== 1);
  expect(finite).toHaveLength(196);
  expect(missing).toHaveLength(42);
  expect(ones).toHaveLength(28);
  expect(eligible).toHaveLength(168);

  await page.goto("/#market-performance");
  const block = page.locator("#market-performance");
  await expect(page.getByLabel("Market performance provider", { exact: true })).toHaveValue("all");
  await expect(page.getByRole("group", { name: "Market performance prompt filter", exact: true }).getByRole("button", { name: "All prompts", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Market performance information filter", exact: true }).getByRole("button", { name: "All information", exact: true })).toHaveAttribute("aria-pressed", "true");
  const selectedExact = ones[0].exact_configuration;
  const selectedPoint = page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(selectedExact)}]`);
  await selectedPoint.focus();
  await expect(selectedPoint).toHaveAttribute("aria-pressed", "true");
  const metrics = page.getByRole("group", { name: "Market performance diversity metric", exact: true });
  await metrics.getByRole("button", { name: "High-loss diversity", exact: true }).click();
  const points = block.locator(".market-performance-hit");
  await expect(points).toHaveCount(168);
  const plotted = await points.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-configuration")));
  expect(plotted.sort()).toEqual(eligible.map((point) => point.exact_configuration).sort());
  expect(missing.every((point) => !plotted.includes(point.exact_configuration))).toBe(true);
  expect(ones.every((point) => !plotted.includes(point.exact_configuration))).toBe(true);
  expect(await points.evaluateAll((nodes) => nodes.every((node) => !/NaN|Infinity/.test(node.getAttribute("transform") ?? "")))).toBe(true);

  await expect(block.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveCount(0);
  await expect(block.getByText("How to interpret this metric", { exact: true })).toHaveCount(0);
  await expect(block.getByText(/209 candidate pairs have fewer than 5 high-loss records/)).toHaveCount(0);
  await expect(block.locator('.market-performance-hit[aria-pressed="true"]')).toHaveCount(0);
  await expect(block.locator(".market-performance-inspector")).toContainText(selectedExact);
  await expect(block.locator(".market-performance-inspector")).toContainText("High-loss diversity = 1 is hidden in this chart");
  await metrics.getByRole("button", { name: "Prediction diversity", exact: true }).click();
  await expect(points).toHaveCount(238);
  await expect(selectedPoint).toHaveAttribute("aria-pressed", "true");
});

test("the final model-market chart has no high-loss explanation and retains its 28 eligible results", async ({ page }) => {
  const payload = JSON.parse(readFileSync(new URL("../../public/data/model-market-aggregation/summary.json", import.meta.url), "utf8")) as {
    points: Array<{ configuration: { exact_configuration: string }; views: { all: { combined: { train_diversity: { high_loss_lift: number | null } } | null } } }>;
  };
  const expected = payload.points.filter((point) => {
    const value = point.views.all.combined?.train_diversity.high_loss_lift;
    return typeof value === "number" && Number.isFinite(value) && value !== 1;
  }).map((point) => point.configuration.exact_configuration).sort();
  expect(expected).toHaveLength(28);
  await page.goto("/#market-performance");
  const block = page.locator("#model-market-aggregation");
  await block.getByRole("group", { name: "Model + market diversity metric", exact: true }).getByRole("button", { name: "High-loss diversity", exact: true }).click();
  const points = block.locator(".model-market-point");
  await expect(points).toHaveCount(28);
  expect((await points.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-configuration")))).sort()).toEqual(expected);
  await expect(block.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveCount(0);
  await expect(block.getByText("How to interpret this metric", { exact: true })).toHaveCount(0);
  await expect(block.getByLabel("Model + market aggregation method")).toHaveValue("ec_w0_56");
  await expect(block.getByLabel("Model + market aggregation method").locator("option")).toHaveCount(6);
});
