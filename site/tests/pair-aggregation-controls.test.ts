import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import payloadJson from "../public/data/pair-aggregation/all-four-family-pairs.json";
import { PairAggregationExplorer } from "../src/components/PairAggregationExplorer";
import type { PairAggregationData } from "../src/types/data";

const payload = payloadJson as PairAggregationData;

afterEach(cleanup);

describe("aggregation Near-BI control", () => {
  it("uses the page-level Near-BI state and reports changes back to the page", () => {
    const onNearBiOnlyChange = vi.fn();
    const view = render(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: false,
      onNearBiOnlyChange,
    }));

    expect(screen.getByRole("button", { name: "All eligible" })).toHaveClass("active");
    expect(screen.getByText("192")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Near-BI only" }));
    expect(onNearBiOnlyChange).toHaveBeenCalledWith(true);

    view.rerender(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: true,
      onNearBiOnlyChange,
    }));
    expect(screen.getByRole("button", { name: "Near-BI only" })).toHaveClass("active");
    expect(screen.getByText("106")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All eligible" }));
    expect(onNearBiOnlyChange).toHaveBeenCalledWith(false);
  });
});
