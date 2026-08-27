import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PolymarketAggregationExplorer, polymarketOutcomeValue } from "../src/components/PolymarketAggregationExplorer";
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
  it("uses the cross-fit Near-BI count in OOS mode and the same-sample count in diagnostic mode", () => {
    renderExplorer();
    expect(screen.getByRole("heading", { name: "Can an LLM improve the market snapshot?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Near-BI (1)" })).toBeEnabled();
    expect(screen.queryByText("No Near-BI pairs.")).not.toBeInTheDocument();
    expect(pairCount()).toBe("26");

    fireEvent.click(screen.getByRole("button", { name: "Near-BI (1)" }));
    expect(pairCount()).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Same-sample diagnostic" }));
    expect(screen.getByRole("button", { name: "Near-BI (0)" })).toBeDisabled();
    expect(screen.getByText("No Near-BI pairs.")).toBeInTheDocument();
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

  it("switches aggregation method, evaluation sample, and cross-fit direction", () => {
    renderExplorer();
    const piecewise = screen.getByRole("row", { name: /Piecewise Odds/ });
    fireEvent.click(piecewise);
    expect(piecewise).toHaveClass("active");

    fireEvent.click(screen.getByRole("button", { name: "Same-sample diagnostic" }));
    expect(screen.queryByRole("button", { name: "B→A" })).not.toBeInTheDocument();
    expect(screen.getByText(/same sample/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cross-fit OOS" }));
    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(screen.getByText(/Ten B-train → A-test evaluations averaged/)).toBeInTheDocument();
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
