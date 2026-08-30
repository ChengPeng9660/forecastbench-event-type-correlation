import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import payloadJson from "../public/data/polymarket-aggregation/market-diversity-performance.json";
import { MarketDiversityPerformanceExplorer } from "../src/components/MarketDiversityPerformanceExplorer";
import type { MarketDiversityPerformanceData } from "../src/types/data";

// Synthetic TV values isolate frontend orientation from the independently audited exporter.
const payload = payloadJson as unknown as MarketDiversityPerformanceData;
const fixture: MarketDiversityPerformanceData = {
  ...payload,
  metrics: {
    ...payload.metrics,
    total_variation: { label: "Total variation (TV)", axis: "Mean absolute probability difference · TV", higher_means: "higher prediction diversity" },
  },
  points: payload.points.map((point, index) => ({
    ...point,
    diversity: { ...point.diversity, total_variation: 0.125 + index / 10_000 },
  })),
};

afterEach(cleanup);

function configurationCount() {
  return screen.getByText("CONFIGURATIONS", { exact: true }).parentElement?.querySelector("dd")?.textContent;
}

describe("all-configuration market diversity controls", () => {
  it("keeps TV zero as a valid configuration and plotted value", () => {
    const zeroFixture: MarketDiversityPerformanceData = {
      ...fixture,
      points: fixture.points.map((point) => ({ ...point, diversity: { ...point.diversity, total_variation: 0 } })),
    };
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: zeroFixture }));
    fireEvent.click(within(screen.getByRole("group", { name: "Market performance diversity metric" })).getByRole("button", { name: "Total variation (TV)" }));
    expect(configurationCount()).toBe(String(zeroFixture.points.length));
    expect(container.querySelectorAll(".market-performance-hit")).toHaveLength(zeroFixture.points.length);
    expect(container.querySelector(".market-performance-hit")?.getAttribute("transform")).toMatch(/^translate\(88 /);
    expect(container.querySelector(".market-performance-hit title")?.textContent).toContain("Total variation (TV): 0.000");
  });

  it("adds TV alongside all four existing metrics and plots its untransformed value", () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: fixture }));
    const controls = screen.getByRole("group", { name: "Market performance diversity metric" });
    expect(within(controls).getAllByRole("button")).toHaveLength(5);
    for (const id of ["prediction_diversity", "adjusted_pog", "high_loss_lift", "adjusted_loss_corr"] as const) {
      expect(within(controls).getByRole("button", { name: fixture.metrics[id].label })).toBeInTheDocument();
    }
    fireEvent.click(within(controls).getByRole("button", { name: "Total variation (TV)" }));
    expect(screen.getByRole("img")).toHaveAccessibleName(/Total variation \(TV\)/);
    const firstMarker = container.querySelector(".market-performance-hit");
    expect(firstMarker?.getAttribute("transform")).toMatch(/^translate\(207\.75 /);
    expect(firstMarker?.querySelector("title")?.textContent).toContain("Total variation (TV): 0.125");
    expect(configurationCount()).toBe(String(fixture.points.length));
  });

  it("retains provider, prompt, and information filters when TV is selected", () => {
    render(createElement(MarketDiversityPerformanceExplorer, { data: fixture }));
    const target = fixture.points[0];
    fireEvent.change(screen.getByLabelText("Market performance provider"), { target: { value: target.provider } });
    fireEvent.click(within(screen.getByRole("group", { name: "Market performance prompt filter" })).getByRole("button", { name: target.prompt_label }));
    fireEvent.click(within(screen.getByRole("group", { name: "Market performance information filter" })).getByRole("button", { name: target.information_label }));
    fireEvent.click(within(screen.getByRole("group", { name: "Market performance diversity metric" })).getByRole("button", { name: "Total variation (TV)" }));
    const expected = fixture.points.filter((point) => point.provider === target.provider && point.prompt_type === target.prompt_type && point.information_type === target.information_type);
    expect(configurationCount()).toBe(String(expected.length));
    expect(screen.getByLabelText("Market performance provider")).toHaveValue(target.provider);
    expect(within(screen.getByRole("group", { name: "Market performance prompt filter" })).getByRole("button", { name: target.prompt_label })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Market performance information filter" })).getByRole("button", { name: target.information_label })).toHaveAttribute("aria-pressed", "true");
  });
});
