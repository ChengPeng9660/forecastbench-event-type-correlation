# Forward-time historical Near-BI market aggregation

## Question

If a freeze-exposed model has historically performed similarly to Polymarket,
does aggregating that model with the market improve later forecasts?

## Leakage-safe design

For every model and forecast date, the experiment:

1. reconstructs the original ForecastBench `resolution_date` from the source
   JSON;
2. excludes every scored Polymarket model row backed only by
   `imputed=true` forecasts;
3. retains historical model/market targets only when
   `resolution_date < current forecast_due_date`;
4. requires at least 50 shared resolved historical targets;
5. selects the model when the absolute historical BI gap to Polymarket is at
   most two points;
6. evaluates EC `w=0.56`, Simple Mean, Log-odds Mean, and Piecewise Odds on the
   current forecast date.

Same-day resolutions are excluded. Current-date outcomes are used only for
scoring and never for selection or prediction. The primary model configuration
per canonical version is selected without outcomes, preferring explicit
zero-shot `with freeze values` configurations.

This is a true forward-time historical screen. It is stricter than the random
event-disjoint Near-BI cross-fit because it observes the actual resolution
boundary.

## Primary sample

- Historical Near-BI threshold: `|BI_model - BI_market| <= 2`.
- Minimum resolved history: 50 common targets.
- Selected decisions: 42 model-date records.
- Distinct models: 12.
- Distinct forecast dates: 14.
- Test pair-event cells: 2,386.

Pair-event cells duplicate a current event when more than one model is selected
on the same date. This is a collection of two-input model/market aggregation
decisions, not one multi-model portfolio.

## Main result

The user-requested primary aggregation is the event-count-weighted mean of the
model-date fractional gains. The ratio of pooled losses and the resulting BI
are reported separately because averaging ratios is not the same operation as
taking the ratio of averages.

| Method | Weighted BI | Weighted mean gain vs market | Pooled gain vs market | Positive model-dates |
|---|---:|---:|---:|---:|
| Polymarket | 77.396 | +0.000% | +0.000% | 0 / 42 |
| With-freeze model alone | 76.582 | -6.976% | -8.063% | 12 / 42 |
| EC, w=0.56 | 77.321 | -0.168% | -1.234% | 24 / 42 |
| Simple Mean | 77.173 | -1.648% | -2.265% | 13 / 42 |
| Log-odds Mean | 77.159 | -1.777% | -2.477% | 14 / 42 |
| Piecewise Odds | 77.390 | **+0.695%** | **-0.986%** | 25 / 42 |

Piecewise Odds is the best method by the requested weighted mean of gain
fractions, but the conclusion is not robust to aggregation scale:

- weighted mean fractional gain: `+0.695%`;
- support-weighted BI: `77.390`, slightly below Polymarket `77.396`;
- pooled adjusted-Brier gain: `-0.986%`;
- positive forecast dates after pooling selected models within date: 6 of 14;
- median forecast-date pooled gain: `-0.593%`.

Thus historical Near-BI alone does not establish that aggregation beats the
market. It does establish that Piecewise Odds is substantially better than
using the selected model by itself: `+6.649%` event-count-weighted gain versus
the model and positive on 35 of 42 model-dates.

## Threshold sensitivity

| Historical BI gap | Model-dates | Models | Test cells | Piecewise weighted gain | Piecewise pooled gain |
|---:|---:|---:|---:|---:|---:|
| <= 0.5 | 17 | 6 | 936 | +0.778% | -0.852% |
| <= 1.0 | 21 | 9 | 1,164 | -0.632% | -1.973% |
| <= 2.0 | 42 | 12 | 2,386 | +0.695% | -0.986% |
| <= 3.0 | 61 | 17 | 3,468 | -0.242% | -2.604% |
| <= 5.0 | 77 | 18 | 4,387 | -1.449% | -2.895% |

No threshold produces a positive pooled gain. The sign of the weighted mean
also changes non-monotonically. The result is therefore not a threshold-robust
market improvement.

The earlier random event-disjoint train-Near-BI analysis reaches the same
substantive conclusion: Piecewise Odds has `-0.066%` weighted mean gain and
`-0.651%` pooled gain versus Polymarket. The forward-time and random-split
designs differ in the sign of one ratio-average summary, but both are negative
under pooled adjusted Brier.

## Model heterogeneity at the two-BI threshold

Piecewise Odds has positive weighted mean gain versus Polymarket for seven of
the 12 selected models. The strongest descriptive results are:

| Model | Selected dates | Test cells | Weighted gain vs market |
|---|---:|---:|---:|
| Gemini-2.5-Pro | 1 | 58 | +9.21% |
| Claude-Sonnet-4-20250514 | 2 | 115 | +5.31% |
| Claude-Opus-4-1-20250805 | 4 | 221 | +5.02% |
| Qwen3-235B-A22B-Fp8-Tput | 8 | 409 | +4.33% |
| Claude-Sonnet-4-5-20250929 | 2 | 106 | +3.90% |
| GPT-4o-2024-05-13 | 1 | 59 | +2.61% |

The largest negative result is Claude Haiku 4.5: one selected date, 48 test
cells, and `-31.41%`. This single-date tail helps explain why a majority of
positive model-date records can coexist with a negative pooled result.

## Interpretation

Historical similarity controls constituent quality but not incremental
information. Two forecasters can have similar BI while making the same errors.
That is especially likely here because the model has already observed the
market freeze probability. Near-BI is therefore a useful eligibility control,
but not a sufficient selection rule for positive market aggregation.

The defensible conclusion is:

> Restricting to historically Near-BI freeze-exposed models makes Piecewise
> Odds the least harmful and yields a small positive mean of pair-level gain
> fractions, but the result reverses under pooled adjusted Brier, is positive
> on only six of fourteen forecast dates, and is not robust across BI-gap
> thresholds. Historical Near-BI alone does not reliably beat Polymarket.

## Artifacts

- `analysis/historical_near_bi_market_aggregation.py`: resolution-aware
  forward-time experiment.
- `tests/test_historical_near_bi_market_aggregation.py`: strict-resolution and
  aggregation-scale checks.
- `data/derived/historical_near_bi_market_aggregation/summary.json`: design,
  provenance, audits, threshold sensitivity, model and date summaries.
- `data/derived/historical_near_bi_market_aggregation/model_date_method_results.csv`:
  every eligible model-date-method result before Near-BI thresholding.

Run with:

```bash
make historical-near-bi-market-aggregation \
  FORECASTBENCH_EVENTS=/path/to/forecastbench-events.csv \
  FORECASTBENCH_PROCESSED_ROOT=/path/to/forecastbench-processed-forecast-sets \
  FORECASTBENCH_FIXED_EFFECTS=/path/to/question_fixed_effects.json
```
