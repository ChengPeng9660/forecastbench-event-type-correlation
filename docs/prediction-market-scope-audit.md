# Prediction-market experiment scope audit

Audit date: 2026-08-27

## Required evaluation population

Every website block that measures a model or aggregation method against the
prediction market must evaluate only rows satisfying all of the following:

1. `source` is `Polymarket` (case-insensitive);
2. the exact `(forecast_due_date, source, event_id)` has a valid
   `freeze_datetime_value`, exposed downstream as `market_prob`;
3. model forecasts backed only by ForecastBench source rows marked
   `imputed=true` are excluded;
4. whenever an aggregation pair is compared with the market, aggregation BI and
   market BI use the identical pair-specific evaluation keys.

Dataset questions are not eligible for these comparisons, even if a Dataset
question happens to share a date or event identifier with a market question.

## Website block inventory

| Block | Market comparison | Required support | Audit result |
| --- | --- | --- | --- |
| Polymarket Freeze Baseline | Yes | Exact model–freeze intersection | Fixed: imputed model forecasts are now removed before all same-sample and cross-fit calculations. |
| Market Diversity × Performance | Yes | Exact configuration–freeze intersection | Pass: non-imputed Polymarket rows and valid freeze probabilities only. |
| Upper-left Configurations × Model | Yes | Exact model-pair–freeze intersection, separately for every pair and OOS direction | Pass: pair aggregation BI and market BI are computed on identical test keys. |
| With-freeze Prompt ↔ Market | Yes | Exact prompt configuration–freeze intersection | Pass: non-imputed Polymarket rows only; news prompts are excluded and zero-shot/scratchpad remain distinct. |
| With-freeze Prompt × Market Aggregation | Yes | Exact prompt configuration–freeze intersection on the opposite test fold | Pass: ten repeated event-disjoint splits, both A→B and B→A. |
| Without-freeze Base × Same-version With-freeze | Indirectly; experiment is restricted to market events | Exact three-way base–partner–freeze intersection | Pass: non-imputed Polymarket rows with valid freeze probabilities only. |
| Fixed-focal Without-freeze Model × Model | No | Global model-pair support | Market-only restriction does not apply; this block makes no comparison with Polymarket. |

## Corrections made in this audit

- Centralized original-row imputation filtering in
  `analysis/polymarket_cleaning.py` and applied it to the Polymarket Freeze
  Baseline generator.
- Regenerated the baseline artifact. Of 10,960 candidate scored Polymarket model
  rows, 1,126 rows backed only by `imputed=true` source forecasts were excluded;
  9,834 genuine rows remain.
- The eligible baseline model count changed from 28 to 26. DeepSeek-R1 and
  Kimi-K2-Thinking no longer meet the required repeated-fold support after the
  imputed rows are removed.
- Corrected the Near-BI UI so cross-fit mode reads train-fold eligibility (one
  model is Near-BI in at least one training fold), while same-sample mode keeps
  its separate count of zero.
- Added explicit website wording that Dataset questions are excluded from every
  prediction-market comparison block.

## Regression checks

- A unit test constructs a Dataset row with the same date and event id as a
  Polymarket row and verifies that it cannot enter the freeze panel.
- Contract tests recompute every published BI from adjusted Brier and every gain
  from its stated denominator.
- Cross-fit contract tests require ten deterministic repetitions, both
  directions, event-disjoint folds, and at least 50 train and test rows for every
  eligible model.
- Upper-left pair tests require pair-specific market BI, identical pair support,
  and consistency between the displayed triangle and `aggregation BI > market
  BI`.
- The upper-left pair artifact has a dedicated reproducible Makefile target,
  with the scored panel, taxonomy, original processed rows, and shared cleaning
  module declared as inputs.

This audit establishes implementation consistency and catches reproducible
scope/calculation errors. It does not turn descriptive diversity–gain
correlations into causal estimates or make hindsight `Best Single` deployable.

## Interpretation and repository boundaries

- Repeated A/B cross-fit is event-disjoint internal OOS, not a forward-time or
  external holdout. Repeated target-cell counts are not independent sample
  sizes; inference should cluster or bootstrap by market/event id.
- The Market Diversity dashed reference is a configuration-support-weighted
  descriptive benchmark. Exact model-versus-market claims must use each point's
  own matched-market score.
- Cross-fit combined BI is a test-support-weighted mean of fold-level BI. Since
  BI is nonlinear, it need not equal BI calculated after pooling every fold's
  adjusted loss, and it need not equal the same-sample diagnostic.
- Two older derived analyses that are not loaded by the website,
  `closed_form_aggregation` and `market_relative_tier_aggregation`, still use a
  pre-cleaning 28-model artifact. Their old summaries must not be quoted beside
  the audited website results until they are regenerated with the shared
  imputation cleaner.
