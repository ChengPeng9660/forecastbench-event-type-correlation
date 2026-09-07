# Does a second raw forecast help without calibration?

2026-09-07 · Exploratory historical-holdout follow-up.

Default: training Overall BI gap <=3; coverage >=50%; all exact configurations; crossed training strengths; primary seed 20260910 A to B.
Event-equal Brier within each pair, then equal pair means. Positive gain means lower test Brier.

No fitted intercept, calibration curve, type correction or separate extremization parameter enters these new aggregators.
The fixed methods learn no parameters. The three learned methods fit one mixing coefficient using training data only.

## Main observations

The matched uncalibrated joint improves Brier by 0.001915 on complementary events and 0.002783 on all events. Its mean gain is positive in all ten directions in each scope. No calibration intercept, curve or type adjustment is needed for this observed improvement.

The four original fixed formulas improve mean Brier in 1/4 cases on complementary events and 3/4 on all events. Simply adding the other forecast does not guarantee improvement under every formula.

The normalized product is worse than raw selection by 0.003277 on all events, but replacing the duplicate by the other forecast improves its own Brier by 0.004186. Benefit within a pooling rule and benefit over raw selection are different comparisons.

The mean learned log-odds weight on the other forecast is 0.158; 6.0% of pairs have a negative weight. This is a regularized, training-fitted coefficient, not a universal optimal weight or evidence-overlap estimate.

## Complementary test events

2431 pairs; 201.6 mean test events per pair.

| Method | Brier | ECE | Gain vs selection | Pair wins vs selection | Gain vs duplicate | Pair wins vs duplicate | Positive directions vs selection / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 0.150402 | 0.087931 | +0.000000 | 0.0% | +0.000000 | 0.0% | 0 |
| Other forecast alone | 0.171903 | 0.120323 | -0.021501 | 7.6% | -0.021501 | 7.6% | 0 |
| Simple mean | 0.152815 | 0.100108 | -0.002413 | 34.2% | -0.002413 | 34.2% | 0 |
| Log-odds mean | 0.150978 | 0.095313 | -0.000576 | 46.2% | -0.000576 | 46.2% | 2 |
| EC · w = 0.56 | 0.150819 | 0.094601 | -0.000417 | 49.0% | -0.000263 | 49.0% | 3 |
| Piecewise odds | 0.150193 | 0.088477 | +0.000209 | 53.0% | +0.000103 | 51.1% | 8 |
| Normalized product | 0.157220 | 0.110277 | -0.006818 | 29.6% | +0.001106 | 55.6% | 0 |
| Uncalibrated joint | 0.148487 | 0.087761 | +0.001915 | 76.6% | +0.001915 | 76.6% | 10 |
| Bounded log-odds pool | 0.148479 | 0.087758 | +0.001923 | 74.2% | +0.001923 | 74.2% | 10 |
| Brier convex pool | 0.149276 | 0.091395 | +0.001126 | 61.6% | +0.001126 | 61.6% | 10 |

### Learned weight on the other forecast

Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: [0.15761724147036826, 0.1611961945862887, 0.18518649832732959].
Unrestricted lambda range [-0.244613, 0.621720]; shares [lambda<0, 0<=lambda<=1, lambda>1]: [0.060468942821883996, 0.939531057178116, 0.0].

### Gain contribution versus selection by original forecast group

| Method | Both high | Both low | Opposite | Other | Fallback contribution (overlapping partition) |
|---|---:|---:|---:|---:|---:|
| Simple mean | -0.000092 | +0.000132 | -0.000367 | -0.002086 | +0.000000 |
| Log-odds mean | -0.000095 | +0.000559 | -0.000135 | -0.000904 | +0.000000 |
| EC · w = 0.56 | -0.000256 | +0.001054 | -0.000130 | -0.001084 | +0.000000 |
| Piecewise odds | -0.000542 | +0.001542 | -0.000170 | -0.000621 | +0.000000 |
| Normalized product | -0.001594 | +0.001705 | -0.000692 | -0.006237 | +0.000000 |
| Uncalibrated joint | +0.000008 | +0.000485 | +0.000726 | +0.000696 | +0.000000 |
| Bounded log-odds pool | +0.000005 | +0.000489 | +0.000739 | +0.000690 | +0.000000 |
| Brier convex pool | -0.000002 | +0.000219 | +0.000729 | +0.000179 | +0.000000 |

