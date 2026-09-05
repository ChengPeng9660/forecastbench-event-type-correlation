import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelMarketAggregationExplorer, type ModelMarketAggregationExplorerProps } from "../src/components/ModelMarketAggregationExplorer";
import { configurations } from "./fixtures/configuration-pair";
import { modelMarketFetch, modelMarketFixture } from "./fixtures/model-market";

const defaults: ModelMarketAggregationExplorerProps = { selectedConfiguration: configurations[0].exact_configuration, onSelectConfiguration: vi.fn(), filters: { provider: "all", prompt: "all", information: "all" } };
const renderChart = (props: Partial<ModelMarketAggregationExplorerProps> = {}) => render(createElement(ModelMarketAggregationExplorer, { ...defaults, ...props }));
beforeEach(() => vi.stubGlobal("fetch", vi.fn(modelMarketFetch)));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("model + market aggregation controls", () => {
  it("keeps exactly the requested five X tabs, two aggregation outcomes, and six unchanged methods", async () => {
    renderChart();
    await screen.findByRole("img");
    expect(within(screen.getByRole("group", { name: "Model + market diversity metric" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["Prediction diversity", "Adjusted POG", "High-loss diversity", "Adjusted-loss diversity", "Total variation (TV)"]);
    expect(within(screen.getByRole("group", { name: "Model + market performance outcome" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["Brier Score ↓", "Brier Index ↑"]);
    const methods = screen.getByLabelText("Model + market aggregation method");
    expect(methods).toHaveValue("ec_w0_56");
    expect([...methods.querySelectorAll("option")].map((option) => option.value)).toEqual(modelMarketFixture().method_order);
    expect(screen.getByLabelText("Model + market train sample")).toHaveValue("all");
  });

  it("optionally badges wins on the selected metric without moving, hiding, or recoloring points", async () => {
    const { container } = renderChart();
    await screen.findByRole("img");
    const markers = () => [...container.querySelectorAll(".model-market-point")];
    const byExact = (exact: string) => markers().find((point) => point.getAttribute("data-configuration") === exact)!;
    const toggle = screen.getByRole("checkbox", { name: "Model + market aggregation: highlight market wins" });
    const badges = () => container.querySelectorAll(".model-market-point .market-win-badge");
    const signature = () => markers().map((point) => [point.getAttribute("data-configuration"), point.getAttribute("transform"), point.querySelector(".model-market-glyph")?.getAttribute("fill")]);
    const count = () => screen.getByText("BEATS MATCHED MARKET", { exact: true }).parentElement?.querySelector("dd")?.textContent;
    expect(toggle).not.toBeChecked();
    expect(badges()).toHaveLength(0);
    expect(markers().every((point) => point.getAttribute("data-marker-shape") === "circle")).toBe(true);
    expect(count()).toBe("1 / 3");
    expect(container.querySelector(".model-market-baseline")).toBeNull();
    expect(byExact(configurations[2].exact_configuration)).toHaveAttribute("data-market-comparison", "tie");
    expect(byExact(configurations[2].exact_configuration).querySelector("rect")).toBeNull();
    const before = signature();
    fireEvent.click(toggle);
    expect(badges()).toHaveLength(1);
    expect(byExact(configurations[0].exact_configuration).querySelector(".market-win-badge")).not.toBeNull();
    expect(byExact(configurations[1].exact_configuration).querySelector(".market-win-badge")).toBeNull();
    expect(signature()).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Brier Score ↓" }));
    expect(badges()).toHaveLength(2);
    expect(byExact(configurations[1].exact_configuration)).toHaveAttribute("data-market-comparison", "above");
    expect(count()).toBe("2 / 3");
    fireEvent.change(screen.getByLabelText("Model + market aggregation method"), { target: { value: "simple_mean" } });
    expect(badges()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Brier Index ↑" }));
    expect(count()).toBe("0 / 3");
    expect(badges()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Model + market aggregation method"), { target: { value: "ec_w0_56" } });
    expect(badges()).toHaveLength(1);
    fireEvent.click(toggle);
    expect(badges()).toHaveLength(0);
    expect(signature()).toEqual(before);
    expect(markers().every((point) => point.getAttribute("data-marker-shape") === "circle")).toBe(true);
  });

  it("links exact identities without substituting similar model names, paints the selected point last, and supports keyboard selection", async () => {
    const onSelectConfiguration = vi.fn();
    const rendered = renderChart({ onSelectConfiguration });
    await screen.findByRole("img");
    const selected = () => rendered.container.querySelector('.model-market-point[aria-pressed="true"]');
    expect(selected()).toHaveAttribute("data-configuration", configurations[0].exact_configuration);
    expect([...rendered.container.querySelectorAll(".model-market-point")].at(-1)).toBe(selected());
    expect(selected()?.querySelector(".model-market-selection-halo")).not.toBeNull();
    rendered.rerender(createElement(ModelMarketAggregationExplorer, { ...defaults, onSelectConfiguration, selectedConfiguration: configurations[1].exact_configuration }));
    expect(selected()).toHaveAttribute("data-configuration", configurations[1].exact_configuration);
    fireEvent.keyDown(selected()!, { key: "Enter" });
    expect(onSelectConfiguration).toHaveBeenLastCalledWith(configurations[1].exact_configuration);
    rendered.rerender(createElement(ModelMarketAggregationExplorer, { ...defaults, onSelectConfiguration, selectedConfiguration: null }));
    expect(selected()).toBeNull();
    expect(screen.getByText(/Select a configuration in the first chart/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("inherits exact filters and shows an unavailable selection without highlighting a replacement", async () => {
    const rendered = renderChart();
    await screen.findByRole("img");
    rendered.rerender(createElement(ModelMarketAggregationExplorer, { ...defaults, filters: { provider: "Z.ai", prompt: "scratchpad", information: "news" } }));
    expect(rendered.container.querySelectorAll(".model-market-point")).toHaveLength(1);
    expect(rendered.container.querySelector('.model-market-point[aria-pressed="true"]')).toBeNull();
    expect(screen.getByText(/outside the provider, prompt, or information filters/)).toBeInTheDocument();
  });

  it("keeps zero TV and uses only the chosen precomputed Near-BI direction", async () => {
    const { container } = renderChart();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Total variation (TV)" }));
    expect(container.querySelector('.model-market-point[aria-pressed="true"]')).toHaveAttribute("transform", expect.stringMatching(/^translate\(88 /));
    fireEvent.change(screen.getByLabelText("Model + market train sample"), { target: { value: "near_bi" } });
    expect(container.querySelectorAll(".model-market-point")).toHaveLength(1);
    expect(container.querySelector(".model-market-point title")).toHaveTextContent("Total variation (TV): 0.750");
    fireEvent.change(screen.getByLabelText("Model + market cross-fit direction"), { target: { value: "a_to_b" } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/No model \+ market results to plot/)).toBeInTheDocument();
    expect(screen.getByText(/No other configuration or all-sample result has been substituted/)).toBeInTheDocument();
  });

  it("retries a failed fetch and clears the error after recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockImplementation(modelMarketFetch);
    vi.stubGlobal("fetch", fetchMock);
    renderChart();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry model + market results" }));
    await screen.findByRole("img");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains raw high-loss coordinates and null exclusions without the explanation block", async () => {
    const data = modelMarketFixture();
    data.points[0].views.all.combined!.train_diversity.high_loss_lift = -200;
    data.points[1].views.all.combined!.train_diversity.high_loss_lift = null;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    const { container } = renderChart();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    expect(screen.queryByRole("note", { name: "High-loss metric diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByText("How to interpret this metric", { exact: true })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".model-market-point")).toHaveLength(2);
    expect(container.querySelector('.model-market-point[aria-pressed="true"] title')).toHaveTextContent("High-loss diversity: -200.00");
    expect(screen.getByText("PEARSON r", { exact: true }).parentElement?.querySelector("dd")).toHaveTextContent("—");
    expect(screen.getByText("SPEARMAN ρ", { exact: true }).parentElement?.querySelector("dd")).toHaveTextContent("—");
    expect(screen.getByText(/signed-log display; raw ticks/)).toBeInTheDocument();
  });

  it("cancels the summary fetch when the block unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); }));
    const rendered = renderChart();
    await waitFor(() => expect(signal).toBeDefined());
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
