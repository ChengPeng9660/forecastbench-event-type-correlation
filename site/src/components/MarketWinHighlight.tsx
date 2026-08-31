import { matchedMarketLabel, type MatchedMarketComparison } from "../lib/matchedMarketComparison";
import type { MarketPerformanceOutcomeId } from "../types/data";
import "../marketWinHighlight.css";

export function MarketWinBadge({ floating = true }: { floating?: boolean }) {
  return <g className="market-win-badge" transform={floating ? "translate(8 -8)" : undefined} aria-hidden="true">
    <circle r={5.2} />
    <path d="M -2.6 0 L -0.8 1.8 L 2.8 -2" />
  </g>;
}

export function MarketWinToggle({ checked, onChange, scope, outcome }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  scope: string;
  outcome: MarketPerformanceOutcomeId;
}) {
  return <div className="market-win-controls">
    <label className="market-win-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={`${scope}: highlight market wins`} />
      <span>Highlight market wins</span>
      {checked && <svg viewBox="-6 -6 12 12" width="17" height="17" aria-hidden="true"><MarketWinBadge floating={false} /></svg>}
    </label>
    <span className="market-win-key">{outcome === "brier_index" ? "Higher BI" : "Lower Raw Brier"} than each point’s own matched market · point estimates</span>
  </div>;
}

export function MarketWinVerdict({ comparison, outcome }: {
  comparison: MatchedMarketComparison;
  outcome: MarketPerformanceOutcomeId;
}) {
  return <p className="market-win-verdict" data-market-comparison={comparison}>
    <strong>{matchedMarketLabel[comparison]}</strong>
    <span>{outcome === "brier_index" ? "Brier Index ↑" : "Raw Brier ↓"} · same events</span>
  </p>;
}
