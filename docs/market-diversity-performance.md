# Market diversity versus forecasting performance

Generated: 2026-08-27

## Research question

Across every eligible exact ForecastBench LLM configuration, how does model–market
diversity relate to the model's own forecasting performance? The visualization
keeps model version, information condition, and prompt condition separate.

## Sample

- Raw scored panel: `data/build/scored_panel.csv`
- Market probability: `data/build/event_taxonomy.csv::market_prob`, the audited
  rename of ForecastBench `freeze_datetime_value`
- Join: forecast due date, lowercase `source=polymarket`, event ID, and horizon
- Imputation rule: a scored market row is removed only when every backing
  ForecastBench source forecast is marked `imputed=true`
- Minimum common non-imputed market support: 50 target rows
- Raw exact configurations: 259 across 69 canonical model versions
- Eligible configurations: 238 across 67 canonical model versions
- Eligible model–market target cells: 47,557

The moving `GPT-4o` alias is pinned to `GPT-4o-2024-05-13`. Information and
prompt conditions are not merged. The eligible payload contains 104 no-extra-
information, 106 freeze-value, 13 news, 11 news-plus-freeze, 2 web-search, and
2 web-search-plus-freeze configurations. Prompt counts are 125 zero-shot, 112
scratchpad, and 1 unspecified.

## Axes

The x axis can display:

1. Prediction diversity: `1 - Pearson(model probability, market probability)`
2. Adjusted pairwise oracle gain
3. High-loss diversity: `1 - adjusted high-loss lift`
4. Adjusted-loss diversity: negative adjusted-loss Pearson correlation

All x-axis orientations use larger values for greater model–market diversity.

The y axis can display:

1. Raw Brier Score (lower is better)
2. Brier Index `(1 - sqrt(adjusted Brier)) * 100` (higher is better)

Every point's model and market scores use that point's exact common support. The
gold dashed line is the support-weighted mean of the selected configurations'
matched-market scores and is recomputed after any provider, prompt, or
information filter. The selected-point inspector also reports the exact matched
market score because coverage differs across configurations.

## Encoding and interpretation

- Color encodes information condition.
- Shape encodes prompt: circle for zero-shot, diamond for scratchpad, and triangle
  for an unspecified prompt.
- Pearson and Spearman statistics are unweighted configuration-level descriptive
  associations between the selected x and y variables.

The correlations are not causal estimates. In particular, information and prompt
conditions were not randomly assigned across otherwise identical model histories,
and model configurations cover different dates and events. The matched market
score controls the scoring support comparison but not model selection or temporal
confounding.

## Artifacts

- Analysis: `analysis/market_diversity_performance.py`
- Site payload: `site/public/data/polymarket-aggregation/market-diversity-performance.json`
- Component: `site/src/components/MarketDiversityPerformanceExplorer.tsx`
- Static verified preview: `/Users/pcc/Documents/Codex/2026-08-19/zha/outputs/market-diversity-performance.png`
