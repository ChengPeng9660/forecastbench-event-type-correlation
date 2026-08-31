import { expect, test, type Page } from "@playwright/test";

const GROUPS = [
  { name: "Diversity", sections: ["matrix", "global", "ranking", "model-view", "stability"] },
  { name: "Aggregation", sections: ["gain", "complementarity", "fixed-focal-no-freeze", "without-freeze-base"] },
  { name: "Markets", sections: ["market-performance", "polymarket-aggregation", "freeze-correlation", "upper-left-pairs"] },
  { name: "Methods", sections: ["methods", "audit"] },
] as const;

const PANEL_IDS = ["overview", ...GROUPS.flatMap((group) => [...group.sections])];
const VISIBLE_PANELS = PANEL_IDS.map((id) => `#${id}:visible`).join(", ");

async function expectPanel(page: Page, id: string) {
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
  await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator(VISIBLE_PANELS)).toHaveCount(1);
  const group = GROUPS.find((item) => item.sections.some((section) => section === id));
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: group?.name ?? "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  if (group) {
    await expect(page.getByRole("navigation", { name: "Research sections" }).locator(`a[href="#${id}"]`)).toHaveAttribute("aria-current", "page");
  }
}

test("opens a public overview instead of every research block", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#overview").getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(VISIBLE_PANELS)).toHaveCount(1);
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  for (const label of ["Overview", "Diversity", "Aggregation", "Markets", "Methods"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Analysis filters" })).toBeHidden();
  await expect(page.getByTestId("heatmap")).toBeHidden();
  await expect(page.locator("#polymarket-aggregation")).toBeHidden();
  expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Han}/u);
});

test("makes every existing experiment reachable through the two-level navigation", async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const group of GROUPS) {
    await navigation.getByRole("link", { name: group.name, exact: true }).click();
    await expectPanel(page, group.sections[0]);
    const sections = page.getByRole("navigation", { name: "Research sections" });
    await expect(sections.getByRole("link")).toHaveCount(group.sections.length);
    for (const id of group.sections) {
      const link = sections.locator(`a[href="#${id}"]`);
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await link.click();
      await expectPanel(page, id);
      await expect(page.locator(`#${id}`).getByRole("heading").first()).toBeVisible();
      await expect(page.locator(`#${id}[aria-busy="true"]`)).toHaveCount(0);
      const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
      expect(dimensions.page, `${id} must not overflow the viewport`).toBeLessThanOrEqual(dimensions.viewport + 1);
    }
  }
  await navigation.getByRole("link", { name: "Overview", exact: true }).click();
  await expectPanel(page, "overview");
  await expect(page.getByRole("navigation", { name: "Research sections" })).toBeHidden();
  expect(runtimeErrors).toEqual([]);
});

test("keeps technical interpretation available in a closed disclosure", async ({ page }) => {
  await page.goto("/#gain");
  const section = page.locator("#gain");
  const details = section.locator("details.research-details");
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.locator("summary")).toBeVisible();
  await expect(details.locator(".research-details-content")).toBeHidden();
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator(".research-details-content")).toBeVisible();
  await expect(details).toContainText(/train|test|out-of-sample/i);
  await details.locator("summary").click();
  await expect(details.locator(".research-details-content")).toBeHidden();
  await expect(section.getByLabel("Aggregation focal model")).toBeVisible();
});

test("preserves shared analysis filters when readers visit a different group", async ({ page }) => {
  await page.goto("/?type=finance_economics&metric=adjusted_pog&min_n=50&near_bi=1#matrix");
  await page.getByLabel("Metric", { exact: true }).selectOption("high_loss_lift");
  await page.locator(".filter-dock summary").click();
  await page.getByLabel("Provider", { exact: true }).selectOption("OpenAI");
  const focal = page.getByLabel("Focal model", { exact: true });
  const focalId = await focal.locator("option").nth(1).getAttribute("value");
  expect(focalId).toBeTruthy();
  await focal.selectOption(focalId!);
  const overlap = page.getByLabel("Minimum overlap", { exact: true });
  await overlap.focus();
  await overlap.press("Home");
  await overlap.press("ArrowRight");
  await overlap.press("ArrowRight");
  await expect(overlap).toHaveValue("100");
  await page.getByLabel("Near-BI only", { exact: true }).uncheck();
  await expect(page).toHaveURL(/near_bi=0/);

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("link", { name: "Markets", exact: true }).click();
  await expectPanel(page, "market-performance");
  await expect(page.getByRole("region", { name: "Analysis filters" })).toBeHidden();
  await navigation.getByRole("link", { name: "Diversity", exact: true }).click();
  await expectPanel(page, "matrix");
  await page.locator(".filter-dock summary").click();
  await expect(page.getByLabel("Event type", { exact: true })).toHaveValue("finance_economics");
  await expect(page.getByLabel("Metric", { exact: true })).toHaveValue("high_loss_lift");
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("OpenAI");
  await expect(focal).toHaveValue(focalId!);
  await expect(overlap).toHaveValue("100");
  await expect(page.getByLabel("Near-BI only", { exact: true })).not.toBeChecked();

  await page.getByLabel("Provider", { exact: true }).selectOption("all");
  await expect(focal).toHaveValue("");
  await expect.poll(() => new URL(page.url()).searchParams.has("provider")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has("model")).toBe(false);
  await expect(page).toHaveURL(/metric=high_loss_lift/);
});

