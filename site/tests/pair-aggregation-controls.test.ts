import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import payloadJson from "../public/data/pair-aggregation/all-four-family-pairs.json";
import {
  PairAggregationExplorer,
  selectCrossFitPoints,
  withGainFractionVsFocal,
} from "../src/components/PairAggregationExplorer";
import type { PairAggregationData } from "../src/types/data";

const payload = payloadJson as PairAggregationData;

afterEach(cleanup);

describe("aggregation Near-BI control", () => {
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
    expect(selectCrossFitPoints(payload, "combined", false)).toHaveLength(192);
    expect(selectCrossFitPoints(payload, "combined", true)).toHaveLength(106);
    expect(selectCrossFitPoints(payload, "a_to_b", false)).toHaveLength(192);
    expect(selectCrossFitPoints(payload, "a_to_b", true)).toHaveLength(76);
    expect(selectCrossFitPoints(payload, "b_to_a", false)).toHaveLength(192);
    expect(selectCrossFitPoints(payload, "b_to_a", true)).toHaveLength(84);
  });

  it("uses the page-level Near-BI state and reports changes back to the page", () => {
    const onNearBiOnlyChange = vi.fn();
    const view = render(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: false,
      onNearBiOnlyChange,
    }));

    expect(screen.getByRole("button", { name: "All eligible" })).toHaveClass("active");
    expect(screen.getByText("12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Near-BI only" }));
    expect(onNearBiOnlyChange).toHaveBeenCalledWith(true);

    view.rerender(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: true,
      onNearBiOnlyChange,
    }));
    expect(screen.getByRole("button", { name: "Near-BI only" })).toHaveClass("active");
    expect(screen.getByText("7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(screen.getByText("6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(screen.getByText("5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All eligible" }));
    expect(onNearBiOnlyChange).toHaveBeenCalledWith(false);
  });
});
