import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocalStableComplementarityExplorer } from "../src/components/FocalStableComplementarityExplorer";

const directory = resolve(process.cwd(), "public/data/complementarity");
const study = readFileSync(resolve(directory, "study.json"));
const grok = "Grok-4-Fast-Reasoning (zero shot with freeze values)";
const o3 = "O3-2025-04-16 (zero shot with freeze values)";

describe("stable selected-model category complementarity", () => {
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

  it("syncs the focal model and ranks partners only by training lower bounds", async () => {
    const onSelectConfiguration = vi.fn();
    const rendered = render(createElement(FocalStableComplementarityExplorer, {
      selectedConfiguration: grok,
      onSelectConfiguration,
    }));
    const section = rendered.container.querySelector("#stable-category-complementarity") as HTMLElement;

    await waitFor(() => expect(within(section).getByLabelText("Stable complementary partner"))
      .toHaveDisplayValue(/1\. Grok-4-0709 · stable edge \+0\.28 BI/), { timeout: 10_000 });
    await waitFor(() => expect(section.querySelector(".stable-category-profile")).toBeInTheDocument());

    expect(within(section).getByLabelText("Stable focal model")).toHaveValue(grok);
    const partnerSummary = section.querySelector(".stable-pair-summary > div") as HTMLElement;
    expect(partnerSummary).toHaveTextContent("STABLE PARTNERS");
    expect(partnerSummary).toHaveTextContent("2");
    expect(partnerSummary).toHaveTextContent("49 near-skill candidates");
    expect(section).toHaveTextContent("FOCAL STABLE EDGE · LCB");
    expect(section).toHaveTextContent("PARTNER STABLE EDGE · LCB");
    expect(section).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);
    expect(section.querySelector(".stable-category-profile")).toHaveAttribute("data-screening", "stable");

    fireEvent.change(within(section).getByLabelText("Stable focal model"), { target: { value: o3 } });
    expect(onSelectConfiguration).toHaveBeenCalledWith(o3);
  }, 20_000);

  it("switches BI and ECE without changing the training-selected partner", async () => {
    const rendered = render(createElement(FocalStableComplementarityExplorer, {
      selectedConfiguration: grok,
      onSelectConfiguration: vi.fn(),
    }));
    const section = rendered.container.querySelector("#stable-category-complementarity") as HTMLElement;
    await waitFor(() => expect(section.querySelector(".stable-category-profile")).toBeInTheDocument(), { timeout: 10_000 });

    const partner = within(section).getByLabelText("Stable complementary partner") as HTMLSelectElement;
    const selectedPair = partner.value;
    const metric = within(section).getByRole("group", { name: "Stable category profile metric" });
    fireEvent.click(within(metric).getByRole("button", { name: "ECE ↓" }));

    expect(partner).toHaveValue(selectedPair);
    expect(section.querySelector(".stable-category-profile")).toHaveAttribute("data-profile-metric", "ece");
    expect(section).toHaveTextContent("ECE further left is better");
    expect(section.querySelector(".stable-category-profile figcaption")).toHaveTextContent("does not enter partner selection");
  }, 20_000);

  it("keeps empty states interactive under stricter controls", async () => {
    const rendered = render(createElement(FocalStableComplementarityExplorer, {
      selectedConfiguration: grok,
      onSelectConfiguration: vi.fn(),
    }));
    const section = rendered.container.querySelector("#stable-category-complementarity") as HTMLElement;
    await waitFor(() => expect(section.querySelector(".stable-category-profile")).toBeInTheDocument(), { timeout: 10_000 });

    fireEvent.change(within(section).getByLabelText("Stable category rule"), { target: { value: "strict" } });
    await waitFor(() => expect(section).toHaveTextContent("No stable partner under these controls."));
    expect(within(section).getByLabelText("Stable complementary partner")).toBeDisabled();

    fireEvent.change(within(section).getByLabelText("Stable category rule"), { target: { value: "main" } });
    fireEvent.click(within(section).getByRole("button", { name: "Source / platform" }));
    await waitFor(() => expect(within(section).getByLabelText("Stable complementary partner")).toHaveDisplayValue(/1\. Claude-Sonnet-4-6 · stable edge \+0\.77 BI/));
    await waitFor(() => expect(section.querySelector(".stable-category-profile")).toBeInTheDocument());
  }, 20_000);
});
