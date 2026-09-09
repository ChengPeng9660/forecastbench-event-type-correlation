# Event-type matched aggregation without calibration

2026-09-09 exploratory historical-holdout follow-up; type_normalized_ll_ridge_v1.

Each supported type normalizes its training events independently and uses the same ridge strength as the global fit. Sparse, empty, and unseen types use the unchanged global coefficient.

The main all-pair cohort is training-defined. The no-reversal and reversed-or-unverified cohorts are post-hoc diagnostics because their labels use test outcomes; they never alter routing or coefficients.

Brier is event-equal within pair and then pair-equal. ECE is target-weighted in ten fixed equal-width bins. Lower is better for both.

## All cohort

### All test events

| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 2431 | 0.157282 | +0.000000 | 0.087063 | +0.000000 | 0.0% | +0.000000 | 0 | 0 |
| Global matched aggregation | 2431 | 0.154499 | +0.002783 | 0.086456 | +0.000607 | 88.6% | +0.002783 | 10 | 10 |
| Event-type matched aggregation | 2431 | 0.154359 | +0.002923 | 0.084388 | +0.002675 | 88.8% | +0.002923 | 10 | 10 |

### Complementary test events

| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 2431 | 0.150402 | +0.000000 | 0.087931 | +0.000000 | 0.0% | +0.000000 | 0 | 0 |
| Global matched aggregation | 2431 | 0.148487 | +0.001915 | 0.087761 | +0.000170 | 76.6% | +0.001915 | 10 | 9 |
| Event-type matched aggregation | 2431 | 0.148336 | +0.002065 | 0.085086 | +0.002845 | 76.9% | +0.002065 | 10 | 10 |

## No Reversal cohort

### All test events

| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 1629 | 0.158287 | +0.000000 | 0.090308 | +0.000000 | 0.0% | +0.000000 | 0 | 0 |
| Global matched aggregation | 1629 | 0.156044 | +0.002243 | 0.090499 | -0.000191 | 85.8% | +0.002243 | 10 | 5 |
| Event-type matched aggregation | 1629 | 0.155809 | +0.002478 | 0.088457 | +0.001851 | 86.9% | +0.002478 | 10 | 10 |

### Complementary test events

| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 1629 | 0.153146 | +0.000000 | 0.088417 | +0.000000 | 0.0% | +0.000000 | 0 | 0 |
| Global matched aggregation | 1629 | 0.152295 | +0.000851 | 0.089831 | -0.001414 | 68.6% | +0.000851 | 10 | 0 |
| Event-type matched aggregation | 1629 | 0.151970 | +0.001176 | 0.087062 | +0.001355 | 71.7% | +0.001176 | 10 | 10 |

## Reversed Or Unverified cohort

### All test events

| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 802 | 0.155241 | +0.000000 | 0.080471 | +0.000000 | 0.0% | +0.000000 | 0 | 0 |
| Global matched aggregation | 802 | 0.151361 | +0.003880 | 0.078245 | +0.002227 | 94.3% | +0.003880 | 10 | 10 |
| Event-type matched aggregation | 802 | 0.151414 | +0.003827 | 0.076122 | +0.004349 | 92.6% | +0.003827 | 10 | 10 |

### Complementary test events

| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 802 | 0.144827 | +0.000000 | 0.086942 | +0.000000 | 0.0% | +0.000000 | 0 | 0 |
| Global matched aggregation | 802 | 0.140751 | +0.004076 | 0.083556 | +0.003386 | 92.9% | +0.004076 | 10 | 10 |
| Event-type matched aggregation | 802 | 0.140957 | +0.003870 | 0.081072 | +0.005870 | 87.5% | +0.003870 | 10 | 10 |

## Training-fitted coefficient summary

The reported coefficient is lambda on the other forecast in `z_s + lambda * (z_o-z_s)`. Types are the router's exact seven-domain labels.

| Training group | Pair fits | Mean lambda | Median lambda | IQR | Negative share |
|---|---:|---:|---:|---:|---:|
| Global | 2431 | 0.158 | 0.158 | [0.089, 0.224] | 6.0% |
| Sparse/unseen fallback | 2431 | 0.158 | 0.158 | [0.089, 0.224] | 6.0% |
| climate_weather | 756 | 0.108 | 0.119 | [0.004, 0.220] | 24.1% |
| entertainment_culture | 0 | — | — | — | — |
| finance | 2431 | 0.056 | 0.072 | [-0.022, 0.153] | 30.5% |
| health | 1333 | 0.074 | 0.083 | [-0.047, 0.209] | 34.8% |
| politics | 2421 | 0.150 | 0.175 | [0.054, 0.272] | 18.3% |
| sports | 1148 | 0.125 | 0.134 | [-0.003, 0.259] | 25.4% |
| technology | 1 | -0.075 | -0.075 | [-0.075, -0.075] | 100.0% |

## Interpretation guardrails

The event-type method estimates aggregation interactions, not a calibration map: there is no intercept, calibration slope, spline, probability offset, or test-fitted parameter.
A positive held-out result is evidence for this rule on this frozen population, not a universal guarantee. The ten directions share models and events, so no naive significance claim is made.

See PROTOCOL.md, audit.json, source-manifest.json, all-direction-results.jsonl.gz, primary-fits.json.gz, and views/*.json.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
