import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketDiversityPerformanceExplorer } from "../src/components/MarketDiversityPerformanceExplorer";
import payload from "../public/data/polymarket-aggregation/market-diversity-performance.json";
import type { MarketDiversityPerformanceData } from "../src/types/data";
import { configurations, fixtureFetch } from "./fixtures/configuration-pair";
import { modelMarketFetch } from "./fixtures/model-market";

const original = payload as unknown as MarketDiversityPerformanceData;
const data: MarketDiversityPerformanceData = {
  ...original,
  points: configurations.map((configuration, index) => ({
    ...original.points[0], ...configuration,
    diversity: { prediction_diversity: .1 + index / 10, adjusted_pog: .05 + index / 10, high_loss_lift: index === 1 ? null : -.3 - index / 10, adjusted_loss_corr: -.4, total_variation: index / 10 },
  })),
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).includes("/model-market-aggregation/") ? modelMarketFetch() : fixtureFetch(input))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("exact selection shared between overview and model + market aggregation", () => {
  it("retains a bottom selection whose overview high-loss coordinate is undefined without highlighting another model", async () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    await waitFor(() => expect(container.querySelector(".model-market-chart")).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("group", { name: "Market performance diversity metric" })).getByRole("button", { name: "High-loss diversity" }));
    const exact = configurations[1].exact_configuration;
    const target = [...container.querySelectorAll(".model-market-point")].find((point) => point.getAttribute("data-configuration") === exact)!;
    fireEvent.click(target);

    expect(container.querySelector('.model-market-point[aria-pressed="true"]')).toHaveAttribute("data-configuration", exact);
    expect(container.querySelector('.market-performance-hit[aria-pressed="true"]')).toBeNull();
    const inspector = container.querySelector(".market-performance-inspector") as HTMLElement;
    expect(inspector.querySelector("small")).toHaveTextContent(exact);
    expect(within(inspector).getByText(/undefined diversity or performance value in this overview/)).toBeInTheDocument();
    expect(container.querySelector("#configuration-pair-aggregation")).toBeNull();

    fireEvent.click(within(screen.getByRole("group", { name: "Market performance diversity metric" })).getByRole("button", { name: "Prediction diversity" }));
    expect(container.querySelector('.market-performance-hit[aria-pressed="true"]')).toHaveAttribute("data-configuration", exact);
    expect(container.querySelector('.model-market-point[aria-pressed="true"]')).toHaveAttribute("data-configuration", exact);
  });

  it("preserves the explicit exact selection across shared filters instead of choosing a visible replacement", async () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    await waitFor(() => expect(container.querySelector(".model-market-chart")).toBeInTheDocument());
    const exact = configurations[1].exact_configuration;
    const target = [...container.querySelectorAll(".model-market-point")].find((point) => point.getAttribute("data-configuration") === exact)!;
    fireEvent.click(target);
    fireEvent.change(screen.getByLabelText("Market performance provider"), { target: { value: "Z.ai" } });

    expect(container.querySelector('.market-performance-hit[aria-pressed="true"]')).toBeNull();
    expect(container.querySelector('.model-market-point[aria-pressed="true"]')).toBeNull();
    const inspector = container.querySelector(".market-performance-inspector") as HTMLElement;
    expect(inspector.querySelector("small")).toHaveTextContent(exact);
    expect(within(inspector).getByText(/outside the current provider, prompt, or information filters/)).toBeInTheDocument();
    expect(container.querySelector(".model-market-inspector")).toHaveAttribute("data-selected-configuration", exact);

    fireEvent.change(screen.getByLabelText("Market performance provider"), { target: { value: "all" } });
    expect(container.querySelector('.market-performance-hit[aria-pressed="true"]')).toHaveAttribute("data-configuration", exact);
    expect(container.querySelector('.model-market-point[aria-pressed="true"]')).toHaveAttribute("data-configuration", exact);
  });
});
