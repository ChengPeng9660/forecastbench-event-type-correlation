import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocalGainScatter, pearson, spearman } from "../src/components/FocalGainScatter";
import { PairAggregationExplorer } from "../src/components/PairAggregationExplorer";
import { PolymarketAggregationExplorer } from "../src/components/PolymarketAggregationExplorer";
import { FreezeMarketCorrelationExplorer, pearsonCorrelation, spearmanCorrelation } from "../src/components/FreezeMarketCorrelationExplorer";
import { FixedFocalWithoutFreezeExplorer } from "../src/components/FixedFocalWithoutFreezeExplorer";
import { WithoutFreezeBaseExplorer } from "../src/components/WithoutFreezeBaseExplorer";
import type { FocalGainData, PairAggregationData, PolymarketAggregationData, FreezeMarketCorrelationData, FixedFocalWithoutFreezeData, FixedBaseAggregationData } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const read = <T,>(path: string): T => JSON.parse(readFileSync(join(dataRoot, path), "utf8")) as T;

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

function selectLift(role: "tab" | "button" = "tab") {
  fireEvent.click(screen.getByRole(role, { name: /high-loss lift/i }));
}

function assertFinitePlot(selector: string, count: number) {
  const marks = document.querySelectorAll(selector);
  expect(marks).toHaveLength(count);
  for (const mark of marks) {
    for (const attribute of ["cx", "cy", "transform"]) {
      const value = mark.getAttribute(attribute);
      if (value !== null) expect(value).not.toMatch(/NaN|Infinity/);
    }
  }
  expect(document.querySelector('svg[data-x-scale="signed-log"]')).toBeInTheDocument();
}

