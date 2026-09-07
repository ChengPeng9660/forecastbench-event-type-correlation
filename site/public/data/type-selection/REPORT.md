# Type-based model selection: results

2026-09-07 · Primary direction 20260910 A→B.

Training Overall BI gap ≤3; ≥50% supported training event mass; crossed strengths; all exact configurations.

Each pair is equally weighted in these means; each event is equally weighted within a pair/scope.

## Complementary events only

2431 / 2431 pairs defined; mean 201.6 test events per pair; mean 51.1% of all test events; 0.0% fallback event weight.

| Method | Mean Brier score ↓ | Mean BI ↑ | Mean ECE ↓ | Routing BI gain ↑ | Routing wins (BI) |
|---|---:|---:|---:|---:|---:|
| Type-based selection | 0.150402 | 62.0408 | 0.08793 | +0.0000 | 0.0% |
| Simple mean | 0.152815 | 61.7465 | 0.10011 | +0.2943 | 65.8% |
| Log-odds mean | 0.150978 | 62.0160 | 0.09531 | +0.0248 | 53.8% |
| EC · w = 0.56 | 0.150819 | 62.0491 | 0.09460 | -0.0083 | 51.0% |
| Piecewise odds | 0.150193 | 62.1195 | 0.08848 | -0.0787 | 47.0% |
| Model A | 0.161033 | 60.6651 | 0.10608 | +1.3757 | 86.0% |
| Model B | 0.161271 | 60.6235 | 0.10421 | +1.4173 | 86.8% |
| Train-selected single | 0.157857 | 61.0790 | 0.10115 | +0.9618 | 81.4% |

Positive routing gain means selecting by historical type performs better than that row's method.

## All test events

2431 / 2431 pairs defined; mean 412.8 test events per pair; mean 100.0% of all test events; 34.5% fallback event weight.

| Method | Mean Brier score ↓ | Mean BI ↑ | Mean ECE ↓ | Routing BI gain ↑ | Routing wins (BI) |
|---|---:|---:|---:|---:|---:|
| Type-based selection | 0.157282 | 60.5018 | 0.08706 | +0.0000 | 0.0% |
| Simple mean | 0.157345 | 60.4937 | 0.09712 | +0.0081 | 51.7% |
| Log-odds mean | 0.155691 | 60.7045 | 0.09268 | -0.2027 | 39.0% |
| EC · w = 0.56 | 0.155265 | 60.7613 | 0.09229 | -0.2595 | 36.0% |
| Piecewise odds | 0.154688 | 60.8298 | 0.08682 | -0.3280 | 33.7% |
| Model A | 0.165172 | 59.5370 | 0.09960 | +0.9648 | 82.7% |
| Model B | 0.166766 | 59.3416 | 0.09857 | +1.1602 | 86.1% |
| Train-selected single | 0.161152 | 60.0293 | 0.09377 | +0.4725 | 79.3% |

Positive routing gain means selecting by historical type performs better than that row's method.

## Stability over ten prespecified event directions

| Split | Train fold | Pairs | Routing BI gain vs Simple mean: complementary | All events |
|---|---|---:|---:|---:|
| 20260910 | 0 | 2431 | +0.2943 | +0.0081 |
| 20260910 | 1 | 2489 | +0.1896 | -0.0480 |
| 20260911 | 0 | 2437 | +0.2662 | +0.0567 |
| 20260911 | 1 | 2505 | +0.2262 | -0.0953 |
| 20260912 | 0 | 2095 | +0.3194 | +0.0317 |
| 20260912 | 1 | 2891 | +0.1841 | -0.0586 |
| 20260913 | 0 | 2785 | +0.3853 | +0.0766 |
| 20260913 | 1 | 2486 | +0.1960 | -0.0896 |
| 20260914 | 0 | 3069 | +0.1920 | -0.0404 |
| 20260914 | 1 | 1814 | +0.1420 | -0.0823 |

The directions and model pairs share data; they are stability views, not independent replications. No test information selected categories, routes, pairs, or a reporting direction. The complementary scope includes all supported types with ≥1 BI historical advantage; other supported types still route by training Brier in the all-event scope. Sparse, tied or unknown types use the Overall training winner.

See PROTOCOL.md, audit.json, primary-pairs.csv, and all-directions.csv.gz for definitions and auditable outputs.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
