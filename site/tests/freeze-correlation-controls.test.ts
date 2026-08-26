import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FreezeMarketCorrelationExplorer,
  sortFreezeCorrelationPoints,
  summarizeFreezeCorrelationPoints,
} from "../src/components/FreezeMarketCorrelationExplorer";
import type { FreezeMarketCorrelationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "polymarket-aggregation", "freeze-exposed-correlation.json"), "utf8"),
) as FreezeMarketCorrelationData;

afterEach(cleanup);

describe("with-freeze model/market correlation explorer", () => {
  it("renders audited headline values and a compact top-12 ranking", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    expect(screen.getByRole("heading", { name: "How closely do models track the market snapshot?" })).toBeInTheDocument();
    expect(screen.getByText(/news-augmented configurations are excluded/i)).toBeInTheDocument();
    expect(screen.getByText("0.902")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show all 39" })).toBeInTheDocument();
    expect(screen.getByText(/Correlation measures similarity/)).toBeInTheDocument();
  });

  it("shows every row on demand and filters to one provider", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    fireEvent.click(screen.getByRole("button", { name: "Show all 39" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(39);

    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(10);
    expect(screen.getByText("10", { selector: ".freeze-correlation-kpis strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Scratchpad" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(3);
  });

  it("sorts by common support and updates the selected-model ledger", () => {
    render(createElement(FreezeMarketCorrelationExplorer, { data: payload }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort freeze correlation models" }), { target: { value: "support" } });
    const rows = screen.getAllByRole("button", { name: /^Inspect / });
    expect(rows[0]).toHaveAccessibleName(/Claude-3-5-Sonnet-20240620/);
    fireEvent.click(rows[1]);
    expect(screen.getByRole("heading", { name: "Claude-3-7-Sonnet-20250219" })).toBeInTheDocument();
  });

  it("exports stable helpers for sorting and filtered weighted summaries", () => {
    expect(sortFreezeCorrelationPoints(payload.points, "support")[0].n_common).toBe(769);
    const openAi = payload.points.filter((point) => point.provider === "OpenAI");
    const summary = summarizeFreezeCorrelationPoints(openAi);
    expect(summary.models).toBe(7);
    expect(summary.configurations).toBe(10);
    expect(summary.support).toBe(openAi.reduce((sum, point) => sum + point.n_common, 0));
    expect(summary.correlation).toBeGreaterThan(0.8);
  });
});
