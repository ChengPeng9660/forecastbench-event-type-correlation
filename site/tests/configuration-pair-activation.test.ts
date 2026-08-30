import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketDiversityPerformanceExplorer } from "../src/components/MarketDiversityPerformanceExplorer";
import payload from "../public/data/polymarket-aggregation/market-diversity-performance.json";
import type { MarketDiversityPerformanceData } from "../src/types/data";
import { configurations, fixtureFetch } from "./fixtures/configuration-pair";

const original = payload as unknown as MarketDiversityPerformanceData;
const data: MarketDiversityPerformanceData = { ...original, points: configurations.map((item) => ({ ...original.points[0], ...item })) };
beforeEach(() => vi.stubGlobal("fetch", vi.fn(fixtureFetch)));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("overview-to-aggregation activation", () => {
  it("loads lazily on activation, not focus, and pins the exact base across overview filters", async () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    const points = [...container.querySelectorAll(".market-performance-hit")];
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.focus(points[0]);
    expect(container.querySelector("#configuration-pair-aggregation")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(points[0]);
    await waitFor(() => expect(container.querySelector(".configuration-pair-chart")).toBeInTheDocument());
    expect(container.querySelector(".configuration-pair-base")).toHaveTextContent(configurations[0].exact_configuration);
    fireEvent.focus(points[1]);
    expect(container.querySelector(".configuration-pair-base")).toHaveTextContent(configurations[0].exact_configuration);
    fireEvent.keyDown(points[1], { key: "Enter" });
    await waitFor(() => expect(container.querySelector(".configuration-pair-chart")?.getAttribute("aria-label")).toContain(configurations[1].exact_configuration));
    fireEvent.change(screen.getByLabelText("Market performance provider"), { target: { value: "Z.ai" } });
    expect(container.querySelector(".configuration-pair-base")).toHaveTextContent(configurations[1].exact_configuration);
    expect(screen.getByLabelText("Aggregation partner provider")).toHaveValue("all");
  });

  it("provides the primary aggregation action even when no earlier experiment exists", async () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data }));
    expect(container.querySelector(".market-performance-aggregation-links a")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore aggregation ↓" }));
    await waitFor(() => expect(container.querySelector(".configuration-pair-chart")).toBeInTheDocument());
    expect(container.querySelector(".configuration-pair-base")).toHaveTextContent(configurations[0].exact_configuration);
  });
});
