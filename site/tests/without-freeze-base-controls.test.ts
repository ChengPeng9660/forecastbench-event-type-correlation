import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  fixedBaseOutcomeValue,
  summarizeFixedBasePoints,
  WithoutFreezeBaseExplorer,
} from "../src/components/WithoutFreezeBaseExplorer";
import type { FixedBaseAggregationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "without-freeze-base.json"), "utf8"),
) as FixedBaseAggregationData;

afterEach(cleanup);

describe("without-freeze fixed-base explorer", () => {
  it("renders the fixed-base benchmark and correlation chart", () => {
    render(createElement(WithoutFreezeBaseExplorer, { data: payload }));
    expect(screen.getByRole("heading", { name: "Does market exposure create useful aggregation diversity?" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Without-freeze base aggregation method comparison" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Adjusted POG versus fraction gain versus without-freeze base/i })).toBeInTheDocument();
    expect(screen.getAllByText("36").length).toBeGreaterThan(0);
  });

  it("switches direction, prompt, diversity, outcome, method, and Near-BI", () => {
    render(createElement(WithoutFreezeBaseExplorer, { data: payload }));
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(screen.getByText("10 repeated A→B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(screen.getByText("10 repeated B→A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scratchpad" }));
    expect(screen.getByText("10", { selector: ".freeze-diversity-kpis strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "High-loss Lift" }));
    fireEvent.click(screen.getByRole("button", { name: "Aggregation BI" }));
    expect(screen.getByRole("img", { name: /High-loss Lift versus aggregation Brier Index/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("row", { name: /Use EC · w = 0.56 for without-freeze base analysis/i }));
    expect(within(screen.getByLabelText("Without-freeze base diversity summary")).getByText("EC · w = 0.56")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Near-BI" }));
    expect(screen.getByText(/Not enough defined pairs under the active filters/i)).toBeInTheDocument();
  });

  it("derives direction-specific support and values from the selected fold view", () => {
    const combined = summarizeFixedBasePoints(payload.points, "combined", "cf_directional");
    const aToB = summarizeFixedBasePoints(payload.points, "a_to_b", "cf_directional");
    const bToA = summarizeFixedBasePoints(payload.points, "b_to_a", "cf_directional");
    expect(aToB.support + bToA.support).toBe(combined.support);
    expect(combined.gainVsBase).toBeCloseTo(0.4164918735394146, 12);
    expect(fixedBaseOutcomeValue(payload.points[0], "a_to_b", "cf_directional", "aggregation_bi"))
      .toBe(payload.points[0].directions.a_to_b.aggregation.cf_directional.brier_index);
  });
});
