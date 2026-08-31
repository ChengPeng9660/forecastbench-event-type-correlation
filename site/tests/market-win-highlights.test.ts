import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import payloadJson from "../public/data/polymarket-aggregation/market-diversity-performance.json";
import { MarketDiversityPerformanceExplorer } from "../src/components/MarketDiversityPerformanceExplorer";
import type { MarketDiversityPerformanceData, MarketDiversityPerformancePoint } from "../src/types/data";

vi.mock("../src/components/MarketConfigurationAggregationExplorer", () => ({ MarketConfigurationAggregationExplorer: () => null }));
vi.mock("../src/components/ModelMarketAggregationExplorer", () => ({ ModelMarketAggregationExplorer: () => null }));
afterEach(cleanup);

const payload = payloadJson as unknown as MarketDiversityPerformanceData;
const point = payload.points[0];
const scores = (brier_index: number, raw_brier: number) => ({ brier_index, raw_brier, adjusted_brier: raw_brier });
const examples: Array<Partial<MarketDiversityPerformancePoint>> = [
  // Above the old 74.6 reference, but below this configuration's own market.
  { canonical_model_version: "Matched loser", provider: "Moonshot", prompt_type: "zero_shot", prompt_label: "Zero shot", information_type: "freeze_values", information_label: "Freeze values", model: scores(80.4, 0.021), matched_market: scores(81.2, 0.019), n_common: 285 },
  // Below the old line, but genuinely above its own matched market.
  { canonical_model_version: "Matched winner", provider: "OpenAI", prompt_type: "scratchpad", prompt_label: "Scratchpad", information_type: "none", information_label: "No extra information", model: scores(65, 0.16), matched_market: scores(64, 0.18), n_common: 10 },
  // Raw and difficulty-adjusted rankings need not agree.
  { canonical_model_version: "BI-only winner", provider: "OpenAI", prompt_type: "unspecified", prompt_label: "Unspecified", information_type: "news", information_label: "News", model: scores(70, 0.2), matched_market: scores(69, 0.19), n_common: 1000 },
  { canonical_model_version: "Matched tie", provider: "Google", prompt_type: "zero_shot", prompt_label: "Zero shot", information_type: "freeze_values", information_label: "Freeze values", model: scores(75, 0.1), matched_market: scores(75, 0.1), n_common: 100 },
];
const fixture: MarketDiversityPerformanceData = {
  ...payload,
  audit: { ...payload.audit, prompt_counts: { zero_shot: 2, scratchpad: 1, unspecified: 1 } },
  points: examples.map((example, index) => ({
    ...point, ...example,
    exact_configuration: `Exact configuration ${index}`,
    diversity: { ...point.diversity, prediction_diversity: 0.1 * (index + 1), total_variation: 0.05 * index, high_loss_lift: index === 2 ? null : index / 10 },
  })),
};

describe("overview matched-market win highlights", () => {
  it("is opt-in, removes the global line, and preserves point locations, information colors, and prompt shapes", () => {
    const beforeData = JSON.stringify(fixture);
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: fixture }));
    const markers = () => [...container.querySelectorAll(".market-performance-hit")];
    const winBadges = () => container.querySelectorAll(".market-performance-hit .market-win-badge");
    const byExact = (index: number) => markers().find((element) => element.getAttribute("data-configuration") === `Exact configuration ${index}`)!;
    const signature = () => markers().map((element) => {
      const glyph = element.querySelector(".market-performance-point")!;
      return [element.getAttribute("data-configuration"), element.getAttribute("transform"), glyph.tagName, glyph.getAttribute("fill"), glyph.getAttribute("transform")];
    });
    const count = () => screen.getByText("BEATS MATCHED MARKET", { exact: true }).parentElement?.querySelector("dd")?.textContent;
    const toggle = screen.getByRole("checkbox", { name: "Model performance: highlight market wins" });

    expect(toggle).not.toBeChecked();
    expect(winBadges()).toHaveLength(0);
    expect(count()).toBe("1 / 4");
    expect(container.querySelector(".market-performance-baseline")).toBeNull();
    expect(screen.queryByText("MARKET BASELINE", { exact: true })).toBeNull();
    expect(byExact(0)).toHaveAttribute("data-market-comparison", "below");
    expect(container.querySelector(".market-performance-inspector .market-win-verdict")).toHaveTextContent("Below matched market");

    const initial = signature();
    fireEvent.click(toggle);
    expect(winBadges()).toHaveLength(1);
    expect(byExact(1).querySelector(".market-win-badge")).not.toBeNull();
    expect(signature()).toEqual(initial);
    expect(byExact(1).querySelector("rect.market-performance-point")).not.toBeNull();
    expect(byExact(0).querySelector("circle.market-performance-point")).toHaveAttribute("fill", "#efab02");

    fireEvent.click(screen.getByRole("button", { name: "Brier Index ↑", exact: true }));
    expect(count()).toBe("2 / 4");
    expect(winBadges()).toHaveLength(2);
    expect(byExact(0).querySelector(".market-win-badge")).toBeNull();
    expect(byExact(2).querySelector("path.market-performance-point")).not.toBeNull();
    expect(byExact(2).querySelector(".market-win-badge")).not.toBeNull();
    expect(byExact(3)).toHaveAttribute("data-market-comparison", "tie");
    const withBI = signature();
    fireEvent.click(toggle);
    expect(winBadges()).toHaveLength(0);
    expect(signature()).toEqual(withBI);
    expect(count()).toBe("2 / 4");
    expect(JSON.stringify(fixture)).toBe(beforeData);
  });

  it("updates counts and badges only from displayed, valid configurations under the active filters", () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: fixture }));
    fireEvent.click(screen.getByRole("button", { name: "Brier Index ↑", exact: true }));
    const toggle = screen.getByRole("checkbox", { name: "Model performance: highlight market wins" });
    fireEvent.click(toggle);
    const count = () => screen.getByText("BEATS MATCHED MARKET", { exact: true }).parentElement?.querySelector("dd")?.textContent;
    const info = screen.getByRole("group", { name: "Market performance information filter" });
    fireEvent.click(within(info).getByRole("button", { name: "Freeze values", exact: true }));
    expect(count()).toBe("0 / 2");
    expect(container.querySelectorAll(".market-performance-hit")).toHaveLength(2);
    expect(container.querySelectorAll(".market-performance-hit .market-win-badge")).toHaveLength(0);
    fireEvent.click(within(info).getByRole("button", { name: "All information", exact: true }));
    expect(count()).toBe("2 / 4");
    fireEvent.click(within(screen.getByRole("group", { name: "Market performance diversity metric" })).getByRole("button", { name: "High-loss diversity", exact: true }));
    expect(count()).toBe("1 / 3");
    expect(container.querySelectorAll(".market-performance-hit")).toHaveLength(3);
    expect(container.querySelectorAll(".market-performance-hit .market-win-badge")).toHaveLength(1);
    expect(toggle).toBeChecked();
  });
});
