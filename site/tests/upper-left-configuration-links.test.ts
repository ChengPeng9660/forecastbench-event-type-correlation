import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import payload from "../public/data/pair-aggregation/upper-left-model-pairs.json";
import { UpperLeftModelPairAggregationExplorer } from "../src/components/UpperLeftModelPairAggregationExplorer";
import type { UpperLeftModelPairAggregationData } from "../src/types/data";

const data = payload as UpperLeftModelPairAggregationData;
const grok = data.fixed.models.find((model) => model.name.startsWith("Grok-4-Fast-Reasoning") && model.information_type === "freeze_values")!;

function visit(base: string, view = "crossfit") {
  const params = new URLSearchParams({ upper_left_base: base, upper_left_view: view, metric: "total_variation" });
  window.history.replaceState(null, "", `/?${params}#upper-left-pairs`);
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("existing upper-left exact-configuration links", () => {
  it("selects the linked Grok information and prompt configuration in both existing blocks", () => {
    visit(grok.name);
    const { container } = render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    expect(screen.getByLabelText(`${data.fixed.title} focal model`)).toHaveValue(grok.name);
    expect(screen.getByLabelText(`${data.crossfit.title} focal model`)).toHaveValue(grok.name);
    expect(screen.getByLabelText(`${data.fixed.title} focal model`).querySelector("option:checked")?.textContent).toContain(grok.information_label);
    expect(container.querySelector("#upper-left-fixed .upper-left-point-hit")).toBeInTheDocument();
    expect(container.querySelector("#upper-left-crossfit .upper-left-point-hit")).toBeInTheDocument();
  });

  it("does not replace a configuration that only exists in the other block", () => {
    const onlyCrossfit = data.crossfit.models.find((model) => !data.fixed.models.some((fixed) => fixed.name === model.name))!;
    visit(onlyCrossfit.name);
    const { container } = render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    expect(screen.getByLabelText(`${data.fixed.title} focal model`)).toHaveValue(onlyCrossfit.name);
    expect(container.querySelector("#upper-left-fixed .upper-left-point-hit")).not.toBeInTheDocument();
    expect(container.querySelector("#upper-left-fixed")).toHaveTextContent("no other configuration has been substituted");
    expect(screen.getByLabelText(`${data.crossfit.title} focal model`)).toHaveValue(onlyCrossfit.name);
  });

  it("restores exact linked bases through history without resetting metric controls", () => {
    visit(grok.name);
    const { container } = render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    const fixedBlock = container.querySelector("#upper-left-fixed") as HTMLElement;
    fireEvent.click(within(fixedBlock).getByRole("button", { name: "Total variation (TV)" }));
    const other = data.fixed.models.find((model) => model.name !== grok.name)!;
    visit(other.name, "fixed");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByLabelText(`${data.fixed.title} focal model`)).toHaveValue(other.name);
    expect(screen.getByLabelText(`${data.crossfit.title} focal model`)).toHaveValue(other.name);
    expect(within(fixedBlock).getByRole("button", { name: "Total variation (TV)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("writes the full exact focal key while preserving unrelated URL filters", () => {
    visit(grok.name);
    render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    const other = data.fixed.models.find((model) => model.name !== grok.name)!;
    fireEvent.change(screen.getByLabelText(`${data.fixed.title} focal model`), { target: { value: other.name } });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("upper_left_base")).toBe(other.name);
    expect(params.get("upper_left_view")).toBe("fixed");
    expect(params.get("metric")).toBe("total_variation");
  });

  it("keeps the ordinary page's minimum at ten directions", () => {
    window.history.replaceState(null, "", "/#upper-left-pairs");
    render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    expect(screen.getByLabelText("Minimum OOS directions")).toHaveValue("10");
  });

  it("opens sparse published results with an explicit one-direction URL preset", () => {
    const sparse = "Grok-4-Fast-Non-Reasoning (zero shot with freeze values)";
    visit(sparse);
    const params = new URLSearchParams(window.location.search);
    params.set("upper_left_min_directions", "1");
    window.history.replaceState(null, "", `/?${params}#upper-left-pairs`);
    const { container } = render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    expect(screen.getByLabelText("Minimum OOS directions")).toHaveValue("1");
    expect(container.querySelector("#upper-left-crossfit .upper-left-point-hit")).toBeInTheDocument();
    expect(container.querySelector("#upper-left-crossfit")).toHaveTextContent("not every pair appears in all 20");
    fireEvent.change(screen.getByLabelText("Minimum OOS directions"), { target: { value: "5" } });
    expect(new URLSearchParams(window.location.search).get("upper_left_min_directions")).toBe("5");
    params.set("upper_left_min_directions", "1");
    window.history.replaceState(null, "", `/?${params}#upper-left-pairs`);
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByLabelText("Minimum OOS directions")).toHaveValue("1");
  });

  it("ignores unsupported minimum-direction presets", () => {
    visit(grok.name);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}&upper_left_min_directions=999#upper-left-pairs`);
    render(createElement(UpperLeftModelPairAggregationExplorer, { data }));
    expect(screen.getByLabelText("Minimum OOS directions")).toHaveValue("10");
  });
});
