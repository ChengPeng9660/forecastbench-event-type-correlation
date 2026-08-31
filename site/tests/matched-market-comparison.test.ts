import { describe, expect, it } from "vitest";
import { compareMatchedMarket, matchedMarketWinSummary } from "../src/lib/matchedMarketComparison";

describe("point-specific matched-market comparisons", () => {
  const model = { brier_index: 80.4, raw_brier: 0.021 };
  const market = { brier_index: 81.2, raw_brier: 0.019 };

  it("compares against the point's own market, not an overall reference", () => {
    expect(compareMatchedMarket(model, market, "brier_index")).toBe("below");
    expect(compareMatchedMarket(model, market, "raw_brier")).toBe("below");
    expect(compareMatchedMarket({ brier_index: 65 }, { brier_index: 64 }, "brier_index")).toBe("above");
  });

  it("uses higher BI but lower Raw Brier, without assuming their rankings agree", () => {
    const mixed = { brier_index: 82, raw_brier: 0.03 };
    expect(compareMatchedMarket(mixed, market, "brier_index")).toBe("above");
    expect(compareMatchedMarket(mixed, market, "raw_brier")).toBe("below");
    expect(compareMatchedMarket({ raw_brier: 0 }, market, "raw_brier")).toBe("above");
  });

  it("does not count ties or numerical noise as wins", () => {
    expect(compareMatchedMarket(market, market, "brier_index")).toBe("tie");
    expect(compareMatchedMarket({ raw_brier: market.raw_brier - 5e-13 }, market, "raw_brier")).toBe("tie");
    expect(compareMatchedMarket({ brier_index: market.brier_index + 5e-13 }, market, "brier_index")).toBe("tie");
    expect(compareMatchedMarket({ raw_brier: market.raw_brier - 1e-10 }, market, "raw_brier")).toBe("above");
  });

  it("leaves missing and non-finite references unavailable", () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(compareMatchedMarket({ brier_index: value }, market, "brier_index")).toBe("unavailable");
      expect(compareMatchedMarket(model, { raw_brier: value }, "raw_brier")).toBe("unavailable");
    }
    expect(compareMatchedMarket(null, market, "brier_index")).toBe("unavailable");
    expect(compareMatchedMarket(model, undefined, "raw_brier")).toBe("unavailable");
  });

  it("counts configurations equally and excludes unavailable comparisons from the denominator", () => {
    expect(matchedMarketWinSummary(["above", "below", "tie", "unavailable"])).toEqual({ wins: 1, total: 3, rate: "33.3%" });
    expect(matchedMarketWinSummary([])).toEqual({ wins: 0, total: 0, rate: "—" });
    expect(matchedMarketWinSummary(["unavailable"])).toEqual({ wins: 0, total: 0, rate: "—" });
  });
});
