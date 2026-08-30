import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import marketPayload from "../public/data/polymarket-aggregation/market-diversity-performance.json";
import upperLeftPayload from "../public/data/pair-aggregation/upper-left-model-pairs.json";
import { MarketDiversityPerformanceExplorer } from "../src/components/MarketDiversityPerformanceExplorer";
import { MarketConfigurationAggregationExplorer } from "../src/components/MarketConfigurationAggregationExplorer";
import { UpperLeftModelPairAggregationExplorer } from "../src/components/UpperLeftModelPairAggregationExplorer";
import { highLossAxis, rawPearson } from "../src/lib/highLoss";
import type { MarketDiversityPerformanceData, UpperLeftModelPairAggregationData } from "../src/types/data";
import { configurations, manifest, shard, view } from "./fixtures/configuration-pair";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const kpi = (element: HTMLElement, label: string) => within(element).getByText(label, { exact: true }).parentElement?.querySelector("dd");
const xCoordinate = (element: Element) => Number(element.getAttribute("transform")?.match(/translate\(([^ ]+)/)?.[1]);

function marketFixture(values: Array<number | null>): MarketDiversityPerformanceData {
  const data = marketPayload as unknown as MarketDiversityPerformanceData;
  return { ...data, points: data.points.slice(0, values.length).map((point, index) => ({
    ...point, diversity: { ...point.diversity, high_loss_lift: values[index] },
    model: { ...point.model, raw_brier: [0.1, 0.2, 0.4, 0.3][index] },
  })) };
}

function configurationFixture(values: Array<number | null>) {
  const payload = shard();
  payload.partners.forEach((partner, index) => {
    const combined = view({
      train_diversity: { ...view().train_diversity, high_loss_lift: values[index] },
      base: { ...view().base, brier_index: 82.12 },
      partner: { ...view().partner, brier_index: 70.63 },
      methods: { ...view().methods, simple_mean: { ...view().methods.simple_mean, brier_index: 80 + index } },
      high_loss_diagnostics: { included_fold_count: 20, defined_fold_count: values[index] === null ? 19 : 20,
        undefined_fold_count: values[index] === null ? 1 : 0, min_high_count_a: 1, min_high_count_b: 3, min_joint_high_count: 0 },
    });
    const near = view({ ...combined, train_bi_gap: 1.25, fold_count: index + 1,
      fold_ids: Array.from({ length: index + 1 }, (_, i) => String(i)),
      high_loss_diagnostics: { ...combined.high_loss_diagnostics, included_fold_count: index + 1,
        defined_fold_count: values[index] === null ? 0 : index + 1, undefined_fold_count: values[index] === null ? index + 1 : 0 } });
    partner.status = "eligible";
    partner.n_common = 150;
    partner.views.all.combined = combined;
    partner.views.near_bi.combined = near;
  });
  return payload;
}

function useConfigurationFixture(values: Array<number | null>) {
  const payload = configurationFixture(values);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(new Response(JSON.stringify(
    String(input).endsWith("manifest.json") ? manifest : payload,
  ), { status: 200 }))));
  return payload;
}

