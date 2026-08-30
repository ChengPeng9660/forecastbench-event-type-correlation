import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import payload from "../public/data/polymarket-aggregation/market-diversity-performance.json";
import { MarketDiversityPerformanceExplorer } from "../src/components/MarketDiversityPerformanceExplorer";
import { existingLinksForConfiguration } from "../src/lib/existingAggregationLinks";
import type { MarketDiversityPerformanceData } from "../src/types/data";

const data = payload as unknown as MarketDiversityPerformanceData;
const grok = "Grok-4-Fast-Reasoning (zero shot with freeze values)";
vi.mock("../src/components/MarketConfigurationAggregationExplorer", () => ({ MarketConfigurationAggregationExplorer: () => null }));

function marker(container: HTMLElement, exact: string) {
  return [...container.querySelectorAll(".market-performance-hit")].find((node) => node.getAttribute("data-configuration") === exact)!;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("market configuration links to existing experiments", () => {
  it("links the selected exact configuration to both published upper-left blocks", () => {
    window.history.replaceState(null, "", "/?metric=total_variation&near_bi=0#market-performance");
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    fireEvent.click(marker(container, grok));
    const inspector = container.querySelector(".market-performance-inspector") as HTMLElement;
    const links = within(inspector).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links.map((link) => new URL(link.getAttribute("href")!, window.location.href).searchParams.get("upper_left_view"))).toEqual(["crossfit", "fixed"]);
    for (const link of links) {
      const url = new URL(link.getAttribute("href")!, window.location.href);
      expect(url.searchParams.get("upper_left_base")).toBe(grok);
      expect(url.searchParams.get("metric")).toBe("total_variation");
      expect(url.searchParams.get("near_bi")).toBe("0");
      expect(url.hash).toBe("#upper-left-pairs");
    }
    expect(inspector).toHaveTextContent("Polymarket questions only");
    expect(inspector).toHaveTextContent("Full-sample descriptive");
    expect(inspector).toHaveTextContent("4 published methods");
  });

  it("shows broader-support scope for an audited exact-to-fixed-base link", () => {
    const exact = data.points.find((point) => existingLinksForConfiguration(point.exact_configuration).some((link) => link.page === "fixed-focal-no-freeze"))!.exact_configuration;
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    fireEvent.click(marker(container, exact));
    const inspector = container.querySelector(".market-performance-inspector") as HTMLElement;
    expect(within(inspector).getByRole("link")).toHaveAttribute("href", expect.stringContaining("#fixed-focal-no-freeze"));
    expect(inspector).toHaveTextContent("Dataset + market questions: broader support than this overview");
  });

  it("offers the new experiment without fabricating earlier links for unsupported exact configurations", () => {
    const unsupported = data.points.filter((point) => existingLinksForConfiguration(point.exact_configuration).length === 0);
    expect(unsupported.length).toBeGreaterThan(0);
    for (const point of unsupported) expect(existingLinksForConfiguration(point.exact_configuration)).toEqual([]);
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    fireEvent.click(marker(container, unsupported[0].exact_configuration));
    expect(container.querySelector(".market-performance-inspector a")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore aggregation ↓" })).toBeInTheDocument();
    expect(screen.queryByText("EARLIER EXPERIMENTS")).not.toBeInTheDocument();
  });

  it.each(["Enter", " "])("allows keyboard selection with %s without navigating", (key) => {
    window.history.replaceState(null, "", "/#market-performance");
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    fireEvent.keyDown(marker(container, grok), { key });
    expect(marker(container, grok)).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".market-performance-inspector a")).toHaveLength(2);
    expect(window.location.hash).toBe("#market-performance");
  });
});
