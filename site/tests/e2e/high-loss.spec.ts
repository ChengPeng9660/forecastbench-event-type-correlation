import { expect, test, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "GPT-5.1-2025-11-13 (zero shot with freeze values)";
const sparsePartner = "Claude-Opus-4-1-20250805 (zero shot)";
const outlierPartner = "Qwen3-235B-A22B-Thinking-2507 (zero shot with freeze values)";
const rawMinimum = -34.26282051282051;

function valueFor(container: Locator, label: string) {
  return container.locator("div").filter({ has: container.page().getByText(label, { exact: true }) }).locator("dd");
}

test("real GPT-5.1 high-loss data keeps raw extremes, strict missingness, and sparse-direction warnings", async ({ page }, testInfo) => {
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
  const notice = block.getByRole("note", { name: "High-loss metric diagnostics" });
  const kpis = block.locator(".configuration-pair-kpis");

  // The all-direction scores exist, but every one of the 46 coordinates has
  // at least one undefined training fold. Missing X must not become 0 or 1.
  await expect(valueFor(kpis, "VISIBLE PARTNERS")).toHaveText("0");
  await expect(block.locator(".configuration-pair-point")).toHaveCount(0);
  await expect(block.getByText("No defined pair estimates in this view.", { exact: true })).toBeVisible();
  await expect(notice).not.toContainText("candidates have an undefined high-loss coordinate");
  await expect(notice).not.toContainText("46 / 46");
  await expect(block.getByText(/view\(s\) have an undefined selected diversity metric/)).toHaveCount(0);

  await block.getByLabel("Exact configuration train sample").selectOption("near_bi");
  await expect(valueFor(kpis, "VISIBLE PARTNERS")).toHaveText("7");
  await expect(valueFor(kpis, "RETAINED DIRECTIONS")).toHaveText("1–3");
  await expect(valueFor(kpis, "PEARSON r")).toHaveText("—");
  await expect(notice).not.toContainText("candidates have an undefined high-loss coordinate");
  await expect(notice).not.toContainText("22 / 29");
  await expect(notice.getByText(/7 plotted pairs retain fewer than half of the attempted directions/)).toBeHidden();
  await expect(notice).toContainText("only 2 distinct high-loss values");
  await expect(block.getByText(/Spearman ρ: —/)).toBeVisible();
  await expect(block.getByText(/Limited retained directions: 7 displayed pair\(s\)/)).toBeVisible();

  // Adequate total target support is not a substitute for marginal high-loss
  // counts or retained-direction coverage: all seven still pass this filter.
  await block.getByLabel("Exact configuration support").selectOption("at_least_50");
  await expect(block.locator(".configuration-pair-point")).toHaveCount(7);
  await expect(valueFor(kpis, "SMALL-SUPPORT PAIRS")).toHaveText("0");
  await expect(valueFor(kpis, "RETAINED DIRECTIONS")).toHaveText("1–3");
  await expect(valueFor(kpis, "PEARSON r")).toHaveText("—");

  const chart = block.locator(".configuration-pair-chart");
  await expect(chart).toContainText("signed-log display; raw ticks");
  const ticks = await chart.locator("text.market-performance-tick").evaluateAll((nodes) => nodes
    .filter((node) => Number(node.getAttribute("y")) === 416)
    .map((node) => ({ raw: Number(node.textContent), position: Number(node.getAttribute("x")) })));
  expect(ticks.length).toBeGreaterThanOrEqual(6);
  expect(Math.min(...ticks.map((tick) => tick.raw))).toBe(-34.263);
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
  await expect(outlier).toHaveAttribute("aria-label", /High-loss diversity: -34\.263/);
  await expect(outlier).toHaveAttribute("transform", /^translate\(80 /);
  await outlier.focus();
  const inspector = block.locator(".configuration-pair-inspector");
  await expect(valueFor(inspector, "High-loss diversity")).toHaveText("-34.263");
  await expect(valueFor(inspector, "Retained training directions")).toHaveText("3/20");

  const sparse = chart.locator(`.configuration-pair-point[data-partner=${JSON.stringify(sparsePartner)}]`);
  await expect(sparse).toHaveAttribute("transform", /^translate\(950 /);
  await sparse.focus();
  await expect(valueFor(inspector, "High-loss diversity")).toHaveText("1.000");
  await expect(valueFor(inspector, "Aggregation BI ↑")).toHaveText("78.40");
  await expect(valueFor(inspector, "Gain vs base")).toHaveText("-45.8%");
  await expect(valueFor(inspector, "Min marginal high-loss counts A / B")).toHaveText("2 / 1");
  await expect(valueFor(inspector, "Min joint high-loss count")).toHaveText("0");
  await expect(valueFor(inspector, "Defined high-loss directions")).toHaveText("1 / 1");
  await expect(valueFor(inspector, "Retained training directions")).toHaveText("1/20");
  await notice.getByText("How to interpret this metric", { exact: true }).click();
  await expect(notice.getByText(/7 plotted pairs retain fewer than half of the attempted directions/)).toBeVisible();
  await expect(notice).toContainText("6 displayed points have this value.");
  await expect(notice).toContainText("not perfect complementarity");
  await expect(notice).toContainText("its outcome is not paired with a partial-direction coordinate");
  await expect(notice).toContainText("not a significance test");

  const screenshot = testInfo.outputPath("gpt-5-1-high-loss-near-bi.png");
  await block.screenshot({ path: screenshot, animations: "disabled" });
  await testInfo.attach("GPT-5.1 raw high-loss diagnostics", { path: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
});

test("overview High-loss plots exactly the finite configurations without an undefined-count banner", async ({ page }) => {
  const payload = JSON.parse(readFileSync(new URL("../../public/data/polymarket-aggregation/market-diversity-performance.json", import.meta.url), "utf8")) as {
    points: Array<{ exact_configuration: string; diversity: { high_loss_lift: number | null } }>;
  };
  const finite = payload.points.filter((point) => point.diversity.high_loss_lift !== null && Number.isFinite(point.diversity.high_loss_lift));
  const missing = payload.points.filter((point) => point.diversity.high_loss_lift === null);
  expect(finite).toHaveLength(196);
  expect(missing).toHaveLength(42);

  await page.goto("/#market-performance");
  const block = page.locator("#market-performance");
  await expect(page.getByLabel("Market performance provider", { exact: true })).toHaveValue("all");
  await expect(page.getByRole("group", { name: "Market performance prompt filter", exact: true }).getByRole("button", { name: "All prompts", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Market performance information filter", exact: true }).getByRole("button", { name: "All information", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "Market performance diversity metric", exact: true }).getByRole("button", { name: "High-loss diversity", exact: true }).click();
  const points = block.locator(".market-performance-hit");
  await expect(points).toHaveCount(196);
  const plotted = await points.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-configuration")));
  expect(plotted.sort()).toEqual(finite.map((point) => point.exact_configuration).sort());
  expect(missing.every((point) => !plotted.includes(point.exact_configuration))).toBe(true);
  expect(await points.evaluateAll((nodes) => nodes.every((node) => !/NaN|Infinity/.test(node.getAttribute("transform") ?? "")))).toBe(true);

  const notice = block.locator(":scope > .high-loss-notice");
  await expect(notice).not.toContainText("candidates have an undefined high-loss coordinate");
  await expect(notice).not.toContainText("42 / 238");
  await expect(notice.getByText("High-loss diversity: signed-log spacing.", { exact: true })).toBeVisible();
  const details = notice.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  const sparseCount = notice.getByText(/209 candidate pairs have fewer than 5 high-loss records/);
  await expect(sparseCount).toBeHidden();
  await details.getByText("How to interpret this metric", { exact: true }).click();
  await expect(sparseCount).toBeVisible();
});
