import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FixedFocalWithoutFreezeExplorer,
  fixedFocalOutcomeValue,
  summarizeFixedFocalPoints,
} from "../src/components/FixedFocalWithoutFreezeExplorer";
import type { FixedFocalWithoutFreezeData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "pair-aggregation", "fixed-focal-without-freeze.json"), "utf8"),
) as FixedFocalWithoutFreezeData;

afterEach(cleanup);

describe("fixed-focal without-freeze explorer", () => {
  it("keeps one selected base while changing partners", () => {
    render(createElement(FixedFocalWithoutFreezeExplorer, { data: payload }));
    expect(screen.getByRole("heading", { name: "Which partner improves a fixed focal model?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Without-freeze base model")).toHaveValue("GPT-5-2025-08-07");
    expect(screen.getByRole("img", { name: /Adjusted POG versus fraction gain versus fixed focal base/i })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Fixed focal diversity summary")).getByText("16")).toBeInTheDocument();
  });

  it("switches base, partner family, fold, metric, outcome, method, and Near-BI", () => {
    render(createElement(FixedFocalWithoutFreezeExplorer, { data: payload }));
    fireEvent.change(screen.getByLabelText("Without-freeze base model"), { target: { value: "Claude-3-7-Sonnet-20250219" } });
    fireEvent.click(screen.getByRole("button", { name: "GPT" }));
    expect(screen.getByText("GPT partners")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "A→B" }));
    expect(screen.getByText("10 repeated A→B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "High-loss Lift" }));
    fireEvent.click(screen.getByRole("button", { name: "Aggregation BI" }));
    expect(screen.getByRole("img", { name: /High-loss Lift versus aggregation Brier Index/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("row", { name: /Use EC · w = 0.56 for fixed focal analysis/i }));
    expect(within(screen.getByLabelText("Fixed focal diversity summary")).getByText("EC · w = 0.56")).toBeInTheDocument();
    const before = screen.getByText("FOCAL PARTNERS").parentElement?.querySelector("dd")?.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Near-BI" }));
    const after = screen.getByText("FOCAL PARTNERS").parentElement?.querySelector("dd")?.textContent;
    expect(after).not.toBe(before);
  });

  it("derives values from the selected ordered fold view", () => {
    const focal = payload.points.filter((point) => point.base_model === "GPT-5-2025-08-07");
    const combined = summarizeFixedFocalPoints(focal, "combined", "cf_directional");
    const aToB = summarizeFixedFocalPoints(focal, "a_to_b", "cf_directional");
    const bToA = summarizeFixedFocalPoints(focal, "b_to_a", "cf_directional");
    expect(aToB.support + bToA.support).toBe(combined.support);
    expect(fixedFocalOutcomeValue(focal[0], "b_to_a", "cf_directional", "gain_vs_base"))
      .toBe(focal[0].directions.b_to_a.aggregation.cf_directional.gain_vs_base);
  });
});
