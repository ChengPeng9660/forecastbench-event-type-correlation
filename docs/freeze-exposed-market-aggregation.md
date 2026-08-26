# Freeze-exposed LLMs aggregated with the market

## Research question

ForecastBench contains LLM configurations whose prompts explicitly include
`with freeze values`. This experiment asks whether those forecasts still add
out-of-sample information when they are aggregated with the same event's
Polymarket probability at the ForecastBench freeze time.

This is a stricter question than comparing an ordinary LLM forecast with a
market forecast. The with-freeze model has already observed the market signal,
so aggregating the two may either recover a useful model adjustment or count
the same information twice.

## Locked design

- Market anchor: audited `market_prob`, the repository's rename of
  ForecastBench `freeze_datetime_value`.
- Model universe: GPT, Claude, Gemini, Qwen, DeepSeek, and Kimi configurations
  whose exact configuration contains `with freeze values`.
- Primary sample: one outcome-blind representative configuration per canonical
  model version, preferring zero shot over more augmented configurations.
- Robustness sample: every eligible exact with-freeze configuration.
- Eligibility: at least 50 common non-imputed Polymarket targets overall and
  in every training/test half across all repeated splits.
- Evaluation: ten deterministic event-disjoint A/B splits, evaluated in both
  A-train/B-test and B-train/A-test directions.
- Leakage boundary: dependence, Near-BI, and fitted weights use only the
  training half. The opposite half's outcomes are used only for scoring.
- Gain fraction: `(market adjusted Brier - method adjusted Brier) / market
  adjusted Brier`. Positive means lower loss than Polymarket. Across models,
  the primary reported mean is weighted by common-event count, as requested.
- BI is also reported for readability and is higher-is-better. Gain fractions
  are computed from adjusted Brier loss, not by dividing BI values.

## Imputation audit

The scored panel does not retain ForecastBench's row-level `imputed` flag, so
the experiment reopens every referenced original processed JSON file. A scored
Polymarket row is excluded when every matching original source row has
`imputed=true`; a collapsed duplicate is retained if any backing source is a
genuine forecast.

- With-freeze input: 855 of 16,966 candidate Polymarket model rows were
  excluded (`5.04%`).
- Released no-freeze matched input: 1,126 of 10,960 rows were excluded
  (`10.27%`).
- No missing source file or unresolved imputation status was tolerated.

This exclusion is material. All results below are the rerun after removing
those rows.

## Primary result

The primary analysis retains 27 canonical with-freeze model versions. Each
method is evaluated over 93,230 repeated OOS model-event cells: 9,323 distinct
model-event cells per repetition, with every event evaluated exactly once in
each repetition.

| Method | Aggregation BI | Weighted gain vs market | Positive model pairs |
|---|---:|---:|---:|
| Polymarket | 76.898 | +0.000% | 0 / 27 |
| With-freeze model alone | 75.151 | -17.657% | 5 / 27 |
| Best Single, hindsight | 76.948 | +0.494% | 16 / 27 |
| EC, w=0.56 | 76.742 | -1.318% | 15 / 27 |
| Simple mean | 76.410 | -4.416% | 7 / 27 |
| Log-odds mean | 76.550 | -3.096% | 8 / 27 |
| Piecewise Odds | 76.788 | -0.819% | 13 / 27 |
| CF-Linear | 76.802 | -0.970% | 4 / 27 |
| CF-LCB-1SE | 76.888 | -0.091% | 3 / 27 |
| CF-LCB-95 | 76.898 | +0.0068% | 1 / 27 |
| Directional CF | 76.778 | -1.139% | 10 / 27 |
| Directional CF-LCB-1SE | 76.885 | -0.118% | 7 / 27 |
| Test-fitted directional oracle | 77.039 | +1.354% | 25 / 27 |

Piecewise Odds is the best of the four prespecified fixed pools, but its
average gain remains negative. CF-LCB-95 is numerically indistinguishable from
keeping the market: its pooled gain is `+0.0040%`, only one model pair is
strictly positive, and its repetition-level pooled gain changes sign. It
should be interpreted as successful shrinkage to the market anchor, not as a
meaningful improvement.

The all-configuration robustness sample contains 39 eligible exact
configurations and gives the same ordering: Piecewise Odds `-0.980%`, EC
`-1.572%`, Log-odds `-3.316%`, and Simple mean `-5.582%` weighted gain versus
the market. The result is therefore not created by selecting one canonical
configuration.

## Why fixed aggregation usually fails

On identical matched support, market/model similarity changes sharply after
the model sees the freeze value:

| Diagnostic, macro across matched models | No freeze | With freeze |
|---|---:|---:|
| Prediction Pearson correlation | 0.396 | 0.920 |
| Mean absolute probability difference | 0.151 | 0.031 |
| Root mean squared probability difference | 0.237 | 0.077 |
| Exact-copy share | 0.69% | 21.87% |

