import type { MarketPerformanceOutcomeId } from "../types/data";

export type MatchedMarketComparison = "above" | "below" | "tie" | "unavailable";
type Scores = Partial<Record<MarketPerformanceOutcomeId, number | null>>;

/** Compare the selected score on the configuration's own matched support. */
export function compareMatchedMarket(
  model: Scores | null | undefined,
  market: Scores | null | undefined,
  outcome: MarketPerformanceOutcomeId,
): MatchedMarketComparison {
  const value = model?.[outcome];
  const reference = market?.[outcome];
  if (typeof value !== "number" || typeof reference !== "number"
    || !Number.isFinite(value) || !Number.isFinite(reference)) return "unavailable";
  const gain = outcome === "brier_index" ? value - reference : reference - value;
  if (Math.abs(gain) <= 1e-12) return "tie";
  return gain > 0 ? "above" : "below";
}

export const matchedMarketLabel: Record<MatchedMarketComparison, string> = {
  above: "Beats matched market",
  below: "Below matched market",
  tie: "Ties matched market",
  unavailable: "Market comparison unavailable",
};

export function matchedMarketWinSummary(comparisons: MatchedMarketComparison[]) {
  const wins = comparisons.filter((value) => value === "above").length;
  const total = comparisons.filter((value) => value !== "unavailable").length;
  return { wins, total, rate: total ? `${(100 * wins / total).toFixed(1)}%` : "—" };
}
