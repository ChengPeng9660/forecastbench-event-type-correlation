import { expect, test, type Page } from "@playwright/test";

const grok = "Grok-4-Fast-Reasoning (zero shot with freeze values)";
const scratchpad = "DeepSeek-R1 (scratchpad)";
const freezeScratchpad = "DeepSeek-R1 (scratchpad with freeze values)";

function overviewPoint(page: Page, exact: string) {
  return page.locator(`.market-performance-hit[data-configuration=${JSON.stringify(exact)}]`);
}

async function activate(page: Page, exact: string) {
  const point = overviewPoint(page, exact);
  await point.focus();
  await point.press("Enter");
  const block = page.locator("#configuration-pair-aggregation");
  await expect(block.locator(".configuration-pair-base")).toHaveText(exact);
  await expect(block.getByLabel("Exact configuration aggregation method")).toBeVisible();
  return block;
}

test("loads the selected exact configuration on activation, with every metric and method", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/configuration-pair-aggregation/")) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#market-performance");
  const point = overviewPoint(page, grok);
  await expect(point).toBeAttached();
  await point.focus();
  await expect(page.locator("#configuration-pair-aggregation")).toHaveCount(0);
  expect(requests).toEqual([]);

  const block = await activate(page, grok);
  const metrics = block.getByRole("group", { name: "Exact configuration diversity metric" });
  await expect(metrics.getByRole("button")).toHaveCount(5);
  await metrics.getByRole("button", { name: "Total variation (TV)", exact: true }).click();
  await expect(block.getByRole("img")).toHaveAccessibleName(/Total variation \(TV\)/);
  const methods = block.getByLabel("Exact configuration aggregation method");
  await expect(methods.locator("option")).toHaveCount(6);
  for (const method of ["simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional", "best_single"]) {
    await methods.selectOption(method);
    await expect(block.locator(".configuration-pair-base")).toHaveText(grok);
    await expect(block.locator(".configuration-pair-point").first()).toBeAttached();
  }
  const outcomes = block.getByRole("group", { name: "Exact configuration aggregation outcome" });
  for (const label of ["Raw Brier ↓", "Gain vs base", "Gain vs market", "Aggregation BI ↑"]) {
    await outcomes.getByRole("button", { name: label, exact: true }).click();
    await expect(block.getByRole("img")).toHaveAccessibleName(new RegExp(label));
  }
  const folds = block.getByRole("group", { name: "Exact configuration cross-fit view" });
  for (const label of ["A→B", "B→A", "Combined"]) {
    await folds.getByRole("button", { name: label, exact: true }).click();
    await expect(folds.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(block.locator(".configuration-pair-base")).toHaveText(grok);
  }
  await block.getByLabel("Exact configuration support").selectOption("at_least_50");
  await expect(block.getByLabel("Exact configuration support")).toHaveValue("at_least_50");
  await block.getByLabel("Exact configuration train sample").selectOption("near_bi");
  await expect(block.getByLabel("Exact configuration train sample")).toHaveValue("near_bi");
  expect(requests.filter((url) => url.endsWith("manifest.json"))).toHaveLength(1);
  expect(errors).toEqual([]);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] + 1);
});

test("supports previously uncovered scratchpad configurations without swapping information conditions", async ({ page }) => {
  await page.goto("/#market-performance");
  let block = await activate(page, scratchpad);
  await block.getByRole("group", { name: "Exact configuration diversity metric" }).getByRole("button", { name: "Total variation (TV)" }).click();
  await block.getByRole("group", { name: "Exact configuration aggregation outcome" }).getByRole("button", { name: "Raw Brier ↓", exact: true }).click();
  await expect(block.locator(".configuration-pair-point").first()).toBeAttached();
  await block.getByLabel("Aggregation partner provider").selectOption("OpenAI");
  await expect(block.getByLabel("Aggregation partner provider")).toHaveValue("OpenAI");
  await expect(block.locator(".configuration-pair-base")).toHaveText(scratchpad);

  // Focusing another overview point only previews its inspector.
  await overviewPoint(page, freezeScratchpad).focus();
  await expect(block.locator(".configuration-pair-base")).toHaveText(scratchpad);
  await overviewPoint(page, freezeScratchpad).press("Enter");
  block = page.locator("#configuration-pair-aggregation");
  await expect(block.locator(".configuration-pair-base")).toHaveText(freezeScratchpad);
  await expect(block.getByLabel("Exact configuration aggregation method")).toBeVisible();
  await expect(block.locator(".configuration-pair-point").first()).toBeAttached();
  const gradients = block.locator("linearGradient");
  await expect(gradients.first()).toHaveAttribute("data-base", freezeScratchpad);
  const firstStops = gradients.first().locator("stop");
  await expect(firstStops.nth(0)).toHaveAttribute("offset", "0%");
  await expect(firstStops.nth(1)).toHaveAttribute("offset", "50%");
  await expect(firstStops.nth(2)).toHaveAttribute("offset", "50%");
  await expect(firstStops.nth(3)).toHaveAttribute("offset", "100%");
});

test("the primary entry is available to every overview configuration, independent of older studies", async ({ page }) => {
  await page.goto("/#market-performance");
  const point = overviewPoint(page, scratchpad);
  await point.focus();
  const inspector = page.locator(".market-performance-inspector").first();
  await expect(inspector.getByRole("button", { name: "Explore aggregation ↓", exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "Explore aggregation ↓", exact: true }).click();
  const block = page.locator("#configuration-pair-aggregation");
  await expect(block.locator(".configuration-pair-base")).toHaveText(scratchpad);
  await expect(block.getByLabel("Exact configuration aggregation method")).toBeVisible();
  await expect(page).toHaveURL(/#market-performance$/);
});
