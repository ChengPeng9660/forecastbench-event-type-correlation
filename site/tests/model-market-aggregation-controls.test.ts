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
    expect(within(screen.getByRole("group", { name: "Model + market performance outcome" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["Raw Brier Score ↓", "Brier Index ↑"]);
    const methods = screen.getByLabelText("Model + market aggregation method");
    expect(methods).toHaveValue("ec_w0_56");
    expect([...methods.querySelectorAll("option")].map((option) => option.value)).toEqual(modelMarketFixture().method_order);
    expect(screen.getByLabelText("Model + market train sample")).toHaveValue("all");
  });

  it("uses the aggregate's own matched BI for triangles, with losses and ties as circles even on the raw-Brier axis", async () => {
    const { container } = renderChart();
    await screen.findByRole("img");
    const markers = () => [...container.querySelectorAll(".model-market-point")];
    const byExact = (exact: string) => markers().find((point) => point.getAttribute("data-configuration") === exact)!;
    expect(byExact(configurations[0].exact_configuration)).toHaveAttribute("data-marker-shape", "triangle");
    expect(byExact(configurations[1].exact_configuration)).toHaveAttribute("data-marker-shape", "circle");
    expect(byExact(configurations[2].exact_configuration)).toHaveAttribute("data-marker-shape", "circle");
    expect(byExact(configurations[2].exact_configuration).querySelector("rect")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raw Brier Score ↓" }));
    expect(byExact(configurations[1].exact_configuration)).toHaveAttribute("data-marker-shape", "circle");
    expect(byExact(configurations[0].exact_configuration)).toHaveAttribute("data-marker-shape", "triangle");
    fireEvent.change(screen.getByLabelText("Model + market aggregation method"), { target: { value: "simple_mean" } });
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
    expect(screen.getByText(/No defined model \+ market results/)).toBeInTheDocument();
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

  it("uses the shared high-loss display policy while retaining raw coordinates and null exclusions", async () => {
    const data = modelMarketFixture();
    data.points[0].views.all.combined!.train_diversity.high_loss_lift = -200;
    data.points[1].views.all.combined!.train_diversity.high_loss_lift = null;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    const { container } = renderChart();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    expect(screen.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveTextContent("signed-log spacing");
    expect(container.querySelectorAll(".model-market-point")).toHaveLength(2);
    expect(container.querySelector('.model-market-point[aria-pressed="true"] title')).toHaveTextContent("High-loss diversity: -200.00");
    expect(screen.getByText(/Association not reported: fewer than three displayed pairs/)).toBeInTheDocument();
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
