import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairAggregationExplorer } from "../src/components/PairAggregationExplorer";
import type { PairAggregationData, PairAggregationPoint, ModelFamily, PairGroupId } from "../src/types/data";

const dataRoot = resolve(process.env.SITE_DATA_ROOT ?? join(process.cwd(), "public/data"));
const payload = JSON.parse(
  readFileSync(join(dataRoot, "pair-aggregation", "all-six-family-pairs.json"), "utf8"),
) as PairAggregationData;

const FAMILY_COLORS: Record<ModelFamily, string> = {
  GPT: "#efab02",
  Claude: "#4f207f",
  Gemini: "#4285f4",
  Qwen: "#267c79",
  DeepSeek: "#c75b39",
  Kimi: "#1f2937",
};
const families = Object.keys(FAMILY_COLORS) as ModelFamily[];
const groups = families.flatMap((left, index) => families.slice(index).map((right) => ({
  group: `${left.toLowerCase()}_${right.toLowerCase()}` as PairGroupId,
  sameFamily: left === right,
})));
const representativeModels: Record<ModelFamily, string> = {
  GPT: "GPT-5-2025-08-07",
  Claude: "Claude-Haiku-4-5-20251001",
  Gemini: "Gemini-3-Pro-Preview",
  Qwen: "Qwen3-235B-A22B-Thinking-2507",
  DeepSeek: "DeepSeek-V3.1",
  Kimi: "Kimi-K2-Thinking",
};
const crossFitCases = (["combined", "a_to_b", "b_to_a"] as const)
  .flatMap((fold) => [false, true].map((nearBiOnly) => ({ fold, nearBiOnly })));

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(cleanup);

function isDefined(point: PairAggregationPoint) {
  return point.metrics.adjusted_pog.complementarity !== null
    && Number.isFinite(point.brier_index.ec_w0_56);
}

function chooseFocal(model: string) {
  fireEvent.change(screen.getByLabelText("Aggregation focal model"), { target: { value: model } });
}

function assertMarker(container: HTMLElement, point: PairAggregationPoint, focal: string) {
  const focalIsA = point.model_a === focal;
  const partner = focalIsA ? point.model_b : point.model_a;
  const focalFamily = focalIsA ? point.family_a : point.family_b;
  const partnerFamily = focalIsA ? point.family_b : point.family_a;
  const pairLabel = `${focal} × ${partner}`;
  const marker = [...container.querySelectorAll<SVGGElement>("g.aggregation-point")]
    .find((element) => element.getAttribute("aria-label")?.startsWith(`${pairLabel}, aggregation BI `));
  expect(marker, `Missing focal-first marker for ${pairLabel}`).toBeDefined();
  expect(marker!.querySelector("title")?.textContent).toMatch(`${pairLabel}\nFixed focal: ${focal}\n`);
  expect(marker!.querySelector("circle")?.style.fill).toBe(`url(#pair-fill-${point.pair_group})`);

  const gradient = container.querySelector(`#pair-fill-${point.pair_group}`);
  expect(gradient, `Missing gradient for ${point.pair_group}`).not.toBeNull();
  expect(gradient).toHaveAttribute("x1", "0%");
  expect(gradient).toHaveAttribute("y1", "0%");
  expect(gradient).toHaveAttribute("x2", "100%");
  expect(gradient).toHaveAttribute("y2", "0%");
  const stops = gradient!.querySelectorAll("stop");
  expect(stops).toHaveLength(2);
  expect(stops[0]).toHaveAttribute("offset", "50%");
  expect(stops[1]).toHaveAttribute("offset", "50%");
  expect(stops[0]).toHaveAttribute("stop-color", FAMILY_COLORS[focalFamily]);
  expect(stops[1]).toHaveAttribute("stop-color", FAMILY_COLORS[partnerFamily]);
  return marker!;
}

function assertSelectedLabel(marker: SVGGElement, point: PairAggregationPoint, focal: string) {
  fireEvent.click(marker);
  const partner = point.model_a === focal ? point.model_b : point.model_a;
  const shortName = (name: string) => name.replace(/-20\d{2}.*/, "");
  expect(marker.querySelector("text")?.textContent).toBe(`${shortName(focal)} × ${shortName(partner)}`);
}

describe("aggregation marker focal-left orientation", () => {
  it("retains all 15 cross-family and six same-family groups in the archived source data", () => {
    expect(groups).toHaveLength(21);
    expect(groups.filter((item) => !item.sameFamily)).toHaveLength(15);
    expect(groups.filter((item) => item.sameFamily)).toHaveLength(6);
    expect(new Set(payload.points.filter(isDefined).map((point) => point.pair_group)))
      .toEqual(new Set(groups.map((item) => item.group)));
  });

  it.each(groups.filter(({ group }) => payload.cross_fit.eligible_points.some((point) => point.pair_group === group && isDefined(point))))("keeps $group focal-left when either constituent is selected", ({ group }) => {
    const point = payload.cross_fit.eligible_points.find((item) => item.pair_group === group && isDefined(item));
    expect(point, `No real-data representative for ${group}`).toBeDefined();
    const pair = point!;
    window.history.replaceState(null, "", `/?gain_model=${encodeURIComponent(pair.model_a)}`);
    const { container } = render(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly: false,
      onNearBiOnlyChange: vi.fn(),
    }));

    expect(screen.getByLabelText("Aggregation focal model")).toHaveValue(pair.model_a);
    assertSelectedLabel(assertMarker(container, pair, pair.model_a), pair, pair.model_a);

    // Reverse the focal within the same mounted chart: stops and labels must update immediately.
    chooseFocal(pair.model_b);
    expect(screen.getByLabelText("Aggregation focal model")).toHaveValue(pair.model_b);
    assertSelectedLabel(assertMarker(container, pair, pair.model_b), pair, pair.model_b);
  });

  it.each(crossFitCases)("preserves focal-left in $fold with Near-BI=$nearBiOnly", ({ fold, nearBiOnly }) => {
    window.history.replaceState(null, "", `/?gain_fold=${fold}`);
    const onNearBiOnlyChange = vi.fn();
    const { container } = render(createElement(PairAggregationExplorer, {
      data: payload,
      nearBiOnly,
      onNearBiOnlyChange,
    }));
    const view = fold === "combined" ? payload.cross_fit : payload.cross_fit.directional_points[fold];
    const source = nearBiOnly ? view.near_bi_points : view.eligible_points;

    for (const focal of Object.values(representativeModels)) {
      chooseFocal(focal);
      const expected = source.filter((point) => (point.model_a === focal || point.model_b === focal) && isDefined(point));
      expect(expected.length, `No ${fold} Near-BI=${nearBiOnly} support for ${focal}`).toBeGreaterThan(0);
      expect(container.querySelectorAll("g.aggregation-point")).toHaveLength(expected.length);
      for (const point of expected) assertMarker(container, point, focal);
      assertSelectedLabel(assertMarker(container, expected[0], focal), expected[0], focal);
    }

    // Every representative has real Near-BI support, so no implicit sample reset should occur.
    expect(onNearBiOnlyChange).not.toHaveBeenCalled();
  });
});