describe("legacy high-loss scatter display preserves the raw statistic", () => {
  it("uses guarded raw correlations through the legacy exported helpers", () => {
    for (const correlation of [pearson, spearman, pearsonCorrelation, spearmanCorrelation]) {
      expect(correlation([0.1, 0.1, 0.1], [0, 1, 2])).toBeNull();
      expect(correlation([0, 1, Number.NaN], [0, 1, 2])).toBeNull();
      expect(correlation([0, 1, 2], [2, 1, 0])).toBeCloseTo(-1, 12);
    }
  });

  it("keeps extreme focal coordinates and raw r while hiding null points and the nonlinear fit line", () => {
    const data = read<FocalGainData>("focal-gain/gpt-4-1-2025-04-14.json");
    const xs = [-100, 0, 1, null];
    const ys = [0.1, 0.2, 0.4, 0.8];
    data.points = data.points.slice(0, 4).map((point, i) => ({ ...point, gain_fraction: ys[i], metrics: {
      ...point.metrics, high_loss_lift: { raw: xs[i] === null ? null : 1 - xs[i]!, complementarity: xs[i] },
    } }));
    render(createElement(FocalGainScatter, { data }));
    selectLift();
    assertFinitePlot(".gain-point circle", 3);
    expect(screen.getByRole("note", { name: "High-loss metric diagnostics" })).toHaveTextContent("1 / 4");
    expect(document.querySelector(".gain-fit-line")).not.toBeInTheDocument();
    const circles = [...document.querySelectorAll(".gain-point circle")];
    const signedLog = (x: number) => Math.sign(x) * Math.log1p(Math.abs(x));
    for (const [i, x] of [-100, 0, 1].entries()) {
      const expected = 86 + (signedLog(x) - signedLog(-100)) / (signedLog(1) - signedLog(-100)) * (920 - 86 - 28);
      expect(Number(circles[i].getAttribute("cx"))).toBeCloseTo(expected, 10);
    }
    expect(document.querySelector(".focal-gain-chart")?.textContent).toContain("101.0000");
    const expectedR = pearson([-100, 0, 1], ys.slice(0, 3))!;
    expect(screen.getByText("PEARSON r").parentElement?.querySelector("dd")?.textContent).toBe(expectedR.toFixed(2));
    expect(data.points[0].metrics.high_loss_lift.complementarity).toBe(-100);
    expect(data.points[3].metrics.high_loss_lift.complementarity).toBeNull();
  });

  it("keeps an all-missing focal sample finite and explicit", () => {
    const data = read<FocalGainData>("focal-gain/gpt-4-1-2025-04-14.json");
    data.points = data.points.slice(0, 2).map((point) => ({ ...point, metrics: {
      ...point.metrics, high_loss_lift: { raw: null, complementarity: null },
    } }));
    render(createElement(FocalGainScatter, { data }));
    selectLift();
    assertFinitePlot(".gain-point circle", 0);
    expect(screen.getByText("no defined pairs")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("2 / 2");
    expect(document.querySelector(".focal-gain-section")?.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("does not discard low-direction pairs but suppresses the fragile pair-level coefficient", () => {
    const data = read<PairAggregationData>("pair-aggregation/all-six-family-pairs.json");
    const focal = data.cross_fit.eligible_points[0].model_a;
    window.history.replaceState(null, "", `/?gain_model=${encodeURIComponent(focal)}`);
    const xs = [-99, 0, 1, null];
    data.cross_fit.eligible_points = data.cross_fit.eligible_points.filter((p) => p.model_a === focal || p.model_b === focal).slice(0, 4).map((p, i) => ({
      ...p, metrics: { ...p.metrics, high_loss_lift: { raw: xs[i] === null ? null : 1 - xs[i]!, complementarity: xs[i] } },
      cross_fit: { ...p.cross_fit!, included_fold_count: i === 0 ? 3 : 20 },
    }));
    render(createElement(PairAggregationExplorer, { data, nearBiOnly: false, onNearBiOnlyChange: vi.fn() }));
    selectLift();
    assertFinitePlot(".aggregation-point circle", 3);
    expect(screen.getByRole("note")).toHaveTextContent("fewer than half");
    expect(screen.getByText("DIVERSITY–BI r").parentElement?.querySelector("dd")?.textContent).toBe("—");
  });

  it("retains the zero-joint boundary and suppresses two-distinct-value Polymarket r", () => {
    const data = read<PolymarketAggregationData>("polymarket-aggregation/freeze-baseline.json");
    const xs = [-99, 1, 1, Number.NaN];
    data.cross_fit.eligible_points = data.cross_fit.eligible_points.slice(0, 4).map((p, i) => ({
      ...p, metrics: { ...p.metrics, high_loss_lift: { raw: 1 - xs[i], complementarity: xs[i] } },
    }));
    const rendered = render(createElement(PolymarketAggregationExplorer, { data }));
    selectLift();
    assertFinitePlot(".polymarket-point circle", 3);
    expect(screen.getByRole("note")).toHaveTextContent("only 2 distinct high-loss values");
    expect(screen.getByRole("note")).toHaveTextContent("2 displayed points have this value");
    expect(screen.getByText("DIVERSITY–BI r").parentElement?.querySelector("dd")?.textContent).toBe("—");
    const allMissing = { ...data, cross_fit: { ...data.cross_fit, eligible_points: data.cross_fit.eligible_points.map((p) => ({
      ...p, metrics: { ...p.metrics, high_loss_lift: { raw: null, complementarity: null } },
    })) } };
    rendered.rerender(createElement(PolymarketAggregationExplorer, { data: allMissing }));
    expect(screen.getByText("No defined chart coordinates for the selected Polymarket–model pairs.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("4 / 4");
  });

  it("shows one defined with-freeze market point without fabricating a correlation", () => {
    const data = read<FreezeMarketCorrelationData>("polymarket-aggregation/freeze-exposed-correlation.json");
    data.points = data.points.slice(0, 2).map((p, i) => ({ ...p,
      high_loss_diagnostics: { min_high_count_a: i ? 0 : 2, min_high_count_b: 8 },
      train_diversity: { ...p.train_diversity, high_loss_lift: i ? null : 1 },
    }));
    render(createElement(FreezeMarketCorrelationExplorer, { data }));
    selectLift("button");
    assertFinitePlot(".freeze-diversity-point", 1);
    expect(screen.getByRole("note")).toHaveTextContent("fewer than three displayed pairs");
    expect(screen.getByRole("note")).toHaveTextContent("1 / 2");
    expect(screen.getByRole("note")).toHaveTextContent("2 candidate pairs have fewer than 5 high-loss records");
  });

  it("shows one defined fixed-focal partner and reports missingness", () => {
    const data = read<FixedFocalWithoutFreezeData>("pair-aggregation/fixed-focal-without-freeze.json");
    const base = data.points[0].base_model;
    data.points = data.points.filter((p) => p.base_model === base).slice(0, 2).map((p, i) => ({ ...p, combined: {
      ...p.combined, train_diversity: { ...p.combined.train_diversity, high_loss_lift: i ? null : 1 },
    } }));
    render(createElement(FixedFocalWithoutFreezeExplorer, { data }));
    selectLift("button");
    assertFinitePlot(".freeze-diversity-point", 1);
    expect(screen.getByRole("note")).toHaveTextContent("1 / 2");
  });

  it("shows one defined without-freeze base point and reports missingness", () => {
    const data = read<FixedBaseAggregationData>("polymarket-aggregation/without-freeze-base.json");
    data.points = data.points.slice(0, 2).map((p, i) => ({ ...p, combined: {
      ...p.combined, train_diversity: { ...p.combined.train_diversity, high_loss_lift: i ? null : 1 },
    } }));
    render(createElement(WithoutFreezeBaseExplorer, { data }));
    selectLift("button");
    assertFinitePlot(".freeze-diversity-point", 1);
    expect(screen.getByRole("note")).toHaveTextContent("1 / 2");
  });
});
