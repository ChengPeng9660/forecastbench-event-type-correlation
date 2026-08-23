import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const publishedModels = JSON.parse(readFileSync(new URL("../../public/data/models.json", import.meta.url), "utf8")) as Array<{
  id: string;
  name: string;
  provider: string;
  release_order: number;
}>;

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
  { id: "adjusted_pog", label: "Adjusted Pairwise Oracle Gain", dependence_direction: "lower" },
  { id: "high_loss_lift", label: "Adjusted High-loss Lift", dependence_direction: "higher" },
  { id: "adjusted_loss_corr", label: "Adjusted-loss Correlation", dependence_direction: "higher" },
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

function globalBaselineFixture() {
  const scopes = [
    { id: "official_full", label: "Official Full", description: "All official targets, including unclassified rows." },
    { id: "seven_topic_union", label: "Seven-topic Union", description: "Only targets assigned to the seven audited topics." },
  ];
  const comparisonModes = [
    { id: "leave_topic_out", label: "Leave topic out", description: "Global baseline recomputed after removing the compared topic eligible targets.", primary: true },
    { id: "inclusive_global", label: "Inclusive global", description: "Sensitivity baseline that includes the compared topic.", primary: false },
  ];
  const baseRows = scopes.flatMap((scope) => comparisonModes.flatMap((comparison) => crossTypeMetrics.flatMap((metric) => crossTypeSamples.flatMap((sample) => crossTypeTopics.map((topic, topicIndex) => ({ scope, comparison, metric, sample, topic, topicIndex }))))));
  const pairStability = baseRows.map(({ scope, comparison, metric, sample, topic, topicIndex }) => ({
    global_scope: scope.id,
    comparison_mode: comparison.id,
    topic_id: topic.id,
    metric_id: metric.id,
    sample_id: sample.id,
    n_pair_universe: 34453,
    n_sample_pairs: 1200 - topicIndex * 10,
    n_defined_pairs: topicIndex === 6 ? 24 : 1100 - topicIndex * 10,
    spearman: topicIndex === 6 ? null : .58 - topicIndex * .06,
    pearson: topicIndex === 6 ? null : .52 - topicIndex * .05,
    dependent_top_jaccard: topicIndex === 6 ? null : .41,
    complementary_top_jaccard: topicIndex === 6 ? null : .37,
    dependency_persistence_global_to_topic: topicIndex === 6 ? null : .62,
    dependency_persistence_topic_to_global: topicIndex === 6 ? null : .59,
    complementarity_persistence_global_to_topic: topicIndex === 6 ? null : .57,
    complementarity_persistence_topic_to_global: topicIndex === 6 ? null : .55,
    dependency_to_complementarity_global_to_topic: topicIndex === 6 ? null : .07,
    dependency_to_complementarity_topic_to_global: topicIndex === 6 ? null : .08,
    quartile_transition_counts: {},
    interpretation_status: topicIndex === 6 ? "insufficient" : "headline",
    reason: topicIndex === 6 ? "fewer_than_reporting_min_defined_pairs" : null,
  }));
  const partnerSummary = baseRows.map(({ scope, comparison, metric, sample, topic, topicIndex }) => ({
    global_scope: scope.id,
    comparison_mode: comparison.id,
    topic_id: topic.id,
    metric_id: metric.id,
    sample_id: sample.id,
    n_focal_model_universe: 263,
    n_reportable_focal_models: 190,
    n_limited_focal_models: 12,
    n_headline_focal_models: 178,
    median_spearman: .49 - topicIndex * .05,
    q25_spearman: .31,
    q75_spearman: .61,
    min_spearman: -.12,
    max_spearman: .88,
    fraction_negative_spearman: .04,
    median_defined_partners: 68,
    mean_dependent_top_jaccard: .35,
    mean_complementary_top_jaccard: .33,
    interpretation_status: topicIndex === 3 ? "insufficient" : "headline",
    reason: topicIndex === 3 ? "fewer_than_reporting_min_focal_models" : null,
  }));
  const abilityStability = scopes.flatMap((scope) => comparisonModes.flatMap((comparison) => crossTypeTopics.map((topic, topicIndex) => ({
    global_scope: scope.id,
    comparison_mode: comparison.id,
    topic_id: topic.id,
    n_model_universe: 263,
    n_sample_models: 220,
    n_defined_models: 215,
    spearman: .71 - topicIndex * .04,
    pearson: .68 - topicIndex * .04,
    top_quartile_jaccard: .46,
    global_top_quartile_retained: .63,
    topic_top_quartile_retained: .61,
    interpretation_status: topicIndex === 4 ? "insufficient" : "headline",
    reason: topicIndex === 4 ? "fewer_than_reporting_min_models" : null,
  }))));
  const globalPairSummary = scopes.flatMap((scope) => crossTypeMetrics.flatMap((metric) => crossTypeSamples.map((sample) => ({
    global_scope: scope.id,
    metric_id: metric.id,
    sample_id: sample.id,
    n_pair_universe: 34453,
    n_sample_pairs: 3021,
    n_defined_pairs: 2980,
    mean: .08,
    median: .05,
    q25: .02,
    q75: .11,
    min: -.04,
    max: .44,
    interpretation_status: "headline",
    reason: null,
  }))));
  const manifest = {
    schema_version: "1.0.0",
    generated_at: "2026-08-19T00:00:00Z",
    global_scopes: scopes,
    topics: crossTypeTopics,
    metrics: crossTypeMetrics,
    samples: crossTypeSamples,
    comparison_modes: comparisonModes,
    thresholds: { min_overlap: 50, near_bi_gap: .05, high_loss_threshold: .25, min_partners: 20, reporting_min_defined: 30, headline_min_defined: 100, quartile: .25 },
    summary_json: "global-baseline/summary.json",
    partner_profile_files: { "m-1f526d2cc0ff": "global-baseline/partner-profiles/m-1f526d2cc0ff.json" },
    pair_matrix_files: {
      official_full: "global-baseline/pair-matrices/official_full.json",
      seven_topic_union: "global-baseline/pair-matrices/seven_topic_union.json",
    },
    pair_metrics_gzip: "global-baseline/pair-metrics.csv.gz",
    pair_stability_csv: "global-baseline/pair-stability.csv",
    partner_stability_gzip: "global-baseline/partner-stability.csv.gz",
    partner_summary_csv: "global-baseline/partner-summary.csv",
    model_ability_csv: "global-baseline/model-ability.csv",
    ability_stability_csv: "global-baseline/ability-stability.csv",
    audit_json: "global-baseline/audit.json",
  };
  const matrixModels = publishedModels.filter((model) => !model.name.startsWith("LLM Crowd")).slice(0, 35);
  const matrixFields = ["model_a_id", "model_b_id", "n_overlap", "n_dates", "eligible", "near_bi", "bi_reason", "insufficient_overlap_reason", "adjusted_pog", "pog_reason", "high_loss_lift", "lift_reason", "adjusted_loss_corr", "corr_reason"];
  const pairMatrix = (globalScope: "official_full" | "seven_topic_union") => ({
    schema_version: "1.0.0",
    global_scope: globalScope,
    models: matrixModels.map((model) => ({ id: model.id, name: model.name, organization: model.provider })),
    fields: matrixFields,
    pairs: matrixModels.flatMap((left, leftIndex) => matrixModels.slice(leftIndex + 1).map((right, offset) => {
      const index = leftIndex * matrixModels.length + offset;
      return [left.id, right.id, 70 + index % 180, 2 + index % 5, true, index % 4 !== 0, null, null, .01 + (index % 80) / 1000, null, .8 + (index % 90) / 50, null, -.3 + (index % 60) / 100, null];
    })),
  });
  const profiles = crossTypeTopics.map((topic, topicIndex) => ({
    global_scope: "official_full",
    comparison_mode: "leave_topic_out",
    topic_id: topic.id,
    metric_id: "adjusted_pog",
    sample_id: "near_bi_both",
    focal_model_id: "m-1f526d2cc0ff",
    focal_model_name: "GPT-3.5-Turbo-0125 (scratchpad with freeze values)",
    n_defined_partners: 72 - topicIndex,
    spearman: .56 - topicIndex * .05,
    pearson: .52 - topicIndex * .05,
    dependent_top_jaccard: .38,
    complementary_top_jaccard: .34,
    global_top_complementary_partner_name: "Claude 3.5 Sonnet",
    global_top_complementary_partner_retained: topicIndex < 3,
    global_top_complementary_partner_topic_percentile: .92 - topicIndex * .03,
    interpretation_status: "headline",
    reason: null,
  }));
  return {
    manifest,
    summary: {
      schema_version: "1.0.0",
      global_scopes: scopes,
      topic_ids: crossTypeTopics.map((topic) => topic.id),
      metric_ids: crossTypeMetrics.map((metric) => metric.id),
      sample_ids: crossTypeSamples.map((sample) => sample.id),
      comparison_modes: comparisonModes,
      thresholds: manifest.thresholds,
      global_pair_summary: globalPairSummary,
      pair_stability: pairStability,
      partner_summary: partnerSummary,
      ability_stability: abilityStability,
    },
    profiles: { schema_version: "1.0.0", focal_model_id: "m-1f526d2cc0ff", profiles },
    matrices: {
      official_full: pairMatrix("official_full"),
      seven_topic_union: pairMatrix("seven_topic_union"),
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
  const matrix = page.getByTestId("heatmap");
  await expect(matrix.locator(".heat-cell")).toHaveCount(900);
  const result = await matrix.evaluate(async (root) => {
    const models = await (await fetch("./data/models.json")).json() as Array<{ name: string; release_order: number }>;
    const releaseOrder = new Map(models.map((model) => [model.name, model.release_order]));
    const names = [...root.querySelectorAll<HTMLElement>(".row-label span")].map((element) => element.innerText);
    const values = names.map((name) => releaseOrder.get(name) ?? Number.MAX_SAFE_INTEGER);
    const height = Math.round(root.querySelector(".heatmap-grid")?.getBoundingClientRect().height ?? 0);
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
  await expect(page.getByTestId("cross-type-inspector")).toHaveCount(0);
  await expect(section).not.toContainText("Select two event types");

  await section.getByRole("button", { name: /Finance & Economics and Politics & Conflict: Spearman/ }).click();
  const inspector = page.getByTestId("cross-type-inspector");
  await expect(inspector.getByRole("heading", { name: "Finance & Economics × Politics & Conflict" })).toBeVisible();
  await expect(inspector).toContainText("Common defined pairs");
  await expect(inspector).toContainText("High-dependence top/top");
  await expect(inspector).toContainText("High-dependence → low-dependence flip");

  await section.getByRole("tab", { name: "Adjusted High-loss Lift" }).click();
  await expect(page.getByTestId("cross-type-inspector")).toHaveCount(0);
  await section.getByRole("button", { name: "All eligible pairs" }).click();
  await expect(section.getByRole("button", { name: "All eligible pairs" })).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByRole("link", { name: "Summary CSV ↓" })).toHaveAttribute("href", /data\/cross-type\/summary\.csv$/);
  await expect(section.getByRole("link", { name: "Full pair detail ↓" })).toHaveAttribute("href", /data\/cross-type\/pair-details\.csv\.gz$/);
});

test("shows the no-topic global dependence baseline without topic-transfer panels", async ({ page }) => {
  const fixture = globalBaselineFixture();
  let officialMatrixRequests = 0;
  let unionMatrixRequests = 0;
  await page.route("**/data/global-baseline/manifest.json", (route) => route.fulfill({ json: fixture.manifest }));
  await page.route("**/data/global-baseline/summary.json", (route) => route.fulfill({ json: fixture.summary }));
  await page.route("**/data/global-baseline/pair-matrices/official_full.json", (route) => { officialMatrixRequests += 1; return route.fulfill({ json: fixture.matrices.official_full }); });
  await page.route("**/data/global-baseline/pair-matrices/seven_topic_union.json", (route) => { unionMatrixRequests += 1; return route.fulfill({ json: fixture.matrices.seven_topic_union }); });
  await page.goto("/");

  const section = page.getByTestId("global-baseline");
  await expect(section.getByRole("heading", { name: "Global model dependence" })).toBeVisible();
  await expect(section.getByRole("tab", { name: "Official Full" })).toHaveAttribute("aria-selected", "true");
  await expect(section.getByRole("tab", { name: "Seven-topic Union" })).toBeVisible();
  await expect(section).not.toContainText("Does the global ranking survive conditioning?");
  await expect(section).not.toContainText("FOCAL MODEL CHECK");
  await expect(section).not.toContainText("Does one model keep the same partner ordering?");
  await expect(section.getByTestId("global-pair-heatmap").locator(".heat-cell")).toHaveCount(900);
  await expect(section.getByText("Lower model dependence", { exact: true })).toBeVisible();
  await expect(section.getByText("Higher model dependence", { exact: true })).toBeVisible();
  await expect(section.getByLabel("Global matrix provider")).toBeVisible();
  await expect(section.getByLabel("Global matrix model").locator("option")).toHaveCount(36);
  await expect(section.getByTestId("global-matrix-selection")).toHaveCount(0);
  await section.getByTestId("global-pair-heatmap").locator("button.heat-cell").first().click();
  await expect(section.getByTestId("global-matrix-selection")).toContainText("n=");
  await expect(section).not.toContainText("PAIR DETAIL");
  expect(officialMatrixRequests).toBe(1);
  const releaseOrder = new Map(publishedModels.map((model) => [model.name, model.release_order]));
  const globalNames = await section.getByTestId("global-pair-heatmap").locator(".row-label span").allTextContents();
  const globalOrders = globalNames.map((name) => releaseOrder.get(name) ?? Number.MAX_SAFE_INTEGER);
  expect(globalNames).toHaveLength(30);
  expect(globalOrders.every((value, index) => index === 0 || globalOrders[index - 1] <= value)).toBe(true);

  await section.getByLabel("Global matrix provider").selectOption({ index: 1 });
  await expect(page).toHaveURL(/global_provider=/);
  await section.getByLabel("Global matrix minimum overlap").fill("100");
  await expect(page).toHaveURL(/global_min_n=100/);
  expect(officialMatrixRequests).toBe(1);
  await section.getByRole("button", { name: "All eligible pairs" }).click();
  await expect(page).toHaveURL(/global_sample=eligible_both/);
  expect(officialMatrixRequests).toBe(1);
  await section.getByRole("tab", { name: "Adjusted High-loss Lift" }).click();
  await expect(page).toHaveURL(/global_metric=high_loss_lift/);
  expect(officialMatrixRequests).toBe(1);
  await section.getByLabel("Global matrix provider").selectOption("all");
  await section.getByRole("tab", { name: "Seven-topic Union" }).click();
  await expect(section.getByTestId("global-pair-heatmap").locator(".heat-cell")).toHaveCount(900);
  expect(unionMatrixRequests).toBe(1);
  await expect(section.getByRole("link", { name: "Global pairs ↓" })).toHaveAttribute("href", /global-baseline\/pair-metrics\.csv\.gz$/);
  const retiredPhrases = new RegExp([
    ["aggregation", "friendly"].join("-"),
    ["aggregation", "value"].join(" "),
    ["more", "complementary"].join(" "),
    ["less", "complementary"].join(" "),
  ].join("|"), "i");
  expect(await page.locator("body").innerText()).not.toMatch(retiredPhrases);
});
