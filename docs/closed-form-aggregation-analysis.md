# Closed-form aggregation and diversity-failure analysis

## Research questions

1. Why do the released Polymarket-freeze pools fail to improve on Polymarket?
2. Can a deployable closed-form pool improve two-model aggregation without
   using test outcomes?
3. Why can a pair have high measured diversity but negative aggregation gain?

## Locked design

- Input panel: `data/build/scored_panel_model_versions.csv`, SHA-256
  `7b9ce08cd0e881ea111d15aa429a5c733d3f8b48c5dce88245afbbeb7df131c5`.
- Polymarket freeze field: audited `market_prob`, renamed from
  `freeze_datetime_value` in `data/build/event_taxonomy.csv`.
- Samples: the same 28 released Polymarket-model pairs and 337 released
  model-model pairs.
- Evaluation: ten deterministic random event-disjoint A/B splits; both
  A-train/B-test and B-train/A-test directions are evaluated.
- Model-model anchor: the lower adjusted-Brier constituent on the training
  fold. Polymarket is always the anchor in Polymarket-model pairs.
- Training-fold outcomes determine only the anchor, dependence diagnostics,
  Near-BI status, and aggregation weight. Opposite-fold outcomes determine
  only the reported test score and gain.
- The primary gain is computed after pooling the 20 fold-level adjusted-Brier
  scores for each pair. The fold-gain average is retained separately in the
  detailed CSV.

This is internal event-level OOS evidence, not a temporal deployment test. The
method was formulated after inspecting this benchmark, so an untouched
external or forward-time validation set is still required before making a
confirmatory paper claim.

## Exact decomposition

Let the stronger training-fold forecast be the anchor `p0`, the other forecast
be `p1`, `d = p1 - p0`, and `r = y - p0`. Consider

```text
q(alpha) = p0 + alpha * (p1 - p0),  0 <= alpha <= 1.
```

Because ForecastBench's question fixed effect and normalization term are the
same for every prediction on identical support, they cancel in a method
difference. Under the official equal-origin weighting, the exact adjusted-
Brier improvement over the anchor is therefore

```text
L(p0) - L(q) = 2 * alpha * C - alpha^2 * D,
C = E[(y - p0) * (p1 - p0)],
D = E[(p1 - p0)^2].
```

`D` is disagreement magnitude. `C` is directional alignment: whether the
partner tends to move the anchor toward the outcome. The constrained
closed-form optimum is

```text
alpha* = clip(C / D, 0, 1).
```

For the equal mean (`alpha = 0.5`), improvement is positive if and only if
`C / D > 0.25`. High disagreement or high oracle complementarity alone does
not imply that condition.

The independent numerical audit covered all 7,300 unique pair-fold records.
The maximum absolute discrepancy between the formula and the scored
simple-mean improvement was `5.03e-16`.

## Closed-form methods

### CF-Linear

Fit `alpha*` on the training fold and apply it unchanged to the opposite test
fold.

### CF-LCB

Estimate the standard error of `C` after clustering recurring rows by
`(source, event_id)`, then use

```text
alpha_LCB(z) = clip((C - z * SE(C)) / D, 0, 1).
```

The experiment reports `z = 1` and the one-sided 95% value `z = 1.645`.
This is a conservative shrink-to-anchor rule.

### Directional CF

The partner may be useful only when it moves the anchor upward or only when it
moves it downward. Split the observable disagreement by sign and fit two
closed-form weights:

```text
q = p0 + alpha_up * (p1 - p0),    if p1 >= p0,
q = p0 + alpha_down * (p1 - p0),  if p1 <  p0,

alpha_s = clip(C_s / D_s, 0, 1),  s in {up, down}.
```

The sign is observable at prediction time. `Directional CF-LCB-1SE` applies
the same one-standard-error shrinkage separately to the two directions.

## Finding 1: Polymarket is not a near-equal constituent

Across the 28 eligible Polymarket-model pairs:

