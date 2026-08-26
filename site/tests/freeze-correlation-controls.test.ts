import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FreezeMarketCorrelationExplorer,
  freezeAggregationOutcomeValue,
  pearsonCorrelation,
  sortFreezeCorrelationPoints,
  spearmanCorrelation,
  summarizeFreezeAggregationPoints,
  summarizeFreezeCorrelationPoints,
} from "../src/components/FreezeMarketCorrelationExplorer";
import type { FreezeMarketCorrelationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "freeze-exposed-correlation.json"), "utf8"),
) as FreezeMarketCorrelationData;

afterEach(cleanup);

describe("with-freeze model/market correlation explorer", () => {
  it("renders audited headline values and a compact top-12 ranking", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    expect(screen.getByRole("heading", { name: "How closely do models track the market snapshot?" })).toBeInTheDocument();
    expect(screen.getByText(/news-augmented configurations are excluded/i)).toBeInTheDocument();
    expect(screen.getByText("0.902")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show all 39" })).toBeInTheDocument();
    expect(screen.getByText(/Correlation measures similarity/)).toBeInTheDocument();
    const aggregationTable = screen.getByRole("table", { name: "With-freeze prompt and Polymarket aggregation method comparison" });
    expect(within(aggregationTable).getAllByRole("row")).toHaveLength(7);
    expect(within(aggregationTable).getByText("Directional CF")).toBeInTheDocument();
    expect(within(aggregationTable).getByText("75.51")).toBeInTheDocument();
  });

  it("shows every row on demand and filters to one provider", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    fireEvent.click(screen.getByRole("button", { name: "Show all 39" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(39);

    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(10);
    expect(screen.getByText("10", { selector: ".freeze-correlation-kpis strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Scratchpad" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(3);
    const filteredTable = screen.getByRole("table", { name: "With-freeze prompt and Polymarket aggregation method comparison" });
    expect(within(filteredTable).getAllByText(/\/3$/)).toHaveLength(6);
  });

  it("sorts by common support and updates the selected-model ledger", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort freeze correlation models" }), { target: { value: "support" } });
    const rows = screen.getAllByRole("button", { name: /^Inspect / });
    expect(rows[0]).toHaveAccessibleName(/Claude-3-5-Sonnet-20240620/);
    fireEvent.click(rows[1]);
    expect(screen.getByRole("heading", { name: "Claude-3-7-Sonnet-20250219" })).toBeInTheDocument();
  });

  it("exports stable helpers for sorting and filtered weighted summaries", () => {
    expect(sortFreezeCorrelationPoints(payload.points, "support")[0].n_common).toBe(769);
    const openAi = payload.points.filter((point) => point.provider === "OpenAI");
    const summary = summarizeFreezeCorrelationPoints(openAi);
    expect(summary.models).toBe(7);
    expect(summary.configurations).toBe(10);
    expect(summary.support).toBe(openAi.reduce((sum, point) => sum + point.n_common, 0));
    expect(summary.correlation).toBeGreaterThan(0.8);

    const directional = summarizeFreezeAggregationPoints(payload.points, "cf_directional", "combined");
    expect(directional.pairCount).toBe(39);
    expect(directional.support).toBe(136_140);
    expect(directional.weightedBi).toBeCloseTo(75.50871279772113, 12);
    expect(directional.gainVsMarket).toBeCloseTo(-0.00860617172400239, 12);
    expect(directional.positiveVsMarket).toBe(13);
    const aToB = summarizeFreezeAggregationPoints(payload.points, "cf_directional", "a_to_b");
    const bToA = summarizeFreezeAggregationPoints(payload.points, "cf_directional", "b_to_a");
    expect(aToB.support + bToA.support).toBe(directional.support);
  });

  it("keeps Polymarket fixed while switching diversity, outcome, method, and Near-BI", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    expect(screen.getByRole("heading", { name: "Does a more diverse model improve market aggregation?" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Adjusted POG versus fraction gain versus Polymarket/i })).toBeInTheDocument();
    expect(screen.getAllByText("39").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Near-BI" }));
    const scatterSummary = screen.getByLabelText("Diversity and aggregation summary");
    expect(within(scatterSummary).getByText("29")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "High-loss Lift" }));
    expect(within(scatterSummary).getByText("26")).toBeInTheDocument();
    expect(within(scatterSummary).getByText("3 undefined omitted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aggregation BI" }));
    expect(screen.getByRole("img", { name: /High-loss Lift versus aggregation Brier Index/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Use EC · w = 0.56 in the diversity chart" }));
    expect(within(scatterSummary).getByText("EC · w = 0.56")).toBeInTheDocument();
    expect(screen.getAllByText(/fixed Polymarket base/i).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(screen.getByText(/10 repeated A→B evaluations/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(screen.getByText(/10 repeated B→A evaluations/i)).toBeInTheDocument();
  });

  it("computes pair-level diversity associations without support weighting", () => {
    const xs = payload.points.map((point) => point.train_diversity.adjusted_pog as number);
    const ys = payload.points.map((point) => freezeAggregationOutcomeValue(
      point,
      "cf_directional",
      "gain_vs_market",
      "combined",
    ));
    expect(pearsonCorrelation(xs, ys)).toBeCloseTo(-0.10268175312152283, 12);
    expect(spearmanCorrelation(xs, ys)).not.toBeNull();
    expect(freezeAggregationOutcomeValue(payload.points[0], "cf_directional", "aggregation_bi", "combined"))
      .toBe(payload.points[0].aggregation.cf_directional.brier_index);
    expect(freezeAggregationOutcomeValue(payload.points[0], "cf_directional", "aggregation_bi", "a_to_b"))
      .toBe(payload.points[0].directions.a_to_b.aggregation.cf_directional.brier_index);
  });
});
