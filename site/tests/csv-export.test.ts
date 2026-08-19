import { describe, expect, it } from "vitest";
import { pairCsvRows } from "../src/App";
import type { AppData, EventTypeData, PairMetrics } from "../src/types/data";

describe("pair CSV dependence semantics", () => {
  it("publishes the dependence direction beside every raw metric", () => {
    const metrics = [
      { id: "adjusted_pog", label: "POG" },
      { id: "high_loss_lift", label: "Lift" },
      { id: "adjusted_loss_corr", label: "Correlation" },
    ];
    const appData = {
      manifest: {
        metrics,
        event_types: [{ id: "finance", dimension: "topic" }],
      },
      models: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    } as unknown as AppData;
    const eventData = {
      event_type: { id: "finance" },
      scope: { origin_type: "all", source: "all" },
      sample: { date_min: "2025-01-01", date_max: "2025-01-02" },
    } as unknown as EventTypeData;
    const pair = {
      a: "a", b: "b", row_id: "pair", n_overlap: 100, n_dates: 2,
      metrics: {
        adjusted_pog: { value: 0.1 },
        high_loss_lift: { value: 1.2 },
        adjusted_loss_corr: { value: 0.3 },
      },
      diagnostics: { mean_bi_gap: 1, near_bi: true },
    } as unknown as PairMetrics;

    const [header, row] = pairCsvRows([pair], appData, eventData);
    expect(header).toContain("adjusted_pog_dependence_direction");
    expect(header).toContain("high_loss_lift_dependence_direction");
    expect(header).toContain("adjusted_loss_corr_dependence_direction");
    expect(row[header.indexOf("adjusted_pog_dependence_direction")]).toBe("lower=higher_model_dependence");
    expect(row[header.indexOf("high_loss_lift_dependence_direction")]).toBe("higher=higher_model_dependence");
    expect(row[header.indexOf("adjusted_loss_corr_dependence_direction")]).toBe("higher=higher_model_dependence");
  });
});
