import { expect, test } from "@playwright/test";

test("compares two scopes, changes metrics, links pair/filter choices and preserves a routing map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?cc_view=explorer&cc_section=type-selection#complementarity");
  const section = page.locator("#type-selection");
  await expect(section.getByRole("heading", { name: "Choose the specialist, or combine both?" })).toBeVisible();
  await expect(section.getByTestId("ts-filter-context")).toContainText("2,431 crossed-strength pairs");
  await expect(section.getByTestId("ts-complementary")).toContainText("0.15040");
  await expect(section.getByTestId("ts-all")).toContainText("0.15728");
  await expect(section.getByTestId("ts-complementary").locator(".ts-takeaway")).toContainText("3 / 4");
  await expect(section.getByTestId("ts-all").locator(".ts-takeaway")).toContainText("1 / 4");
  await section.getByRole("button", { name: "BI ↑", exact: true }).click();
  await expect(section.getByTestId("ts-complementary")).toContainText("62.041");
  await expect(section.getByTestId("ts-complementary").locator(".ts-takeaway")).toContainText("2 / 4");
  await section.getByRole("button", { name: "ECE ↓", exact: true }).click();
  await expect(section.getByTestId("ts-complementary")).toContainText("0.08793");
  await section.getByRole("button", { name: "Selected pair", exact: true }).click();
  await expect(section.getByTestId("ts-selected-name")).toContainText("Claude-2.1");
  await section.getByText("Inspect the selected pair’s historical routing map", { exact: true }).click();
  await expect(section.locator(".ts-route-map")).toContainText("Unseen / unlabeled types");
  await page.getByLabel("Next pair", { exact: true }).click();
  const chosen = await page.getByLabel("Select exact model pair").inputValue();
  await expect(page).toHaveURL(new RegExp(`cc_pair=${chosen}`));
  await section.getByRole("button", { name: "Cohort results", exact: true }).click();
  await page.getByLabel("Train BI gap limit", { exact: true }).selectOption("5");
  await expect(section.getByTestId("ts-filter-context")).toContainText("2,805 crossed-strength pairs");
  await page.getByLabel("Exact configuration pair scope").selectOption("matched_conditions");
  await expect(section.getByTestId("ts-filter-context")).toContainText("Same prompt + information");
  await page.getByRole("button", { name: "Question source / platform", exact: true }).click();
  await expect(section).toContainText("This experiment routes by event type");
  await section.getByRole("button", { name: "View event-type selection", exact: true }).click();
  await expect(section.getByTestId("ts-all")).toBeVisible();
  await page.reload();
  await expect(section.getByRole("button", { name: "ECE ↓", exact: true })).toHaveAttribute("aria-pressed", "true");
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1] + 1);
  expect(errors).toEqual([]);
});

test("recovers when the new experiment's data fetch fails", async ({ page }) => {
  let fail = true;
  await page.route("**/data/type-selection/overview.json", async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, body: "Unavailable" }); }
    else await route.continue();
  });
  await page.goto("/?cc_view=explorer#complementarity");
  const section = page.locator("#type-selection");
  await expect(section.getByRole("alert")).toContainText("503");
  await section.getByRole("button", { name: "Retry type-selection results" }).click();
  await expect(section.getByTestId("ts-all")).toContainText("0.15728");
  await expect(section.getByRole("alert")).toHaveCount(0);
});
