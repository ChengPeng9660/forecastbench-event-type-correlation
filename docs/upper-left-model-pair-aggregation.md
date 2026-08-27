# Upper-left model-pair aggregation

Generated: 2026-08-27

## Research question

After selecting exact model configurations that are close to the upper-left of
the model-versus-market scatterplot, can closed-form model-to-model pools attain
a higher Brier Index than freeze-time Polymarket on identical pair support?

Only non-imputed ForecastBench Polymarket targets with an available
`freeze_datetime_value` / `market_prob` are eligible. Dataset-source questions
are excluded. Model version, information condition, and prompt remain distinct.

## Block 1: fixed configurations

The fixed set contains 18 exact configurations that satisfied the released
`plot_upper_left` rule in at least 16 of 20 prior train-fold directions. The
model names are fixed before this experiment. Every model pair with at least 50
common eligible Polymarket targets is scored once on its full pair support.

The fixed set yields 92 eligible model pairs. The overall Polymarket BI is
75.2467 on 1,057 eligible targets, but every pair is compared with Polymarket
only on that pair's common target support.

| Method | Pair-method rows | Pairs above pair-matched market | Share above pair-matched market | Mean aggregation BI | Mean BI minus market |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple Mean | 92 | 43 | 46.7% | 79.242 | -0.000 |
| Log-odds Mean | 92 | 40 | 43.5% | 79.233 | -0.009 |
| EC, w = 0.56 | 92 | 59 | 64.1% | 79.417 | +0.175 |
| Piecewise Odds | 92 | 66 | 71.7% | **79.501** | **+0.260** |

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

| Method | Averaged pair rows | Pairs above pair-matched market | Share above pair-matched market | Mean aggregation BI | Mean BI minus market |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simple Mean | 357 | 78 | 21.8% | 78.274 | -0.716 |
| Log-odds Mean | 357 | 93 | 26.1% | 78.296 | -0.694 |
| EC, w = 0.56 | 357 | 140 | 39.2% | 78.485 | -0.504 |
| Piecewise Odds | 357 | 164 | 45.9% | **78.567** | **-0.423** |

## Market comparison

For every full-sample pair and every OOS direction, aggregation BI and market BI
are computed on the identical model-pair target keys. Direction-level values
are then averaged. A triangle therefore means a support-matched score win over
Polymarket, but it is not by itself a statistical-significance claim.

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
