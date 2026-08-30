import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketConfigurationAggregationExplorer, configurationProviderColor } from "../src/components/MarketConfigurationAggregationExplorer";
import { configurations, fixtureFetch, manifest, shard } from "./fixtures/configuration-pair";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(fixtureFetch)));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderBase = (index = 0) => render(createElement(MarketConfigurationAggregationExplorer, { base: configurations[index] }));

describe("all-configuration aggregation controls", () => {
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
