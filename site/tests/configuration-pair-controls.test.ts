import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketConfigurationAggregationExplorer, configurationProviderColor } from "../src/components/MarketConfigurationAggregationExplorer";
import { configurations, fixtureFetch, manifest, shard, view } from "./fixtures/configuration-pair";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(fixtureFetch)));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderBase = (index = 0) => render(createElement(MarketConfigurationAggregationExplorer, { base: configurations[index] }));

describe("all-configuration aggregation controls", () => {
  it("optionally badges pair-matched wins without moving points, changing colors, or replacing the selection", async () => {
    const data = shard();
    const winner = data.partners[0].views.all.combined!;
    const loser = data.partners[1].views.all.combined!;
    winner.methods.simple_mean.brier_index = 70;
    loser.market.brier_index = 82;
    for (const score of Object.values(loser.methods)) score.beats_market = false;
    // The 70-BI pair wins against its own 68-BI market; the 80-BI pair
    // loses against its own 82-BI market. A shared market mean reverses this.
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).endsWith("a.json")
      ? Promise.resolve(new Response(JSON.stringify(data), { status: 200 })) : fixtureFetch(input)));
    const { container } = renderBase();
    await screen.findByRole("img");
    const toggle = screen.getByRole("checkbox", { name: "Exact configuration aggregation: highlight market wins" });
    const points = () => [...container.querySelectorAll(".configuration-pair-point")];
    const badges = () => container.querySelectorAll(".configuration-pair-point .market-win-badge");
    fireEvent.click(points()[1]);
    const pointState = () => points().map((point) => [point.getAttribute("data-partner"), point.getAttribute("transform"), point.getAttribute("class"), point.getAttribute("aria-label"), point.querySelector(".configuration-pair-glyph")?.outerHTML]);
    const before = pointState();
    const colors = container.querySelector("defs")?.innerHTML;
    const scores = container.querySelector(".configuration-pair-inspector")?.textContent;
    const kpis = container.querySelector(".configuration-pair-kpis")?.textContent;
    expect(toggle).not.toBeChecked();
    expect(badges()).toHaveLength(0);
    expect(container.querySelectorAll("path.configuration-pair-glyph")).toHaveLength(0);
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(badges()).toHaveLength(1);
    expect(points()[0].querySelector(".market-win-badge")).not.toBeNull();
    expect(points()[1].querySelector(".market-win-badge")).toBeNull();
    expect(pointState()).toEqual(before);
    expect(container.querySelector("defs")?.innerHTML).toBe(colors);
    expect(container.querySelector(".configuration-pair-inspector")?.textContent).toBe(scores);
    expect(container.querySelector(".configuration-pair-kpis")?.textContent).toBe(kpis);
    expect(container.querySelectorAll(".market-performance-baseline, .model-market-baseline")).toHaveLength(0);
    fireEvent.click(toggle);
    expect(badges()).toHaveLength(0);
    expect(pointState()).toEqual(before);
  });

  it("keeps the existing BI win definition and follows the selected method, fold, and train sample", async () => {
    const data = shard();
    for (const row of data.partners.filter((item) => item.status === "eligible")) {
      row.views.all.a_to_b = view({ market: { ...view().market, brier_index: 85 } });
      for (const score of Object.values(row.views.all.a_to_b.methods)) score.beats_market = false;
      const combined = row.views.all.combined!;
      combined.methods.cf_directional = { ...combined.methods.cf_directional, brier_index: combined.market.brier_index, beats_market: false };
    }
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).endsWith("a.json")
      ? Promise.resolve(new Response(JSON.stringify(data), { status: 200 })) : fixtureFetch(input)));
    const { container } = renderBase();
    await screen.findByRole("img");
    const toggle = screen.getByRole("checkbox", { name: "Exact configuration aggregation: highlight market wins" });
    const badges = () => container.querySelectorAll(".configuration-pair-point .market-win-badge");
    fireEvent.click(toggle);
    expect(badges()).toHaveLength(2);
    for (const label of ["Raw Brier ↓", "Gain vs base", "Gain vs market", "Aggregation BI ↑"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(badges()).toHaveLength(2);
    }
    fireEvent.change(screen.getByLabelText("Exact configuration aggregation method"), { target: { value: "cf_directional" } });
    expect(badges()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Exact configuration aggregation method"), { target: { value: "simple_mean" } });
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(badges()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "B→A" }));
    expect(badges()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Combined" }));
    expect(badges()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Exact configuration train sample"), { target: { value: "near_bi" } });
    expect(badges()).toHaveLength(1);
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(badges()).toHaveLength(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not badge tied or undefined market BI even when raw scores can be plotted", async () => {
    const data = shard();
    const tied = data.partners[0].views.all.combined!;
    tied.methods.simple_mean.brier_index = tied.market.brier_index;
    tied.methods.simple_mean.beats_market = false;
    const missing = data.partners[1].views.all.combined!;
    missing.market.brier_index = null;
    for (const score of Object.values(missing.methods)) score.beats_market = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).endsWith("a.json")
      ? Promise.resolve(new Response(JSON.stringify(data), { status: 200 })) : fixtureFetch(input)));
    const { container } = renderBase();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Raw Brier ↓" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Exact configuration aggregation: highlight market wins" }));
    expect(container.querySelectorAll(".configuration-pair-point")).toHaveLength(2);
    expect(container.querySelectorAll(".configuration-pair-point .market-win-badge")).toHaveLength(0);
    expect(screen.getByText(/Higher BI than each point’s own matched market/)).toBeInTheDocument();
  });

  it("offers all controls and keeps raw zero TV and fixed-base-left colors", async () => {
    const { container } = renderBase();
    await screen.findByRole("img");
    expect(within(screen.getByRole("group", { name: "Exact configuration diversity metric" })).getAllByRole("button")).toHaveLength(5);
    expect(screen.getByLabelText("Exact configuration aggregation method").querySelectorAll("option")).toHaveLength(6);
    expect(within(screen.getByRole("group", { name: "Exact configuration aggregation outcome" })).getAllByRole("button")).toHaveLength(4);
    expect(screen.getByLabelText("Exact configuration support")).toHaveValue("all");
    fireEvent.click(screen.getByRole("button", { name: "Total variation (TV)" }));
    expect(container.querySelectorAll(".configuration-pair-point")).toHaveLength(2);
    expect(container.querySelector(".configuration-pair-point")?.getAttribute("transform")).toMatch(/^translate\(80 /);
    const gradients = [...container.querySelectorAll("linearGradient")];
    expect(gradients[1].querySelectorAll("stop")[0]).toHaveAttribute("stop-color", configurationProviderColor("OpenAI"));
    expect(gradients[1].querySelectorAll("stop")[2]).toHaveAttribute("stop-color", configurationProviderColor("Z.ai"));
    expect(screen.getByText("Z.ai", { selector: ".configuration-pair-legend span" })).toBeInTheDocument();
  });

  it("selects precomputed Near-BI fold views without falling back to all pairs", async () => {
    const { container } = renderBase();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Total variation (TV)" }));
    fireEvent.change(screen.getByLabelText("Exact configuration train sample"), { target: { value: "near_bi" } });
    expect(container.querySelectorAll(".configuration-pair-point")).toHaveLength(1);
    expect(container.querySelector(".configuration-pair-point title")).toHaveTextContent("0.750");
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/No all-pair values have been substituted/)).toBeInTheDocument();
  });

  it("explicitly filters small supports and independently filters partner identities", async () => {
    const { container } = renderBase();
    await screen.findByRole("img");
    fireEvent.change(screen.getByLabelText("Exact configuration support"), { target: { value: "at_least_50" } });
    expect(container.querySelectorAll(".configuration-pair-point")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Exact configuration support"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Aggregation partner provider"), { target: { value: "Z.ai" } });
    fireEvent.change(screen.getByLabelText("Aggregation partner prompt"), { target: { value: "scratchpad" } });
    fireEvent.change(screen.getByLabelText("Aggregation partner information"), { target: { value: "news" } });
    expect(container.querySelectorAll(".configuration-pair-point")).toHaveLength(1);
    expect(container.querySelector(".configuration-pair-point")).toHaveAttribute("data-partner", configurations[2].exact_configuration);
    fireEvent.change(screen.getByLabelText("Exact configuration aggregation method"), { target: { value: "cf_directional" } });
    fireEvent.click(screen.getByRole("button", { name: "Raw Brier ↓" }));
    expect(screen.getByRole("img")).toHaveAccessibleName(/Raw Brier/);
  });

  it("reports unavailable pairs rather than inventing scores", async () => {
    renderBase(3);
    await screen.findByText("No defined pair estimates in this view.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Pair availability & evaluation details"));
    expect(screen.getByText(/3 other exact configurations were considered/)).toBeInTheDocument();
    expect(screen.getAllByText(/No shared forecast targets/)).toHaveLength(3);
  });

  it("ignores late results for the previous exact configuration and aborts its request", async () => {
    let resolveFirst!: (value: Response) => void;
    let firstSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("a.json")) { firstSignal = init?.signal as AbortSignal; return new Promise<Response>((resolve) => { resolveFirst = resolve; }); }
      return fixtureFetch(input);
    }));
    const rendered = renderBase();
    await waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    rendered.rerender(createElement(MarketConfigurationAggregationExplorer, { base: configurations[1] }));
    await screen.findByRole("img");
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => resolveFirst(new Response(JSON.stringify(shard(0)), { status: 200 })));
    expect(screen.getByRole("img")).toHaveAccessibleName(new RegExp(configurations[1].exact_configuration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(document.querySelector(".configuration-pair-base")).toHaveTextContent(configurations[1].exact_configuration);
  });

  it("retries failures and caches only successful exact-configuration shards", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockImplementation(fixtureFetch);
    vi.stubGlobal("fetch", fetchMock);
    const rendered = renderBase();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry aggregation results" }));
    await screen.findByRole("img");
    rendered.rerender(createElement(MarketConfigurationAggregationExplorer, { base: configurations[1] }));
    await waitFor(() => expect(screen.getByRole("img").getAttribute("aria-label")).toContain(configurations[1].exact_configuration));
    rendered.rerender(createElement(MarketConfigurationAggregationExplorer, { base: configurations[0] }));
    await waitFor(() => expect(screen.getByRole("img").getAttribute("aria-label")).toContain(configurations[0].exact_configuration));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("a.json"))).toHaveLength(1);
    expect(manifest.configurations).toHaveLength(4);
  });
});
