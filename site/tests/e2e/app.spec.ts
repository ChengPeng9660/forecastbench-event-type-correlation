import { expect, test } from "@playwright/test";

const crossTypeTopics = [
  ["finance_economics", "Finance & Economics"],
  ["politics_conflict", "Politics & Conflict"],
  ["climate_weather", "Climate & Weather"],
  ["health_science", "Health & Science"],
  ["technology_ai", "Technology & AI"],
  ["sports", "Sports"],
  ["entertainment_culture", "Entertainment & Culture"],
].map(([id, label_en]) => ({ id, label_en }));

const crossTypeMetrics = [
  { id: "adjusted_pog", label: "Adjusted Pairwise Oracle Gain", dependence_direction: "higher" },
  { id: "high_loss_lift", label: "Adjusted High-loss Lift", dependence_direction: "lower" },
  { id: "adjusted_loss_corr", label: "Adjusted-loss Correlation", dependence_direction: "lower" },
];

const crossTypeSamples = [
  { id: "near_bi_both", label: "Near-BI in both", primary: true },
  { id: "eligible_both", label: "All eligible pairs", primary: false },
];

function crossTypeFixture() {
  const cells = crossTypeMetrics.flatMap((metric, metricIndex) => crossTypeSamples.flatMap((sample, sampleIndex) => {
    let pairIndex = 0;
    return crossTypeTopics.flatMap((topicA, index) => crossTypeTopics.slice(index + 1).map((topicB) => {
      pairIndex += 1;
      const n = pairIndex === 2 ? 64 : pairIndex === 3 ? 24 : 140 + metricIndex * 3 + sampleIndex;
      const insufficient = n < 30;
      const limited = n < 100 && !insufficient;
      return {
        topic_a: topicA.id,
        topic_b: topicB.id,
        metric_id: metric.id,
        sample_id: sample.id,
        n_pair_universe: 35245,
        n_sample_pairs: n + 18,
        n_defined_pairs: n,
        spearman: insufficient ? null : 0.42 - pairIndex * 0.01,
        pearson: insufficient ? null : 0.38 - pairIndex * 0.01,
        dependent_top_jaccard: insufficient ? null : 0.31,
        complementary_top_jaccard: insufficient ? null : 0.27,
        dependency_persistence_a_to_b: insufficient ? null : 0.52,
        dependency_persistence_b_to_a: insufficient ? null : 0.49,
        complementarity_persistence_a_to_b: insufficient ? null : 0.46,
        complementarity_persistence_b_to_a: insufficient ? null : 0.43,
        dependency_to_complementarity_a_to_b: insufficient ? null : 0.08,
        dependency_to_complementarity_b_to_a: insufficient ? null : 0.06,
        interpretation_status: insufficient ? "insufficient" : limited ? "limited" : "headline",
        reason: insufficient ? "fewer_than_reporting_min_defined_pairs" : null,
      };
    }));
  }));
  return {
    manifest: {
      schema_version: "1.0.0",
      generated_at: "2026-08-19T00:00:00Z",
      topics: crossTypeTopics,
      metrics: crossTypeMetrics,
      samples: crossTypeSamples,
      thresholds: { reporting_min_defined_pairs: 30, headline_min_defined_pairs: 100, quartile: 0.25 },
      summary_json: "cross-type/summary.json",
      summary_csv: "cross-type/summary.csv",
      pair_details_gzip: "cross-type/pair-details.csv.gz",
      audit_json: "cross-type/audit.json",
    },
    summary: {
      schema_version: "1.0.0",
      topic_ids: crossTypeTopics.map((topic) => topic.id),
      metric_ids: crossTypeMetrics.map((metric) => metric.id),
      sample_ids: crossTypeSamples.map((sample) => sample.id),
      thresholds: { reporting_min_defined_pairs: 30, headline_min_defined_pairs: 100 },
      cells,
    },
  };
}

test("filters event type and metric through reproducible URL state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#matrix").getByRole("heading", { name: "Adjusted Pairwise Oracle Gain" })).toBeVisible();
  await page.getByLabel("Metric", { exact: true }).selectOption("high_loss_lift");
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
  await expect(page.locator("#matrix").getByText("PAIR DETAIL", { exact: true })).toHaveCount(0);
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

test("explores descriptive stability across seven event types without inventing sparse estimates", async ({ page }) => {
  const fixture = crossTypeFixture();
  await page.route("**/data/cross-type/manifest.json", (route) => route.fulfill({ json: fixture.manifest }));
  await page.route("**/data/cross-type/summary.json", (route) => route.fulfill({ json: fixture.summary }));
  await page.goto("/");

  const section = page.getByTestId("cross-type-stability");
  await expect(section.getByRole("heading", { name: "Descriptive pair stability across event types" })).toBeVisible();
  await expect(section.getByRole("tab")).toHaveCount(3);
  await expect(section.getByRole("group", { name: "Cross-type sample" }).getByRole("button")).toHaveCount(2);
  await expect(section.locator(".cross-type-cell")).toHaveCount(49);
  await expect(section.locator("button.cross-type-cell.limited")).toHaveCount(2);
  await expect(section.locator("button.cross-type-cell.insufficient")).toHaveCount(2);
  await expect(section.locator("button.cross-type-cell.insufficient").first()).not.toHaveAttribute("style", /background/);

  await section.getByRole("button", { name: /Finance & Economics and Politics & Conflict: Spearman/ }).click();
  const inspector = page.getByTestId("cross-type-inspector");
  await expect(inspector.getByRole("heading", { name: "Finance & Economics × Politics & Conflict" })).toBeVisible();
  await expect(inspector).toContainText("Common defined pairs");
  await expect(inspector).toContainText("Dependent top/top");
  await expect(inspector).toContainText("Dependency → complementarity flip");

  await section.getByRole("tab", { name: "Adjusted High-loss Lift" }).click();
  await expect(inspector.getByRole("heading", { name: "Select two event types" })).toBeVisible();
  await section.getByRole("button", { name: "All eligible pairs" }).click();
  await expect(section.getByRole("button", { name: "All eligible pairs" })).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByRole("link", { name: "Summary CSV ↓" })).toHaveAttribute("href", /data\/cross-type\/summary\.csv$/);
  await expect(section.getByRole("link", { name: "Full pair detail ↓" })).toHaveAttribute("href", /data\/cross-type\/pair-details\.csv\.gz$/);
});
