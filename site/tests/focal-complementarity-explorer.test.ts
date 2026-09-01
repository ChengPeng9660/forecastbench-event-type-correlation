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

function valueFor(section: HTMLElement, label: string) {
  const term = [...section.querySelectorAll("dt")].find(node => node.textContent === label);
  if (!term?.parentElement) throw new Error(`Missing KPI: ${label}`);
  return term.parentElement;
}

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

    await waitFor(() => expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("25"), { timeout: 10_000 });
    expect(section).toHaveTextContent(claude);
    expect(section).not.toHaveTextContent("Training-only screen.");
    expect(section).not.toHaveTextContent("WHAT THE COMPLETE EXPERIMENT FOUND");
    expect(section).not.toHaveTextContent("Selected-model complementarity details");
    expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("54 near-skill candidates");
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", claude);
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Mistral-Large-Latest (zero shot with freeze values)");
    expect(within(section).getByLabelText("Selected complementary partner")).toHaveDisplayValue(/1\. Mistral-Large-Latest · Dtype 0\.181/);
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
    expect(profile.querySelectorAll('g[opacity="0.35"], g[opacity=".35"]')).toHaveLength(0);
    expect(profile).not.toHaveTextContent("are faded");
    expect(section.querySelector(".focal-transfer-verdict")).not.toBeInTheDocument();
  }, 20_000);

  it("keeps empty source results explicit, exposes the condition-matched control, and follows prop changes", async () => {
    const rendered = render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude }));
    const section = rendered.container.querySelector("#focal-model-complementarity") as HTMLElement;
    await waitFor(() => expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("25"), { timeout: 10_000 });

    fireEvent.click(within(section).getByRole("button", { name: "Source / platform" }));
    expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("0");
    expect(section).toHaveTextContent("No crossed-strength partner under these controls.");

    fireEvent.click(within(section).getByRole("button", { name: "Event type" }));
    fireEvent.change(within(section).getByLabelText("Selected-model partner scope"), { target: { value: "matched_conditions" } });
    expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("6");
    expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("10 near-skill candidates");

    fireEvent.change(within(section).getByLabelText("Selected-model aggregation method"), { target: { value: "simple_mean" } });
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveTextContent("+0.712 BI");

    fireEvent.change(within(section).getByLabelText("Selected-model partner scope"), { target: { value: "all" } });
    fireEvent.change(within(section).getByLabelText("Selected-model aggregation method"), { target: { value: "cf_directional" } });
    rendered.rerender(createElement(FocalComplementarityExplorer, { selectedConfiguration: mistral }));
    await waitFor(() => expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("58"));
    await waitFor(() => expect(section.querySelector('.focal-complementarity-point[data-training-rank="1"]')).toHaveAttribute("aria-pressed", "true"));
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Claude-2.1 (scratchpad with news with freeze values)");

    rendered.rerender(createElement(FocalComplementarityExplorer, { selectedConfiguration: kimi }));
    await waitFor(() => expect(valueFor(section, "SCREENED PARTNERS")).toHaveTextContent("29"));
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-focal-configuration", kimi);
    expect(section.querySelector(".focal-complementarity-inspector")).toHaveAttribute("data-partner-configuration", "Kimi-K2-Thinking (zero shot with freeze values)");
  }, 20_000);
});
