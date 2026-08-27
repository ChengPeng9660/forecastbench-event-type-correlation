# Upper-left model-pair aggregation

Generated: 2026-08-27

## Research question

After selecting exact model configurations that are close to the upper-left of
the model-versus-market scatterplot, can closed-form model-to-model pools attain
a higher Brier Index than the direct mean freeze-time Polymarket benchmark?

Only non-imputed ForecastBench Polymarket targets with an available
`freeze_datetime_value` / `market_prob` are eligible. Dataset-source questions
are excluded. Model version, information condition, and prompt remain distinct.

## Block 1: fixed configurations

The fixed set contains 18 exact configurations that satisfied the released
`plot_upper_left` rule in at least 16 of 20 prior train-fold directions. The
model names are fixed before this experiment. Every model pair with at least 50
common eligible Polymarket targets is scored once on its full pair support.

The fixed set yields 92 eligible model pairs. The direct overall Polymarket BI
is 75.2467 on 1,057 eligible targets.

| Method | Pair-method rows | Pairs above overall market mean | Share above mean | Mean aggregation BI | Mean BI minus market |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple Mean | 92 | 72 | 78.3% | 79.242 | +3.995 |
| Log-odds Mean | 92 | 72 | 78.3% | 79.233 | +3.986 |
| EC, w = 0.56 | 92 | 72 | 78.3% | 79.417 | +4.170 |
| Piecewise Odds | 92 | 72 | 78.3% | **79.501** | **+4.255** |

## Block 2: train-selected cross-fit

Ten deterministic random seeds assign each `(lowercase source, event_id)` to
one of two folds. All dates and horizons for the same event remain in one fold.
Each repetition evaluates both A-to-B and B-to-A.

Within each training fold, an exact configuration is selected when:

- its model-market prediction diversity is no greater than the fold's 25th
  percentile; and
- its training-fold Brier Index is at least the fold's 75th percentile.

Only training-fold outcomes define the selection. Model-pair diversity is
measured on train; aggregation BI is measured on the opposite test fold. Pair
results are arithmetic means across all eligible OOS directions in which both
models were selected. The released payload reports the actual evaluation count
out of the 20 possible directions for every pair.

The website defaults to pairs observed in at least 10 of the 20 possible OOS
directions. Its control can expose the full set down to one direction; the
summary table below reports all eligible pair averages.

The procedure yields 357 distinct eligible pairs and 11,744 fold-level
pair-method evaluations.

| Method | Averaged pair rows | Pairs above overall market mean | Share above mean | Mean aggregation BI | Mean BI minus market |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple Mean | 357 | 276 | 77.3% | 78.274 | +3.029 |
| Log-odds Mean | 357 | 279 | 78.2% | 78.296 | +3.051 |
| EC, w = 0.56 | 357 | 279 | 78.2% | 78.485 | +3.241 |
| Piecewise Odds | 357 | 282 | 79.0% | **78.567** | **+3.322** |

## Market comparison caveat

The user requested a direct-average market reference rather than a market
score recomputed on each model pair's exact support. The triangle marker
therefore means that the pair's aggregation BI is above the overall evaluation
sample's Polymarket BI. It is a descriptive comparison, not an identical-
support head-to-head test or a statistical significance claim.

## Reproduction

```bash
PYTHONPATH=. .venv/bin/python analysis/upper_left_model_pair_aggregation.py \
  --processed-root "/Users/pcc/Desktop/forecast dependence/forecastbench_downloads_2026-06-25/extracted/processed_forecast_sets_combined/forecastbench-processed-forecast-sets"
```

Released artifacts:

- `site/public/data/pair-aggregation/upper-left-model-pairs.json`
- `data/derived/upper_left_model_pair_aggregation/summary.json`
- `data/derived/upper_left_model_pair_aggregation/fixed_pair_methods.csv`
- `data/derived/upper_left_model_pair_aggregation/crossfit_fold_methods.csv.gz`
- `data/derived/upper_left_model_pair_aggregation/crossfit_pair_method_averages.csv`
