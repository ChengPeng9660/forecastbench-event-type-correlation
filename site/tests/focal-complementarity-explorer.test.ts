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

describe("selected-model category profile", () => {
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

  it("removes the partner scatter and inspector while keeping the category profile selectable", async () => {
    const onSelectConfiguration = vi.fn();
    const rendered = render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude, onSelectConfiguration }));
    const section = rendered.container.querySelector("#focal-model-complementarity") as HTMLElement;

    await waitFor(() => expect(within(section).getByLabelText("Selected complementary partner")).toHaveDisplayValue(/1\. Mistral-Large-Latest · Dtype 0\.181/), { timeout: 10_000 });
    await waitFor(() => expect(section.querySelector(".focal-category-profile")).toBeInTheDocument());

    expect(within(section).getByLabelText("Selected focal model")).toHaveValue(claude);
    expect(section.querySelector(".focal-complementarity-scatter")).not.toBeInTheDocument();
    expect(section.querySelector(".focal-complementarity-inspector")).not.toBeInTheDocument();
    expect(section.querySelector(".focal-pair-picker")).not.toBeInTheDocument();
    expect(section.querySelector(".focal-configuration-line")).not.toBeInTheDocument();
    expect(section).not.toHaveTextContent("TEST PERFORMANCE · Y");
    expect(section).not.toHaveTextContent("Gain vs better single");
    expect(section).not.toHaveTextContent("TRAIN-SELECTED PARTNER · RANK");

    const profile = section.querySelector(".focal-category-profile") as HTMLElement;
    expect(profile).toHaveAttribute("data-profile-metric", "bi");
    expect(profile).toHaveTextContent("Focal · Claude-2.1");
    expect(profile).toHaveTextContent("Partner · Mistral-Large-Latest");
    expect(profile).toHaveTextContent("Finance");
    expect(profile).toHaveTextContent("Politics");
    expect(profile).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);
    expect(profile.querySelectorAll('g[opacity="0.35"], g[opacity=".35"]')).toHaveLength(0);

    fireEvent.change(within(section).getByLabelText("Selected focal model"), { target: { value: kimi } });
    expect(onSelectConfiguration).toHaveBeenCalledWith(kimi);
  }, 20_000);

  it("switches the retained profile between BI and 10-bin ECE without changing the pair", async () => {
    const rendered = render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude, onSelectConfiguration: vi.fn() }));
    const section = rendered.container.querySelector("#focal-model-complementarity") as HTMLElement;
    await waitFor(() => expect(section.querySelector(".focal-category-profile")).toBeInTheDocument(), { timeout: 10_000 });

    const partnerSelect = within(section).getByLabelText("Selected complementary partner") as HTMLSelectElement;
    const initialPair = partnerSelect.value;
    const metricControls = within(section).getByRole("group", { name: "Category profile metric" });
    expect(within(metricControls).getAllByRole("button")).toHaveLength(2);
    expect(within(metricControls).getByRole("button", { name: "Brier Index ↑" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(metricControls).getByRole("button", { name: "ECE ↓" }));
    expect(partnerSelect).toHaveValue(initialPair);
    expect(section.querySelector(".focal-category-profile")).toHaveAttribute("data-profile-metric", "ece");
    expect(section.querySelector(".focal-category-profile")).toHaveTextContent("ECE further left is better");
    expect(section.querySelector(".focal-category-profile figcaption")).toHaveTextContent("10 fixed equal-width bins over [0, 1]");

    fireEvent.click(within(metricControls).getByRole("button", { name: "Brier Index ↑" }));
    expect(section.querySelector(".focal-category-profile")).toHaveAttribute("data-profile-metric", "bi");
  }, 20_000);

  it("keeps grouping and scope controls connected to the lower profile", async () => {
    const rendered = render(createElement(FocalComplementarityExplorer, { selectedConfiguration: claude, onSelectConfiguration: vi.fn() }));
    const section = rendered.container.querySelector("#focal-model-complementarity") as HTMLElement;
    await waitFor(() => expect(section.querySelector(".focal-category-profile")).toBeInTheDocument(), { timeout: 10_000 });

    fireEvent.click(within(section).getByRole("button", { name: "Source / platform" }));
    await waitFor(() => expect(section).toHaveTextContent("No crossed-strength partner under these controls."));
    expect(within(section).getByLabelText("Selected complementary partner")).toBeDisabled();

    fireEvent.click(within(section).getByRole("button", { name: "Event type" }));
    fireEvent.change(within(section).getByLabelText("Selected-model partner scope"), { target: { value: "matched_conditions" } });
    await waitFor(() => expect(within(section).getByLabelText("Selected complementary partner").querySelectorAll("option").length).toBe(7));
    await waitFor(() => expect(section.querySelector(".focal-category-profile")).toBeInTheDocument());

    rendered.rerender(createElement(FocalComplementarityExplorer, { selectedConfiguration: mistral, onSelectConfiguration: vi.fn() }));
    await waitFor(() => expect(within(section).getByLabelText("Selected focal model")).toHaveValue(mistral));
    await waitFor(() => expect(section.querySelector(".focal-category-profile")).toBeInTheDocument());
    expect(section).not.toHaveTextContent("Train / test events");
    expect(section).not.toHaveTextContent(/\d+\s*\/\s*\d+\s+events/);
  }, 20_000);
});
