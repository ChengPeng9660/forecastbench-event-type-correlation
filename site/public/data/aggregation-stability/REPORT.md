# No-reversal pairs and training-overall fallback

Post-hoc analysis: test outcomes determine reversal status; the fallback model and all coefficients use training data only.

Only pairs with crossed training event-type advantages are eligible. No unrelated LLM pairs are added.

Primary eligible cohort counts: {'no_reversal': 1629, 'reversed': 802, 'unverified': 0}.

| Cohort | Test scope | Pairs | Selection Brier | Simple mean Brier | Strong single | Matched aggregation |
|---|---|---:|---:|---:|---:|---:|
| stable | all | 1629 | 0.158287 | 0.159778 | 0.145628 | 0.144058 |
| stable | complementary | 1629 | 0.153146 | 0.158505 | 0.142661 | 0.141750 |
| fallback | all | 802 | 0.155624 | 0.152404 | 0.142399 | 0.139455 |
| fallback | complementary | 802 | 0.145458 | 0.141258 | 0.133095 | 0.130110 |
| all | all | 2431 | 0.157408 | 0.157345 | 0.144563 | 0.142540 |
| all | complementary | 2431 | 0.150610 | 0.152815 | 0.139505 | 0.137910 |

Brier: targets averaged within each event, then equal events, then equal pairs. ECE: target-weighted ten-bin calibration error.

A type tie is not a reversal. A missing test type is unverified and uses the overall fallback. Neither qualifies as evidence of strictly positive held-out advantage.

No significance claim or prospective generalization claim is made from this test-conditioned grouping.
