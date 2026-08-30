import { expect, test, type Page } from "@playwright/test";

const CLAUDE = "Claude-Haiku-4-5-20251001";

async function expectLeftColor(page: Page, color: string) {
  const chart = page.locator("#gain .pair-aggregation-chart");
  await expect(chart).toBeVisible();
  const gradients = chart.locator("linearGradient");
  await expect(gradients.first()).toBeAttached();
  await expect(gradients.locator(`stop:first-child:not([stop-color="${color}"])`)).toHaveCount(0);
  for (const [name, value] of [["x1", "0%"], ["y1", "0%"], ["x2", "100%"], ["y2", "0%"]]) {
    await expect(gradients.locator(`xpath=self::*[@${name}!='${value}']`)).toHaveCount(0);
  }
}

test("keeps the selected family on the left for all six focal families", async ({ page }) => {
  await page.goto(`/?gain_model=${CLAUDE}&near_bi=0#gain`);
  const focal = page.getByLabel("Aggregation focal model");
  for (const [model, color] of [
    [CLAUDE, "#4f207f"],
    ["Gemini-3-Pro-Preview", "#4285f4"],
    ["Qwen3-235B-A22B-Fp8-Tput", "#267c79"],
    ["DeepSeek-V3.1", "#c75b39"],
    ["Kimi-K2-Thinking", "#1f2937"],
    ["GPT-5-2025-08-07", "#efab02"],
  ]) {
    await focal.selectOption(model);
    await expectLeftColor(page, color);
    const labels = await page.locator("#gain .aggregation-point").evaluateAll((points) => points.map((point) => point.getAttribute("aria-label")));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label?.startsWith(`${model} × `))).toBe(true);
  }

  const pairStops = page.locator("#gain #pair-fill-gpt_claude stop");
  await expect(pairStops.first()).toHaveAttribute("stop-color", "#efab02");
  await expect(pairStops.last()).toHaveAttribute("stop-color", "#4f207f");
  await focal.selectOption(CLAUDE);
  await expect(pairStops.first()).toHaveAttribute("stop-color", "#4f207f");
  await expect(pairStops.last()).toHaveAttribute("stop-color", "#efab02");
});

test("retains focal-left colors across cross-fit views, metrics, and methods", async ({ page }) => {
  await page.goto(`/?gain_model=${CLAUDE}&near_bi=1#gain`);
  const section = page.locator("#gain");
  await expect(section.getByText("Left = selected model · right = partner · area = test support", { exact: true })).toBeVisible();
  for (const direction of ["A→B", "B→A", "Combined"]) {
    await section.getByRole("button", { name: direction, exact: true }).click();
    await expectLeftColor(page, "#4f207f");
  }
  await section.getByRole("button", { name: "All eligible", exact: true }).click();
  await expectLeftColor(page, "#4f207f");
  for (const method of ["simple_mean", "log_odds_mean", "piecewise_odds", "best_single", "ec_w0_56"]) {
    await section.getByLabel("Aggregation method", { exact: true }).selectOption(method);
    await expectLeftColor(page, "#4f207f");
  }
  for (const metric of ["High-loss lift", "Loss correlation", "Adjusted POG", "Total variation (TV)"]) {
    await section.getByRole("tab", { name: metric, exact: true }).click();
    for (const direction of ["A→B", "B→A", "Combined"]) {
      await section.getByRole("button", { name: direction, exact: true }).click();
      await expectLeftColor(page, "#4f207f");
    }
  }
});