test("restores sections through browser history without losing the initial focal query", async ({ page }) => {
  await page.goto("/?type=finance_economics&metric=high_loss_lift&min_n=100&near_bi=0&gain_model=Claude-3-7-Sonnet-20250219&gain_fold=b_to_a#matrix");
  await expectPanel(page, "matrix");
  await expect(page.getByLabel("Metric", { exact: true })).toHaveValue("high_loss_lift");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("link", { name: "Aggregation", exact: true }).click();
  await expectPanel(page, "gain");
  await expect(page.getByLabel("Aggregation focal model")).toHaveValue("Claude-3-7-Sonnet-20250219");
  await expect(page.getByRole("group", { name: "Cross-fit fold view", exact: true }).getByRole("button", { name: "B→A", exact: true })).toHaveClass(/active/);
  await navigation.getByRole("link", { name: "Markets", exact: true }).click();
  await expectPanel(page, "market-performance");

  await page.goBack();
  await expectPanel(page, "gain");
  await expect(page.getByLabel("Aggregation focal model")).toHaveValue("Claude-3-7-Sonnet-20250219");
  await page.goBack();
  await expectPanel(page, "matrix");
  await expect(page.getByLabel("Metric", { exact: true })).toHaveValue("high_loss_lift");
  await page.goForward();
  await expectPanel(page, "gain");
  await expect(page.getByLabel("Aggregation focal model")).toHaveValue("Claude-3-7-Sonnet-20250219");
  await expect(page).toHaveURL(/gain_fold=b_to_a/);
});