- no one of the 560 training-fold records satisfies the released Near-BI
  threshold of two BI points;
- the median pair-level training BI gap is `12.13` points;
- support-weighted BI is `76.915` for Polymarket and `64.154` for the models;
- a model is never the lower-Brier constituent in any of the 560 opposite test
  folds;
- models beat Polymarket on only `22.4%` of individual target rows;
- Polymarket's mean absolute distance from 0.5 is `0.427`, versus `0.321` for
  models, while its signed probability bias is also smaller (`+0.024` versus
  `+0.117`).

The model is different, but its difference is usually harmful. The
support-weighted directional alignment is `C = -0.00413`; training-fold `C` is
positive in only `21.96%` of fold records, and its sign agrees between train
and test in only `61.1%` of records.

### Polymarket-model OOS results

| Method | Aggregation BI | Gain vs Polymarket | Positive pairs |
|---|---:|---:|---:|
| Polymarket anchor | 76.915 | +0.000% | 0.0% |
| Piecewise Odds | 75.095 | -17.147% | 3.6% |
| EC, w=0.56 | 74.766 | -20.358% | 0.0% |
| Log-odds mean | 74.414 | -23.848% | 0.0% |
| Simple mean | 72.717 | -41.845% | 0.0% |
| CF-Linear | 76.873 | -0.411% | 0.0% |
| CF-LCB-1SE | 76.909 | -0.060% | 0.0% |
| CF-LCB-95 | 76.913 | -0.013% | 0.0% |
| Directional CF | 76.743 | -1.689% | 0.0% |
| Directional CF-LCB-1SE | 76.897 | -0.176% | 0.0% |
| Test-fitted directional oracle | 76.996 | +0.737% | 100.0% |

The oracle shows that a small amount of direction-conditioned signal exists
inside each test fold, but the deployable training weights cannot transfer it.
Directional CF-LCB is positive in only one of ten repetitions and negative on
average. No tested deployable closed-form pool improves on Polymarket. The
empirically safe rule for this sample is to keep `alpha = 0` unless a future,
larger training history establishes stable incremental alignment.

## Finding 2: closed-form weighting materially improves model-model pools

Across all 337 model-model pairs, existing symmetric fixed pools are negative
against the opposite-fold hindsight best constituent. Closed-form methods
reverse the result.

| Method | Aggregation BI | Gain vs train-selected anchor | Gain vs test best single | Positive vs test best |
|---|---:|---:|---:|---:|
| Simple mean | 61.322 | -1.260% | -1.890% | 44.2% |
| EC, w=0.56 | 61.449 | -0.584% | -1.215% | 44.8% |
| Log-odds mean | 61.465 | -0.501% | -1.131% | 46.0% |
| CF-Linear | 61.903 | +1.816% | +1.182% | 60.5% |
| CF-LCB-1SE | 61.839 | +1.490% | +0.848% | 51.9% |
| Directional CF | 62.495 | +4.711% | **+4.098%** | **91.7%** |
| Directional CF-LCB-1SE | 62.365 | +4.066% | **+3.443%** | **89.3%** |
| Test-fitted directional oracle | 62.673 | +5.630% | +5.026% | 100.0% |

Directional CF and its conservative version have positive support-weighted
gain in all 10 split repetitions. Directional CF's repetition-level gain
against the test best single ranges from `+3.821%` to `+4.306%`.

The result also survives ability-gap stratification:

| Mean train BI gap | Pairs | Simple mean gain vs best | Directional CF gain vs best | Positive Directional CF pairs |
|---|---:|---:|---:|---:|
| <= 2 | 142 | +1.896% | +4.702% | 95.8% |
| 2 to 5 | 126 | -2.053% | +3.389% | 89.7% |
| > 5 | 69 | -11.121% | +3.812% | 87.0% |

These are exploratory results. The unusually strong directional result needs
a forward-time test, a fully untouched benchmark, event-cluster uncertainty,
and ablations before it should be positioned as a paper contribution.

