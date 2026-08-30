# High-loss lift: calculation and presentation audit

Date: 2026-08-31. Baseline: `7c5eed0`. Scope: every published high-loss lift/diversity view, including topic/global matrices, rankings, stability, model–model and model–market aggregation, and exact prompt/information configurations.

## What changed

The underlying statistic is unchanged. For adjusted losses on identical forecast-target support, let `A = loss_a > 0.25` and `B = loss_b > 0.25`. Then

`lift = P(A and B) / (P(A) * P(B)) = n * joint_count / (count_a * count_b)`.

Scatter diversity is `1 - lift`. A positive marginal on both sides and zero joint count gives lift 0, diversity 1. If either marginal count is zero, lift is undefined, not zero. Lift 1 (diversity 0) is an independence reference, not a statistical test. Diversity has upper bound 1 and no fixed lower bound.

### Corrected defects

1. Some older exporters averaged the high-loss X coordinate over only defined training folds, while retaining all opposite-fold outcomes in Y. All included folds must now have defined lift for a combined high-loss coordinate. Otherwise X is explicitly null; scores and folds remain available for other metrics. This does not silently select on test outcomes or refit aggregators.
2. Numeric zero was treated as missing by one generic exporter. Zero lift and zero diversity now remain valid.
3. Empty legacy lift fields could raise a float-conversion error. They now retain a null coordinate and a reason. NaN/Inf inputs are rejected.
4. Extreme lift values overwhelmed linear scatter spacing and heatmap color normalization. Scatter X spacing is now signed-log, with original raw tick labels and no clipping. Raw lift heatmap colors use `log(1 + lift)`; cell values, ranks, and CSV statistics are unchanged. Stability cells remain Spearman correlations, with their original −1 to +1 scale.
5. Missing coordinates are reported separately from unavailable pairs or missing outcomes. Single defined points remain visible. Constant-vector correlations are undefined rather than manufactured zeroes.
6. High-loss association summaries are withheld for fewer than three points, fewer than three distinct X values, constant outcomes, or any displayed pair retaining fewer than half the attempted directions. This is a descriptive reporting safeguard, not a significance threshold; it does not remove points. Reported coefficients still use raw, not transformed, coordinates.

### Diagnostics

Published diagnostics include defined/undefined fold coverage, reasons, and marginal/joint high-loss counts where recoverable from original support. Cross-fit sums count repeated training exposures, not independent events; minimum per-fold counts are also exposed. Fewer than five high-loss records is a descriptive sparsity warning, not proof of reliability above five.

Old all-event exports do not retain enough information to reconstruct marginal counts. These explicitly report that counts are unavailable; the Polymarket-only clean panel is not substituted for all-event data. Total overlap is not evidence that high-loss estimates are precise.

Near-BI continues to use training-fold BI gaps only. Exact-configuration inspectors also show the test BI gap and retained training-selected directions. Ten repetitions do not mean 20 independent experiments or that every Near-BI point uses 20 directions.

## Data preservation

The refresh uses stored folds and the audited clean cache; it does not refit aggregation weights, alter target support, or rerun outcome predictions. Against the original Git baseline:

- 246 public JSON payloads were checked.
- 9,105,281 original non-high-loss scalar values are exactly unchanged, including losses, BI, gains, support, and other diversity metrics.
- 982 finite high-loss **view coordinates**, not independent pairs, became null because some included training folds were undefined.

| Payload | Finite high-loss coordinates changed to null |
| --- | ---: |
| Freeze-exposed model/market aggregation | 74 |
| Without-freeze base/market aggregation | 50 |
| Upper-left selected model pairs | 804 |
| Freeze-market baseline | 54 |
| Other refreshed payloads, including 238 exact-configuration shards | 0 |

The exact-configuration shards already enforced strict fold missingness. Their numeric values are unchanged; diagnostics were added. Original score-producer and catalog provenance are retained separately from diagnostics-refresh provenance.

Machine-readable evidence is in `data/derived/high_loss_diagnostics_audit/report-final.json`; the initial refresh report is retained as `report.json`. The independent auditor does not import the producer or refresh implementation and separately verifies allowed mutations, before/after hashes, null repairs, and refreshed high-loss summary correlations. Its `independent-report.json` passes all 246 payloads with no errors, protecting 9,351,090 original scalar fields (including unchanged metadata and fields inside high-loss objects). It independently reconstructs 1,733 legacy market views from original checksummed folds or unchanged selections and clean-cache counts, including all 1,432 currently undefined views; 450 of those were already undefined before this repair.

## Reproducing the reported screenshot

Base: `GPT-5.1-2025-11-13 (zero shot with freeze values)`. Combined, train Near-BI, all computed support, Directional CF.

There are 29 eligible partner views: 22 have undefined high-loss X, and 7 are plotted. Six have X = 1; the remaining point is `Qwen3-235B-A22B-Thinking-2507 (zero shot with freeze values)` at X = −34.26282051282051. Its three folds have `(n, count_a, count_b, joint)` equal to `(87,1,2,1)`, `(75,2,3,2)`, and `(72,2,2,2)`. Their diversities are −42.5, −24, and −35; their original training-support weighted mean is preserved exactly. This is a sparse-marginal extreme, not an arithmetic error.

For `Claude-Opus-4-1-20250805 (zero shot)`, only seed 20260831, B→A passes training Near-BI. Training support is 72 targets; high-loss counts are 2 and 1, joint 0, so X = 1. Training BI gap is 0.10416, but test BI gap is 11.48755. Directional CF test BI is 78.404857, versus base 82.118055 and market 82.088940. Gain versus base remains −45.8420%. A train-selected near-BI pair can therefore be far apart on test support.

The former raw Pearson of approximately −0.261 is not robust evidence of a general relationship: it compares just two distinct X groups, with only 1–3 of 20 attempted directions retained per point. The UI now reports that limitation instead of a headline coefficient. The six tied points correctly remain tied after the fix.

## Verification and reproduction

```bash
PYTHONPATH=. .venv/bin/python -m analysis.refresh_high_loss_diagnostics \
  --baseline-ref 7c5eed0 \
  --report data/derived/high_loss_diagnostics_audit/report-final.json
PYTHONPATH=. .venv/bin/python -m analysis.audit_high_loss_refresh \
  --output data/derived/high_loss_diagnostics_audit/independent-report.json
cd site
npm test -- --maxWorkers=2 --testTimeout=15000
npm run build
npm run test:e2e -- --workers=2
```

Tests cover zero margins, zero joint counts, extreme finite lift, reversed orientation, fold missingness, unchanged non-high-loss fields, raw-correlation calculations, nonlinear display geometry, and actual published-data behavior. The screenshot regression runs on desktop and mobile and verifies the GPT-5.1 case above. This audit is not a claim that high-loss lift is statistically reliable in all samples; sparse tails remain a limitation of the estimator.

Full frontend verification at release: 189 unit/component/data-contract tests passed; the desktop/mobile suite passed 87 tests with one intentionally skipped desktop-only duplicate. A loaded-machine five-second test timeout was reproduced and the complete suite rerun with a 15-second timeout; no test assertion was weakened. The build also passes TypeScript and Vite compilation.
