import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocalWithinTopicComplementarity } from "../src/components/FocalWithinTopicComplementarity";

const directory = resolve(process.cwd(), "public/data/within-topic-complementarity");
const study = JSON.parse(readFileSync(resolve(directory, "study.json"), "utf8")) as { focal_files: Record<string, string> };
const focal = "Grok-4-Fast-Reasoning (zero shot with freeze values)";

function valueFor(section: HTMLElement, label: string) {
  const term = [...section.querySelectorAll("dt")].find(node => node.textContent === label);
  if (!term?.parentElement) throw new Error(`Missing KPI: ${label}`);
  return term.parentElement;
}

describe("within-topic focal explorer", () => {
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
      if (url.endsWith("/data/within-topic-complementarity/study.json")) return new Response(readFileSync(resolve(directory, "study.json")));
      const file = url.match(/\/data\/within-topic-complementarity\/(focals\/\d+\.json)$/)?.[1];
      return file ? new Response(readFileSync(resolve(directory, file))) : new Response("not found", { status: 404 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("follows the first-chart exact focal and ranks finance partners only with training POG", async () => {
    const rendered = render(createElement(FocalWithinTopicComplementarity, { selectedConfiguration: focal }));
    const section = rendered.container.querySelector("#within-topic-complementarity") as HTMLElement;
    await waitFor(() => expect(valueFor(section, "ELIGIBLE PARTNERS")).toHaveTextContent("42"), { timeout: 15_000 });
    expect(section).toHaveTextContent(focal);
    expect(section).toHaveTextContent("Training-only screen");
    expect(within(section).getByLabelText("Within-topic complementary partner")).toHaveDisplayValue(/1\. GLM-4\.6 · POG 0\.158/);
    expect(section.querySelector(".within-topic-inspector")).toHaveAttribute("data-focal-configuration", focal);
    expect(section.querySelector(".within-topic-inspector")).toHaveAttribute("data-partner-configuration", "GLM-4.6 (zero shot)");
    expect(section.querySelector('.within-topic-point[data-training-rank="1"]')).toHaveAttribute("aria-pressed", "true");
    expect(section.querySelector('.within-topic-point[data-training-rank="1"]')).toHaveAttribute("data-outcome", "below-or-tied");
    expect(section.querySelectorAll(".within-topic-glyph.win").length).toBeGreaterThan(0);
    expect(section.querySelectorAll(".within-topic-glyph.miss").length).toBeGreaterThan(0);
    expect(section.querySelector(".within-topic-coverage")).toHaveTextContent("Focal lower loss");
    expect(section).not.toHaveTextContent("All-model check under these controls.");
    expect(section).not.toHaveTextContent("Pre-specified ability-control check.");
    expect(section.querySelector(".within-topic-verdict")).not.toBeInTheDocument();
  }, 25_000);

  it("preserves the focal while changing metric, outcome, method, scope, topic gap, and support", async () => {
    const rendered = render(createElement(FocalWithinTopicComplementarity, { selectedConfiguration: focal }));
    const section = rendered.container.querySelector("#within-topic-complementarity") as HTMLElement;
    await waitFor(() => expect(valueFor(section, "ELIGIBLE PARTNERS")).toHaveTextContent("42"), { timeout: 15_000 });
    fireEvent.click(within(section).getByRole("button", { name: "Adjusted POG" }));
    fireEvent.click(within(section).getByRole("button", { name: "Whole-test gain" }));
    fireEvent.change(within(section).getByLabelText("Within-topic aggregation method"), { target: { value: "ec_w0_56" } });
    fireEvent.change(within(section).getByLabelText("Within-topic partner scope"), { target: { value: "matched_conditions" } });
    fireEvent.change(within(section).getByLabelText("Within-topic train BI gap"), { target: { value: "2" } });
    fireEvent.change(within(section).getByLabelText("Within-topic train event support"), { target: { value: "20" } });
    expect(section.querySelector(".within-topic-inspector")).toHaveAttribute("data-focal-configuration", focal);
    expect(valueFor(section, "ELIGIBLE PARTNERS").querySelector("dd")?.textContent).not.toBe("0");
    expect(within(section).getByRole("img")).toHaveAccessibleName(/Adjusted POG versus held-out aggregation gain in Finance/);
    expect(section).toHaveTextContent("EC · w = 0.56");
  }, 25_000);
});
