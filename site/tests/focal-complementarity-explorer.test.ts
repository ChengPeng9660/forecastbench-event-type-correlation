import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocalComplementarityExplorer } from "../src/components/FocalComplementarityExplorer";

const directory = resolve(process.cwd(), "public/data/complementarity");
const study = readFileSync(resolve(directory, "study.json"));
const claude = "Claude-2.1 (zero shot with freeze values)";
const kimi = "Kimi-K2-Instruct-0905 (zero shot with freeze values)";
const mistral = "Mistral-Large-Latest (zero shot with freeze values)";

describe("selected-model complementarity explorer", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "0px";
      thresholds = [0];
    });
    vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request instanceof Request ? request.url : request);
      if (url.endsWith("/data/complementarity/study.json")) return new Response(study);
      const shard = url.match(/\/profiles\/([^/]+)\.json$/)?.[1];
      if (shard) return new Response(readFileSync(resolve(directory, `profiles/${shard}.json`)));
      return new Response("not found", { status: 404 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fixes the exact focal configuration and selects its partner using training Dtype", async () => {
    const rendered = render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude }));
    const section = rendered.container.querySelector("#focal-model-complementarity") as HTMLElement;

    await waitFor(() => expect(within(section).getByLabelText("Selected complementary partner")).toHaveDisplayValue(/1\. Mistral-Large-Latest · Dtype 0\.181/), { timeout: 10_000 });
    expect(section).toHaveTextContent(claude);
    expect(section).not.toHaveTextContent("Training-only screen.");
    expect(section).not.toHaveTextContent("WHAT THE COMPLETE EXPERIMENT FOUND");
    expect(section).not.toHaveTextContent("Selected-model complementarity details");
    expect(section.querySelector(".focal-complementarity-kpis")).not.toBeInTheDocument();
    expect(section).not.toHaveTextContent(/SCREENED PARTNERS|MEAN OOS GAIN|BEATS BOTH|NEAR-SKILL BASELINE|FULL STUDY/);
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", claude);
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Mistral-Large-Latest (zero shot with freeze values)");
    expect(section.querySelector('.focal-complementarity-point[data-training-rank="1"]')).toHaveAttribute("aria-pressed", "true");
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveTextContent("+3.039 BI");
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveTextContent("Same prompt");
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveTextContent("Same information");
    await waitFor(() => expect(section.querySelector(".focal-category-profile")).toBeInTheDocument());
    const profile = section.querySelector(".focal-category-profile") as HTMLElement;
    expect(profile).toHaveTextContent("Finance");
    expect(profile).toHaveTextContent("Politics");
    expect(profile).not.toHaveTextContent("Finance & economics");
    expect(profile).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);
    expect(section).not.toHaveTextContent("Train / test events");
    expect(section).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);
    expect(profile.querySelectorAll('g[opacity="0.35"], g[opacity=".35"]')).toHaveLength(0);
    expect(profile).not.toHaveTextContent("are faded");
    expect(section.querySelector(".focal-transfer-verdict")).not.toBeInTheDocument();
  }, 20_000);

  it("switches the held-out Y axis between gain and absolute aggregation BI without changing the screened pair", async () => {
    render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude }));
    const section = document.querySelector("#focal-model-complementarity") as HTMLElement;
    await waitFor(() => expect(section.querySelectorAll(".focal-complementarity-point")).toHaveLength(25), { timeout: 10_000 });

    const outcomeControls = within(section).getByRole("group", { name: "Selected-model complementarity test outcome" });
    expect(within(outcomeControls).getAllByRole("button")).toHaveLength(2);
    expect(within(outcomeControls).getByRole("button", { name: "Gain vs better single" })).toHaveAttribute("aria-pressed", "true");
    expect(within(section).getByRole("img", { name: /held-out aggregation gain for partners/ })).toBeInTheDocument();
    expect(section.querySelector(".focal-complementarity-zero")).toBeInTheDocument();

    const selectedPoint = section.querySelector('.focal-complementarity-point[data-training-rank="1"]') as SVGGElement;
    const gainTransform = selectedPoint.getAttribute("transform");
    const gainColor = selectedPoint.querySelector(".focal-complementarity-glyph")?.getAttribute("fill");
    const partner = section.querySelector(".focal-complementarity-inspector")?.getAttribute("data-partner-configuration");
    expect(partner).toBeTruthy();

    fireEvent.click(within(outcomeControls).getByRole("button", { name: "Aggregation BI ↑" }));
    expect(section.querySelector(".focal-complementarity-scatter")).toHaveAttribute("data-y-axis", "aggregation_bi");
    expect(within(section).getByRole("img", { name: /held-out aggregation Brier Index for partners/ })).toBeInTheDocument();
    expect(section).toHaveTextContent("Held-out aggregation Brier Index (higher is better)");
    expect(section.querySelector(".focal-complementarity-zero")).not.toBeInTheDocument();
    expect(section.querySelectorAll(".focal-complementarity-point")).toHaveLength(25);
    const absoluteSelectedPoint = section.querySelector('.focal-complementarity-point[data-training-rank="1"]') as SVGGElement;
    expect(absoluteSelectedPoint.getAttribute("transform")).not.toBe(gainTransform);
    expect(absoluteSelectedPoint.querySelector(".focal-complementarity-glyph")?.getAttribute("fill")).toBe(gainColor);
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", partner ?? "");
    expect(section.querySelector(".focal-complementarity-readout")).toHaveTextContent(/aggregation BI \d/);

    fireEvent.click(within(outcomeControls).getByRole("button", { name: "Gain vs better single" }));
    expect(section.querySelector(".focal-complementarity-scatter")).toHaveAttribute("data-y-axis", "gain_vs_better_single");
    expect(section.querySelector(".focal-complementarity-zero")).toBeInTheDocument();
  }, 20_000);

  it("keeps empty source results explicit, exposes the condition-matched control, and follows prop changes", async () => {
    const rendered = render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude }));
    const section = rendered.container.querySelector("#focal-model-complementarity") as HTMLElement;
    await waitFor(() => expect(section.querySelectorAll(".focal-complementarity-point")).toHaveLength(25), { timeout: 10_000 });

    fireEvent.click(within(section).getByRole("button", { name: "Source / platform" }));
    await waitFor(() => expect(section).toHaveTextContent("No crossed-strength partner under these controls."));

    fireEvent.click(within(section).getByRole("button", { name: "Event type" }));
    fireEvent.change(within(section).getByLabelText("Selected-model partner scope"), { target: { value: "matched_conditions" } });
    await waitFor(() => expect(section.querySelectorAll(".focal-complementarity-point")).toHaveLength(6));

    fireEvent.change(within(section).getByLabelText("Selected-model aggregation method"), { target: { value: "simple_mean" } });
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveTextContent("+0.712 BI");

    fireEvent.change(within(section).getByLabelText("Selected-model partner scope"), { target: { value: "all" } });
    fireEvent.change(within(section).getByLabelText("Selected-model aggregation method"), { target: { value: "cf_directional" } });
    rendered.rerender(createElement(FocalComplementarityExplorer, { selectedConfiguration: mistral }));
    await waitFor(() => expect(section.querySelectorAll(".focal-complementarity-point")).toHaveLength(58));
    await waitFor(() => expect(section.querySelector('.focal-complementarity-point[data-training-rank="1"]')).toHaveAttribute("aria-pressed", "true"));
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Claude-2.1 (scratchpad with news with freeze values)");
    expect(section).not.toHaveTextContent("Train / test events");
    expect(section).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);

    rendered.rerender(createElement(FocalComplementarityExplorer, { selectedConfiguration: kimi }));
    await waitFor(() => expect(section.querySelectorAll(".focal-complementarity-point")).toHaveLength(29));
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", kimi);
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Kimi-K2-Thinking (zero shot with freeze values)");
    expect(section).not.toHaveTextContent("Train / test events");
    expect(section).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);
  }, 20_000);
});
