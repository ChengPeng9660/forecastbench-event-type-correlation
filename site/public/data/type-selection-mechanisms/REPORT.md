# Why can pooling beat historical type selection?

2026-09-07 · Exploratory follow-up · Primary direction 20260910 A→B.

Training Overall BI gap ≤3; training type coverage ≥50%; crossed strengths; all exact configurations.
Event-equal Brier within pairs, then equal pair means. Positive gain means lower Brier for the second method.

## Main observations

On all test events, calibrating selection alone lowers Brier by 0.009451. Adding the other forecast to a flexible type-adjusted baseline lowers it by a further 0.001889 relative to that baseline. Both contrasts improve the mean in all ten fixed directions.

The specific high-high explanation is contradicted for the Piecewise comparison: both-high forecasts contribute -0.000440 to its gain, while both-low forecasts contribute +0.001681. High-high contributions are negative in all ten directions at all three prespecified cutoffs, in both test scopes. This does not imply that upward extremization can never help an individual event.

Fallback targets account for 34.5% of all-event weight and +0.002048 of the total +0.002594 Piecewise gain (78.9% of the net gain). This partition overlaps the confidence partition; the two decompositions must not be added together.

These results support incremental predictive information and substantial calibration headroom. They do not identify a single causal mechanism or prove independent internal evidence.

## Complementary test events

2431 pairs; 201.6 mean test events per pair.

| Method | Brier ↓ | ECE ↓ |
|---|---:|---:|
| Type-based selection | 0.150402 | 0.087931 |
| Simple mean | 0.152815 | 0.100108 |
| Log-odds mean | 0.150978 | 0.095313 |
| EC · w = 0.56 | 0.150819 | 0.094601 |
| Piecewise odds | 0.150193 | 0.088477 |
| Calibrated selection | 0.144286 | 0.064125 |
| Type-adjusted selection | 0.139624 | 0.049822 |
| Type-adjusted joint model | 0.138147 | 0.049711 |
| Training convex pool | 0.152471 | 0.098642 |
| Extremized convex pool | 0.151414 | 0.095492 |

| Diagnostic contrast | Brier gain | Pair wins | Positive directions / 10 |
|---|---:|---:|---:|
| Calibrated selection vs Type-based selection | +0.006115 | 80.0% | 10 |
| Type-adjusted joint model vs Type-adjusted selection | +0.001477 | 79.6% | 10 |
| Extremized convex pool vs Training convex pool | +0.001056 | 55.7% | 10 |
| EC · w = 0.56 vs Log-odds mean | +0.000159 | 55.0% | 10 |
| Piecewise odds vs Type-based selection | +0.000209 | 53.0% | 8 |

### Piecewise odds gain versus selection by original forecast group

| Group | Scope weight | Conditional Brier gain | Additive gain contribution | Selected p | Piecewise p | Outcome frequency |
|---|---:|---:|---:|---:|---:|---:|
| both_high | 5.1% | -0.010668 | -0.000542 | 0.8499 | 0.9075 | 0.7984 |
| both_low | 35.2% | +0.004384 | +0.001542 | 0.0660 | 0.0231 | 0.0194 |
| opposite | 13.3% | -0.001278 | -0.000170 | 0.4583 | 0.4672 | 0.3548 |
| other | 46.4% | -0.001337 | -0.000621 | 0.4998 | 0.5049 | 0.4229 |

Matched residual check: 1867/2431 pairs; 6122 cells.
High-minus-low [outcome, selected p, residual, other p]: [0.07002238100979002, -0.008268960608540517, 0.07731372546519445, 0.37282464309007846].
Mean fitted gamma 1.190; gamma>1 for 73.9% of pairs.
Supported route test-lead retention: 84.8% of routed scope weight.

## All test events

2431 pairs; 412.8 mean test events per pair.

| Method | Brier ↓ | ECE ↓ |
|---|---:|---:|
| Type-based selection | 0.157282 | 0.087063 |
| Simple mean | 0.157345 | 0.097123 |
| Log-odds mean | 0.155691 | 0.092678 |
| EC · w = 0.56 | 0.155265 | 0.092290 |
| Piecewise odds | 0.154688 | 0.086818 |
| Calibrated selection | 0.147831 | 0.048822 |
| Type-adjusted selection | 0.144590 | 0.044468 |
| Type-adjusted joint model | 0.142701 | 0.044008 |
| Training convex pool | 0.156399 | 0.094676 |
| Extremized convex pool | 0.154957 | 0.091719 |

| Diagnostic contrast | Brier gain | Pair wins | Positive directions / 10 |
|---|---:|---:|---:|
| Calibrated selection vs Type-based selection | +0.009451 | 88.0% | 10 |
| Type-adjusted joint model vs Type-adjusted selection | +0.001889 | 89.1% | 10 |
| Extremized convex pool vs Training convex pool | +0.001443 | 64.8% | 10 |
| EC · w = 0.56 vs Log-odds mean | +0.000426 | 65.2% | 9 |
| Piecewise odds vs Type-based selection | +0.002594 | 66.3% | 10 |

### Piecewise odds gain versus selection by original forecast group

| Group | Scope weight | Conditional Brier gain | Additive gain contribution | Selected p | Piecewise p | Outcome frequency |
|---|---:|---:|---:|---:|---:|---:|
| both_high | 5.2% | -0.008483 | -0.000440 | 0.8291 | 0.8913 | 0.7890 |
| both_low | 33.4% | +0.005034 | +0.001681 | 0.0759 | 0.0293 | 0.0252 |
| opposite | 13.9% | +0.004486 | +0.000625 | 0.4600 | 0.4653 | 0.3405 |
| other | 47.5% | +0.001533 | +0.000728 | 0.4987 | 0.4999 | 0.4141 |

Matched residual check: 2158/2431 pairs; 10039 cells.
High-minus-low [outcome, selected p, residual, other p]: [0.10066792186440066, -0.0069210928580346375, 0.10676719115006518, 0.37747342830051234].
Mean fitted gamma 1.190; gamma>1 for 73.9% of pairs.
Supported route test-lead retention: 80.4% of routed scope weight.

## Interpretation limits

The confidence partitions describe where gains occur, not why models hold their beliefs. The nested joint comparison tests predictive usefulness within a fixed regularized logistic family. It does not prove independent evidence. Calibration, added predictors and extremization are separate interventions and do not constitute an additive causal decomposition.

The existing test archive was already inspected before this follow-up. Ten directions share events and models. Matching uses coarse probability bins and applies only to its explicitly reported supported subset. No naive significance claims are made.

See PROTOCOL.md, audit.json, source-manifest.json, all-direction-scores.csv.gz, primary-pair-diagnostics.json.gz, and views/*.json for complete definitions and outputs.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