The with-freeze forecast is therefore usually a market-conditioned
transformation rather than an independent second signal. A symmetric mean or
odds pool can count market information twice or sharpen a correlated error.
The model alone is also weaker on average. Fixed pooling gives that weaker,
highly redundant forecast too much weight.

The matched performance comparison reinforces this interpretation:

| Method | No-freeze gain vs market | With-freeze gain vs market |
|---|---:|---:|
| Model alone | -126.896% | -18.015% |
| EC, w=0.56 | -19.616% | -1.323% |
| Simple mean | -34.616% | -4.481% |
| Log-odds mean | -22.455% | -3.152% |
| Piecewise Odds | -17.087% | -0.746% |

Showing the market value helps the LLM substantially and makes every pool much
less harmful. It does not, however, make re-aggregation better than the market
on average.

## Heterogeneity: some models do help

Piecewise Odds is positive for 13 of 27 canonical model versions. Its largest
pair-level gains are:

| With-freeze model | Gain vs market |
|---|---:|
| GPT-5-2025-08-07 | +9.04% |
| Claude-Opus-4-1-20250805 | +6.37% |
| Kimi-K2-Instruct | +5.47% |
| GPT-5-Mini-2025-08-07 | +4.95% |
| Kimi-K2-Instruct-0905 | +4.90% |
| Gemini-3-Pro-Preview | +4.23% |

The worst cases are also large: Qwen3 Thinking `-17.51%`, Claude-3 Opus
`-11.64%`, GPT-5 Nano `-9.01%`, and Claude-3 Haiku `-5.21%`. Those failures
outweigh the positive cases in the overall mean. The pair-level ranking is
exploratory until a train-only or forward-time selection rule can identify the
positive models without observing their test outcomes.

## Near-BI and oracle diagnostics

Near-BI must be decided from the training fold. Under that strict rule, 428
pair-fold records across 25 models are selected. Piecewise Odds is positive in
`59.3%` of those fold records but still has `-0.066%` weighted gain and
`-0.651%` pooled gain versus the market. EC is `-0.363%`, Log-odds is
`-2.010%`, and Simple mean is `-2.121%`. Near-BI reduces the damage but does
not establish a positive OOS mean.

The test-fitted directional oracle gains `+1.354%` overall and is positive for
25 of 27 models. This proves that conditional incremental signal exists inside
the test sample, but the oracle uses test outcomes and is not deployable. The
failure of fitted cross-fold weights shows that this incremental direction is
not yet stable enough to estimate from half of the current history.

## Defensible conclusion

The current result supports the following claim:

> Models that observe the market freeze value become substantially more
> accurate and much closer to the market forecast, but aggregating them again
> with that same market signal does not reliably improve on Polymarket. The
> remaining model adjustment is heterogeneous and unstable across events;
> conservative fitted rules mostly learn to retain the market anchor.

It does **not** support claiming that a specific with-freeze model or pool is
known ex ante to beat Polymarket. The positive Piecewise Odds pairs motivate a
selection study, not a deployable conclusion.

## Limitations and next validation

1. Event-disjoint cross-fit is internal OOS evidence, not a forward-time test.
2. Model versions and event repetitions share information, so pair rows are
   not independent statistical units. Use event-cluster and model-cluster
   uncertainty for paper inference.
3. Freeze exposure is inferred from the exact ForecastBench configuration
   label and audited source files; it does not reveal how a provider internally
   used the value.
4. Freeze a model-selection rule using only past resolved events, then test it
   on later ForecastBench rounds or an untouched external benchmark.
5. Treat Best Single and test-fitted oracles strictly as upper-bound
   diagnostics.

## Reproducible artifacts

- `analysis/freeze_exposed_market_aggregation.py`: experiment and source-level
  imputation audit.
- `tests/test_freeze_exposed_market_aggregation.py`: configuration,
  imputation, similarity, and released-artifact checks.
- `data/derived/freeze_exposed_market_aggregation/summary.json`: locked design,
  provenance hashes, selection audit, summaries, and model diagnostics.
- `data/derived/freeze_exposed_market_aggregation/pair_method_results.csv`:
  combined 10-repeat OOS result for every with-freeze configuration and method.
- `data/derived/freeze_exposed_market_aggregation/fold_method_results.csv.gz`:
  every repetition, direction, fitted parameter, diagnostic, and test score.
- `data/derived/freeze_exposed_market_aggregation/matched_pair_method_results.csv`:
  no-freeze/with-freeze comparison on identical support.

Run with:

```bash
make freeze-exposed-market-aggregation \
  FORECASTBENCH_EVENTS=/path/to/forecastbench-events.csv \
  FORECASTBENCH_PROCESSED_ROOT=/path/to/forecastbench-processed-forecast-sets \
  FORECASTBENCH_FIXED_EFFECTS=/path/to/question_fixed_effects.json
```
