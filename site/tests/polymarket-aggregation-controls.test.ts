import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PolymarketAggregationExplorer, polymarketOutcomeValue, selectPolymarketPoints } from "../src/components/PolymarketAggregationExplorer";
import type { PolymarketAggregationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "freeze-baseline.json"), "utf8"),
) as PolymarketAggregationData;

function pairCount() {
  const label = screen.getByText("MODEL PAIRS");
  return label.parentElement?.querySelector("dd")?.textContent;
}

function renderExplorer() {
  return render(createElement(PolymarketAggregationExplorer, { data: payload }));
}

afterEach(cleanup);

describe("Polymarket freeze aggregation explorer", () => {
  it("uses only the cross-fit Near-BI count", () => {
    renderExplorer();
    expect(screen.getByRole("heading", { name: "Can an LLM improve the market snapshot?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Near-BI (1)" })).toBeEnabled();
    expect(screen.queryByText("No Near-BI pairs.")).not.toBeInTheDocument();
    expect(pairCount()).toBe("26");

    fireEvent.click(screen.getByRole("button", { name: "Near-BI (1)" }));
    expect(pairCount()).toBe("1");

    expect(screen.queryByRole("button", { name: "Same-sample diagnostic" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All eligible" }));
    expect(pairCount()).toBe("26");
  });

  it("filters families and individual paired models without changing the market baseline", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("tab", { name: "Claude" }));
    expect(pairCount()).toBe("9");

    fireEvent.change(screen.getByRole("combobox", { name: "Polymarket paired model" }), {
      target: { value: "GPT-4.1-2025-04-14" },
    });
    expect(pairCount()).toBe("1");
    expect(screen.getByRole("img")).toHaveAccessibleName(/Polymarket Freeze pairs/);
  });

  it("switches aggregation method and keeps all cross-fit directions available", () => {
    renderExplorer();
    const piecewise = screen.getByRole("row", { name: /Piecewise Odds/ });
    fireEvent.click(piecewise);
    expect(piecewise).toHaveClass("active");

    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(screen.getByText(/Ten B-train → A-test evaluations averaged/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Combined" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A→B" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Total variation (TV)" })).toBeInTheDocument();
  });

  it("selects cross-fit records without reading archived points", () => {
    const crossFitOnly = { ...payload };
    Object.defineProperty(crossFitOnly, "points", { get: () => { throw new Error("Archived points must not be used by the explorer"); } });
    for (const direction of ["combined", "a_to_b", "b_to_a"] as const) {
      const view = direction === "combined" ? payload.cross_fit : payload.cross_fit.directional_points[direction];
      expect(selectPolymarketPoints(crossFitOnly, direction, false)).toBe(view.eligible_points);
      expect(selectPolymarketPoints(crossFitOnly, direction, true)).toBe(view.near_bi_points);
    }
    render(createElement(PolymarketAggregationExplorer, { data: crossFitOnly }));
    expect(pairCount()).toBe("26");
  });

  it("switches the chart between absolute BI and both gain denominators", () => {
    renderExplorer();
    const point = payload.cross_fit.eligible_points[0];
    expect(polymarketOutcomeValue(point, "ec_w0_56", "aggregation_bi")).toBe(point.brier_index.ec_w0_56);
    expect(polymarketOutcomeValue(point, "ec_w0_56", "gain_vs_polymarket")).toBe(point.gain_fraction_vs_polymarket.ec_w0_56);
    expect(polymarketOutcomeValue(point, "ec_w0_56", "gain_vs_model")).toBe(point.gain_fraction_vs_model.ec_w0_56);

    const outcomeGroup = screen.getByRole("group", { name: "Polymarket chart outcome" });
    expect(outcomeGroup.querySelectorAll("button")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Gain vs Polymarket" }));
    expect(screen.getByText("Gain vs Polymarket (fractional adjusted-Brier reduction)")).toBeInTheDocument();
    expect(screen.getByText("DIVERSITY–GAIN r")).toBeInTheDocument();
    expect(document.querySelector("line.gain-zero-line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Gain vs Model" }));
    expect(screen.getByText("Gain vs Model (fractional adjusted-Brier reduction)")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Gain vs Model for Polymarket Freeze pairs/);
  });
});