## All test events

2431 pairs; 412.8 mean test events per pair.

| Method | Brier | ECE | Gain vs selection | Pair wins vs selection | Gain vs duplicate | Pair wins vs duplicate | Positive directions vs selection / 10 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Raw type selection | 0.157282 | 0.087063 | +0.000000 | 0.0% | +0.000000 | 0.0% | 0 |
| Other forecast alone | 0.174656 | 0.110271 | -0.017374 | 7.0% | -0.017374 | 7.0% | 0 |
| Simple mean | 0.157345 | 0.097123 | -0.000063 | 48.3% | -0.000063 | 48.3% | 6 |
| Log-odds mean | 0.155691 | 0.092678 | +0.001591 | 61.0% | +0.001591 | 61.0% | 10 |
| EC · w = 0.56 | 0.155265 | 0.092290 | +0.002017 | 64.0% | +0.002065 | 63.5% | 10 |
| Piecewise odds | 0.154688 | 0.086818 | +0.002594 | 66.3% | +0.002615 | 65.7% | 10 |
| Normalized product | 0.160559 | 0.109437 | -0.003277 | 38.6% | +0.004186 | 70.6% | 0 |
| Uncalibrated joint | 0.154499 | 0.086456 | +0.002783 | 88.6% | +0.002783 | 88.6% | 10 |
| Bounded log-odds pool | 0.154467 | 0.086518 | +0.002815 | 87.1% | +0.002815 | 87.1% | 10 |
| Brier convex pool | 0.154987 | 0.089361 | +0.002295 | 78.4% | +0.002295 | 78.4% | 10 |

### Learned weight on the other forecast

Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: [0.15761724147036826, 0.1611961945862887, 0.18518649832732959].
Unrestricted lambda range [-0.244613, 0.621720]; shares [lambda<0, 0<=lambda<=1, lambda>1]: [0.060468942821883996, 0.939531057178116, 0.0].

### Gain contribution versus selection by original forecast group

| Method | Both high | Both low | Opposite | Other | Fallback contribution (overlapping partition) |
|---|---:|---:|---:|---:|---:|
| Simple mean | -0.000023 | +0.000134 | +0.000437 | -0.000611 | +0.000835 |
| Log-odds mean | -0.000028 | +0.000542 | +0.000690 | +0.000387 | +0.001489 |
| EC · w = 0.56 | -0.000168 | +0.001115 | +0.000713 | +0.000357 | +0.001857 |
| Piecewise odds | -0.000440 | +0.001681 | +0.000625 | +0.000728 | +0.002048 |
| Normalized product | -0.001496 | +0.001963 | +0.000242 | -0.003987 | +0.000755 |
| Uncalibrated joint | +0.000030 | +0.000448 | +0.001202 | +0.001103 | +0.001486 |
| Bounded log-odds pool | +0.000029 | +0.000452 | +0.001221 | +0.001112 | +0.001513 |
| Brier convex pool | +0.000026 | +0.000238 | +0.001304 | +0.000726 | +0.001394 |

## Interpretation

A positive comparison with raw selection establishes an empirical benefit of that pooling rule on these held-out events. It is not a universal benefit of adding models.
A positive comparison with F(s,s) indicates a benefit from replacing a duplicate with the other forecast under the same formula and frozen weight. EC, Piecewise and the product can change confidence even when both inputs are identical.
Pooling without an explicit calibration step may still improve calibration. These results do not prove independent internal evidence or an unrestricted conditional-information claim.
The ten directions share events and models. Existing historical test results motivated this follow-up; all settings above were fixed before the new calculations.

See PROTOCOL.md, audit.json, source-manifest.json, all-direction-scores.csv.gz, primary-pair-results.json.gz and views/*.json.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
