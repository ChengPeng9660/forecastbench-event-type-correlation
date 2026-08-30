import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import payloadJson from "../public/data/pair-aggregation/all-six-family-pairs.json";
import {
  PairAggregationExplorer,
  selectCrossFitPoints,
  withGainFractionVsFocal,
} from "../src/components/PairAggregationExplorer";
import type { PairAggregationData } from "../src/types/data";

const payload = payloadJson as PairAggregationData;

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("aggregation Near-BI control", () => {
  it("cleans legacy evaluation links and never reads archived points", () => {
    window.history.replaceState(null, "", "/?gain_eval=same_sample&gain_fold=b_to_a&near_bi=0#gain");
    const crossFitOnly = { ...payload };
    Object.defineProperty(crossFitOnly, "points", { get: () => { throw new Error("Archived points must not be used by the explorer"); } });
    render(createElement(PairAggregationExplorer, {
      data: crossFitOnly,
      nearBiOnly: false,
      onNearBiOnlyChange: vi.fn(),
    }));
    expect(new URLSearchParams(window.location.search).has("gain_eval")).toBe(false);
    expect(screen.queryByRole("button", { name: "Same-sample diagnostic" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B→A" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Combined" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Total variation (TV)" })).toBeInTheDocument();
  });

  it("offers Gemini and Kimi as focal families and pair filters", () => {
    render(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: false,
      onNearBiOnlyChange: vi.fn(),
    }));

    expect(screen.getByRole("option", { name: "Gemini-3-Pro-Preview" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kimi-K2-Thinking" })).toBeInTheDocument();
    expect(screen.getByText("Aggregation Brier Index (higher is better)")).toBeInTheDocument();
    expect(screen.getByText("DIVERSITY–BI r")).toBeInTheDocument();
    const geminiKimi = screen.getByRole("tab", { name: "Gemini × Kimi" });
    expect(geminiKimi).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Aggregation focal model" }), {
      target: { value: "Gemini-3-Pro-Preview" },
    });
    expect(geminiKimi).toBeEnabled();
  });

  it("uses the selected focal model as every gain-fraction denominator", () => {
    const point = payload.points[0];
    const relativeToA = withGainFractionVsFocal(point, point.model_a)!;
    const relativeToB = withGainFractionVsFocal(point, point.model_b)!;
    expect(relativeToA.gain_fraction_vs_best_single.ec_w0_56).toBeCloseTo(
      (point.adjusted_brier.model_a - point.adjusted_brier.ec_w0_56) / point.adjusted_brier.model_a,
      14,
    );
    expect(relativeToB.gain_fraction_vs_best_single.ec_w0_56).toBeCloseTo(
      (point.adjusted_brier.model_b - point.adjusted_brier.ec_w0_56) / point.adjusted_brier.model_b,
      14,
    );
    expect(relativeToA.gain_fraction_vs_best_single.best_single).toBeGreaterThan(0);
    expect(withGainFractionVsFocal(point, "not-in-this-pair")).toBeNull();
  });

  it("exposes both train-test directions and their combined view", () => {
    expect(selectCrossFitPoints(payload, "combined", false)).toHaveLength(337);
    expect(selectCrossFitPoints(payload, "combined", true)).toHaveLength(227);
    expect(selectCrossFitPoints(payload, "a_to_b", false)).toHaveLength(337);
    expect(selectCrossFitPoints(payload, "a_to_b", true)).toHaveLength(216);
    expect(selectCrossFitPoints(payload, "b_to_a", false)).toHaveLength(337);
    expect(selectCrossFitPoints(payload, "b_to_a", true)).toHaveLength(210);
  });

  it("uses the page-level Near-BI state and reports changes back to the page", () => {
    const onNearBiOnlyChange = vi.fn();
    const view = render(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: false,
      onNearBiOnlyChange,
    }));

    expect(screen.getByRole("button", { name: "All eligible" })).toHaveClass("active");
    expect(screen.getByText("16")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Near-BI only" }));
    expect(onNearBiOnlyChange).toHaveBeenCalledWith(true);

    view.rerender(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: true,
      onNearBiOnlyChange,
    }));
    expect(screen.getByRole("button", { name: "Near-BI only" })).toHaveClass("active");
    expect(screen.getByText("13")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(screen.getByText("13")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(screen.getByText("11")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All eligible" }));
    expect(onNearBiOnlyChange).toHaveBeenCalledWith(false);
  });
});