describe("high-loss presentation in market blocks", () => {
  it("keeps extreme raw values and zero-joint points while suppressing two-distinct-X associations", () => {
    const fixture = marketFixture([-35, 1, 1, null]);
    const before = JSON.stringify(fixture);
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: fixture }));
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    const block = container.querySelector("#market-performance") as HTMLElement;
    expect(block.querySelectorAll(".market-performance-hit")).toHaveLength(3);
    expect(block.querySelector(".market-performance-hit title")).toHaveTextContent("High-loss diversity: -35.00");
    expect(xCoordinate(block.querySelector(".market-performance-hit")!)).toBeCloseTo(highLossAxis([-35, 1, 1], [88, 1046]).position(-35), 8);
    expect(kpi(block, "PEARSON r")).toHaveTextContent("—");
    expect(kpi(block, "SPEARMAN ρ")).toHaveTextContent("—");
    const notice = within(block).getByRole("note", { name: "High-loss metric diagnostics" });
    expect(notice).toHaveTextContent("1 / 4 candidates have an undefined high-loss coordinate");
    expect(notice).toHaveTextContent("only 2 distinct high-loss values");
    expect(notice).toHaveTextContent("not perfect complementarity");
    expect(block.querySelector(".market-performance-axis-label")).toHaveTextContent("signed-log display; raw ticks");
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("calculates reported high-loss correlations on raw coordinates, not signed-log positions", () => {
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: marketFixture([-35, 0, 1]) }));
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    const block = container.querySelector("#market-performance") as HTMLElement;
    expect(kpi(block, "PEARSON r")).toHaveTextContent(rawPearson([-35, 0, 1], [.1, .2, .4])!.toFixed(2));
    expect(kpi(block, "SPEARMAN ρ")).toHaveTextContent("1.00");
    expect(block).not.toHaveTextContent("Association not reported");
  });

  it("exposes training selection and test gap even outside the high-loss metric", async () => {
    useConfigurationFixture([-35, 0, 1]);
    const { container } = render(createElement(MarketConfigurationAggregationExplorer, { base: configurations[0] }));
    await screen.findByRole("img");
    fireEvent.change(screen.getByLabelText("Exact configuration train sample"), { target: { value: "near_bi" } });
    const block = container.querySelector("#configuration-pair-aggregation") as HTMLElement;
    expect(kpi(block, "RETAINED DIRECTIONS")).toHaveTextContent("1–3");
    expect(block).toHaveTextContent("Limited retained directions: 3 displayed pair(s)");
    expect(block).toHaveTextContent("it does not guarantee similar test BI");
    const inspector = block.querySelector(".configuration-pair-inspector") as HTMLElement;
    expect(kpi(inspector, "Train BI gap")).toHaveTextContent("1.25");
    expect(kpi(inspector, "Test BI gap")).toHaveTextContent("11.49");
    expect(kpi(inspector, "Retained training directions")).toHaveTextContent("1/20");
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    expect(block.querySelectorAll(".configuration-pair-point")).toHaveLength(3);
    expect(kpi(block, "PEARSON r")).toHaveTextContent("—");
    expect(within(block).getByRole("note")).toHaveTextContent("fewer than half of the attempted directions");
    expect(within(block).getByRole("note")).toHaveTextContent("Association not reported: at least one pair retains");
  });

  it("counts undefined exact-pair metrics without substituting X=1 or altering their scores", async () => {
    const fixture = useConfigurationFixture([-35, 1, null]);
    const before = JSON.stringify(fixture);
    const { container } = render(createElement(MarketConfigurationAggregationExplorer, { base: configurations[0] }));
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    const block = container.querySelector("#configuration-pair-aggregation") as HTMLElement;
    expect(block.querySelectorAll(".configuration-pair-point")).toHaveLength(2);
    expect(block.querySelector(".configuration-pair-point title")).toHaveTextContent("High-loss diversity: -35.000");
    expect(block.querySelector(".configuration-pair-point title")).toHaveTextContent("Aggregation BI: 80.00");
    const inspector = block.querySelector(".configuration-pair-inspector") as HTMLElement;
    expect(kpi(inspector, "Min marginal high-loss counts A / B")).toHaveTextContent("1 / 3");
    expect(kpi(inspector, "Min joint high-loss count")).toHaveTextContent("0");
    expect(kpi(inspector, "Defined high-loss directions")).toHaveTextContent("20 / 20");
    expect(within(block).getByRole("note")).toHaveTextContent("1 / 3 candidates have an undefined high-loss coordinate");
    expect(block).toHaveTextContent("1 view(s) have an undefined selected diversity metric; 0 have an undefined selected outcome");
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("separates missing outcomes from missing high-loss coordinates and retains raw zero", async () => {
    const fixture = useConfigurationFixture([0, 1, null]);
    fixture.partners[1].views.all.combined!.methods.simple_mean.brier_index = null;
    fixture.partners[1].views.all.combined!.methods.simple_mean.beats_market = false;
    const { container } = render(createElement(MarketConfigurationAggregationExplorer, { base: configurations[0] }));
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    const block = container.querySelector("#configuration-pair-aggregation") as HTMLElement;
    expect(block.querySelectorAll(".configuration-pair-point")).toHaveLength(1);
    expect(block.querySelector(".configuration-pair-point title")).toHaveTextContent("High-loss diversity: 0.000");
    expect(within(block).getByRole("note")).toHaveTextContent("1 / 3 candidates have an undefined high-loss coordinate");
    expect(block).toHaveTextContent("1 view(s) have an undefined selected diversity metric; 1 have an undefined selected outcome");
  });

  it("does not apply the high-loss association guard to other metrics", () => {
    const fixture = marketFixture([-35, 1]);
    fixture.points.forEach((point, index) => { point.diversity.prediction_diversity = index / 2; });
    const { container } = render(createElement(MarketDiversityPerformanceExplorer, { data: fixture }));
    const block = container.querySelector("#market-performance") as HTMLElement;
    expect(kpi(block, "PEARSON r")).toHaveTextContent("1.00");
    expect(within(block).queryByRole("note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "High-loss diversity" }));
    expect(kpi(block, "PEARSON r")).toHaveTextContent("—");
    expect(within(block).getByRole("note")).toHaveTextContent("fewer than three displayed pairs");
  });

  it("applies raw-tick signed-log spacing and explicit missingness to both upper-left blocks", () => {
    const source = upperLeftPayload as unknown as UpperLeftModelPairAggregationData;
    const models = source.fixed.models.slice(0, 4);
    const values = [-35, 1, null];
    const fixedRows = values.map((value, index) => ({ ...source.fixed.rows[0],
      pair_id: `fixed-${index}`, model_a: models[0].name, model_b: models[index + 1].name,
      method: "piecewise_odds" as const, diversity: { ...source.fixed.rows[0].diversity, high_loss_diversity: value },
    }));
    const crossfitRows = values.map((value, index) => ({ ...source.crossfit.rows[0],
      pair_id: `crossfit-${index}`, model_a: models[0].name, model_b: models[index + 1].name,
      method: "piecewise_odds" as const, evaluation_count: 20,
      mean_train_diversity: { ...source.crossfit.rows[0].mean_train_diversity, high_loss_diversity: value },
    }));
    const data = { ...source, fixed: { ...source.fixed, models, rows: fixedRows }, crossfit: { ...source.crossfit, models, rows: crossfitRows } };
    const before = JSON.stringify(data);
    const { container } = render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    for (const id of ["upper-left-fixed", "upper-left-crossfit"]) {
      const block = container.querySelector(`#${id}`) as HTMLElement;
      fireEvent.click(within(block).getByRole("button", { name: "High-loss diversity" }));
      expect(block.querySelectorAll(".upper-left-point-hit")).toHaveLength(2);
      expect(block.querySelector(".upper-left-point-hit title")).toHaveTextContent("High-loss diversity: -35.00");
      expect(xCoordinate(block.querySelector(".upper-left-point-hit")!)).toBeCloseTo(highLossAxis([-35, 1], [74, 946]).position(-35), 8);
      expect(within(block).getByRole("note")).toHaveTextContent("1 / 3 candidates have an undefined high-loss coordinate");
      expect(block.querySelector(".upper-left-axis-label")).toHaveTextContent("signed-log display; raw ticks");
    }
    expect(JSON.stringify(data)).toBe(before);
  });
});