## Finding 3: why high diversity can coexist with negative gain

Among the 85 model-model pairs in the top quartile of train-fold Adjusted POG,
37 have negative simple-mean gain against the training-selected anchor.

- all 37 have train BI gap greater than two points;
- four have nonpositive pooled test alignment `C`;
- the remaining 33 have positive alignment, but `0 < C / D < 0.25`, so an
  equal 50/50 weight is provably too large;
- no negative case remains with a pooled optimal weight at or above 0.25.

Examples include:

| Pair | Train POG | Train BI gap | Pooled optimal partner weight | Simple-mean gain vs anchor |
|---|---:|---:|---:|---:|
| Gemini-1.5-Flash x GPT-3.5-Turbo-0125 | 0.0422 | 12.19 | 0.000 | -15.98% |
| Claude-Opus-4-20250514 x GPT-4.1-2025-04-14 | 0.0476 | 10.07 | 0.024 | -14.66% |
| DeepSeek-R1 x Gemini-2.5-Flash-Preview-04-17 | 0.0416 | 11.11 | 0.093 | -13.23% |
| Claude-Sonnet-4-5-20250929 x Kimi-K2-Thinking | 0.0472 | 8.47 | 0.050 | -11.81% |
| DeepSeek-R1 x GPT-4.1-2025-04-14 | 0.0489 | 9.69 | 0.101 | -10.58% |

High diversity creates potential, but fixed pooling overuses the weaker
constituent. Directional CF turns the top Adjusted-POG quartile into
`+6.003%` support-weighted gain against the test best single, with `96.5%`
positive pairs.

## Diversity-gain interpretation

For model-model Directional CF, train-fold diversity predicts opposite-fold
gain most consistently through Adjusted POG:

- Adjusted POG: Pearson `0.447`, Spearman `0.428`;
- high-loss complementarity: Pearson `0.261`, Spearman `0.241`;
- adjusted-loss-correlation complementarity: Pearson `-0.037`, Spearman
  `-0.009`.

The Adjusted-POG association remains `0.471` after linearly residualizing both
variables on the mean train BI gap. Within the strict mean-gap `<= 2` stratum,
the Pearson correlation is `0.538`.

Therefore the defensible claim is not “every diversity measure guarantees
gain.” It is:

> Adjusted POG identifies model pairs with more realizable aggregation
> potential, especially after controlling constituent quality, while a
> dependence-aware closed-form weight is needed to convert that potential
> into positive OOS gain.

For Polymarket-model pairs, Adjusted POG can rank less-bad combinations, but
all deployable gains remain negative. A positive correlation inside an
all-negative region is not evidence that model-market aggregation improves on
the market.

## Artifacts

- `data/derived/closed_form_aggregation/summary.json`: design, provenance,
  method summaries, correlations, and failure taxonomy.
- `data/derived/closed_form_aggregation/pair_method_results.csv`: one row per
  pair and method after combining 20 OOS directions.
- `data/derived/closed_form_aggregation/fold_method_results.csv.gz`: all
  102,200 fold-method records, including fitted weights, train/test alignment,
  denominators, and both gain definitions.
- `analysis/closed_form_aggregation.py`: reproducible experiment.
- `tests/test_closed_form_aggregation.py`: formula, harmful-diversity,
  directional, leakage-boundary, and missing-metric tests.

## Limitations and required next validation

1. Run a forward-time evaluation: choose anchors and fit weights only from
   events whose outcomes were actually known before the forecast date.
2. Freeze Directional CF before evaluating it on an untouched external
   benchmark or later ForecastBench release.
3. Use event-cluster and model-cluster uncertainty; pairs share models and
   events, so 337 rows are not independent observations.
4. Ablate anchor selection, up/down splitting, clipping, and LCB shrinkage.
5. Investigate the 759 Polymarket taxonomy rows without valid scalar freeze
   probabilities. The current matched benchmark contains 1,057 scored round
   events from 670 unique market IDs and does not impute invalid values.