test("retains a fixed-focal experiment's own controls while its panel is hidden", async ({ page }) => {
  await page.goto("/?nofreeze_base=GPT-5-2025-08-07#fixed-focal-no-freeze");
  const section = page.locator("#fixed-focal-no-freeze");
  await expect(section.getByLabel("Without-freeze base model")).toHaveValue("GPT-5-2025-08-07");
  await section.getByLabel("Without-freeze base model").selectOption("Claude-3-7-Sonnet-20250219");
  await section.getByRole("button", { name: "B→A", exact: true }).click();
  await section.getByRole("button", { name: "Aggregation BI", exact: true }).click();
  await section.getByRole("button", { name: "Near-BI", exact: true }).click();
  await expect(page).toHaveURL(/nofreeze_base=Claude-3-7-Sonnet-20250219/);

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("link", { name: "Markets", exact: true }).click();
  await expectPanel(page, "market-performance");
  await expect(section).toBeHidden();
  await navigation.getByRole("link", { name: "Aggregation", exact: true }).click();
  await page.getByRole("navigation", { name: "Research sections" }).locator('a[href="#fixed-focal-no-freeze"]').click();
  await expectPanel(page, "fixed-focal-no-freeze");
  await expect(section.getByLabel("Without-freeze base model")).toHaveValue("Claude-3-7-Sonnet-20250219");
  await expect(section.getByRole("button", { name: "B→A", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByRole("button", { name: "Aggregation BI", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByRole("button", { name: "Near-BI", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("keeps the original top hash as an overview link", async ({ page }) => {
  await page.goto("/?gain_model=GPT-5-2025-08-07#top");
  await expect(page.locator("#overview").getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(VISIBLE_PANELS)).toHaveCount(1);
  await expect(page).toHaveURL(/gain_model=GPT-5-2025-08-07/);
});

test("restores an older focal query after an edited experiment is revisited", async ({ page }) => {
  await page.goto("/?gain_model=GPT-5-2025-08-07&gain_fold=a_to_b&near_bi=0#gain");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const section = page.locator("#gain");
  await expect(section.getByLabel("Aggregation focal model")).toHaveValue("GPT-5-2025-08-07");
  await navigation.getByRole("link", { name: "Diversity", exact: true }).click();
  await navigation.getByRole("link", { name: "Aggregation", exact: true }).click();
  await section.getByLabel("Aggregation focal model").selectOption("Claude-3-7-Sonnet-20250219");
  await section.getByRole("button", { name: "B→A", exact: true }).click();
  await expect(page).toHaveURL(/gain_model=Claude-3-7-Sonnet-20250219/);
  await expect(page).toHaveURL(/gain_fold=b_to_a/);
  await page.goBack();
  await expectPanel(page, "matrix");
  await expect(page).toHaveURL(/gain_model=GPT-5-2025-08-07/);
  await navigation.getByRole("link", { name: "Aggregation", exact: true }).click();
  await expect(section.getByLabel("Aggregation focal model")).toHaveValue("GPT-5-2025-08-07");
  await expect(section.getByText("Cross-fit OOS", { exact: true })).toBeVisible();
  await expect(section.getByRole("group", { name: "Cross-fit fold view", exact: true }).getByRole("button", { name: "A→B", exact: true })).toHaveClass(/active/);
  await page.reload();
  await expect(section.getByLabel("Aggregation focal model")).toHaveValue("GPT-5-2025-08-07");
});

test("redirects archived evaluation query state to cross-fit", async ({ page }) => {
  await page.goto("/?gain_eval=same_sample&gain_model=GPT-5-2025-08-07&gain_fold=b_to_a&near_bi=0#gain");
  const section = page.locator("#gain");
  await expect(section.getByText("Cross-fit OOS", { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/gain_eval=/);
  await expect(section.getByRole("button", { name: "B→A", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Same-sample diagnostic", exact: true })).toHaveCount(0);
});

test("restores global and atlas filters from earlier history entries", async ({ page }) => {
  await page.goto("/?metric=adjusted_pog&near_bi=0&global_metric=adjusted_pog&global_provider=all#global");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const sections = page.getByRole("navigation", { name: "Research sections" });
  const global = page.locator("#global");
  await expect(global.getByRole("tab", { name: "Adjusted POG", exact: true })).toHaveClass(/active/);
  await navigation.getByRole("link", { name: "Diversity", exact: true }).click();
  await sections.getByRole("link", { name: "Global view", exact: true }).click();
  await global.getByRole("tab", { name: "High-loss lift", exact: true }).click();
  await global.getByLabel("Global matrix provider").selectOption("OpenAI");
  await page.goBack();
  await expectPanel(page, "matrix");
  await sections.getByRole("link", { name: "Global view", exact: true }).click();
  await expect(global.getByRole("tab", { name: "Adjusted POG", exact: true })).toHaveClass(/active/);
  await expect(global.getByLabel("Global matrix provider")).toHaveValue("all");
  await navigation.getByRole("link", { name: "Diversity", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).selectOption("high_loss_lift");
  await page.goBack();
  await expectPanel(page, "global");
  await navigation.getByRole("link", { name: "Diversity", exact: true }).click();
  await expect(page.getByLabel("Metric", { exact: true })).toHaveValue("adjusted_pog");
});

test("restores the URL-backed without-freeze focal after history changes", async ({ page }) => {
  await page.goto("/?nofreeze_base=GPT-5-2025-08-07#fixed-focal-no-freeze");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const section = page.locator("#fixed-focal-no-freeze");
  await expect(section.getByLabel("Without-freeze base model")).toHaveValue("GPT-5-2025-08-07");
  await navigation.getByRole("link", { name: "Aggregation", exact: true }).click();
  const link = page.getByRole("navigation", { name: "Research sections" }).getByRole("link", { name: "Without market information", exact: true });
  await link.click();
  await section.getByLabel("Without-freeze base model").selectOption("Claude-3-7-Sonnet-20250219");
  await expect(page).toHaveURL(/nofreeze_base=Claude-3-7-Sonnet-20250219/);
  await page.goBack();
  await expectPanel(page, "gain");
  await link.click();
  await expect(section.getByLabel("Without-freeze base model")).toHaveValue("GPT-5-2025-08-07");
  await expect(page).toHaveURL(/nofreeze_base=GPT-5-2025-08-07/);
});
