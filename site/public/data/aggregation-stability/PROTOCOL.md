# No-reversal type selection with training-overall fallback

Specification fixed on 2026-09-08 before this extension's results are computed.
The user requests pairs whose historical type advantages do not reverse, and
explicitly chooses the training Overall Brier winner for reversed pairs.

## Population and retrospective grouping

Reuse the frozen 2026-09-05 event-weighted ForecastBench panel, exact model
configurations, genuine common forecasts, the five event-cluster split seeds
20260910–20260914 and both train/test directions. The primary direction remains
20260910 A→B. Reuse the original training eligibility: at least 100 common
training and 100 common test events overall, training Overall BI gap ≤3/5,
at least two types with ≥30 common training events, supported-type coverage
≥50/60/70/80%, and opposite training advantages of at least 1 BI point.

For every pair and direction, fit the original training router. Examine ALL
its training-defined complementary types (≥30 training events and absolute
training BI gap ≥1), not only its two strongest edges. On the same pair's
common test forecasts within each such type, compute event-equal Brier for
the two raw models. A reversal means the training-selected model's test Brier
exceeds the other model's by more than 1e-12. A test tie within 1e-12 is not a
reversal. Every complementary type must have at least one common test event;
otherwise the pair is unverified and excluded from the no-reversal cohort.
There is no new per-type test-size or test-margin threshold.

The no-reversal cohort contains only pairs with all complementary types
observed and no reversal. If any type reverses, the WHOLE pair uses the overall
fallback, on both evaluation scopes. An unverified pair also uses the fallback.
Report reversed and unverified reasons separately. Classification is repeated
for each split direction, not inferred from the primary direction.

This uses test outcomes for grouping and for choosing whether to route or
fallback. It is explicitly POST-HOC descriptive analysis, not a deployable
training-only rule, chronological forecast, or unbiased final test estimate.
Do not interpret the overlapping pairs or directions as independent samples.
Retain the historical training-only analysis and original published scores.

## Forecast rule and calibration

For no-reversal pairs, preserve the original type router exactly (including
training-overall fallback for sparse types in the all-event scope). For all
other pairs, use the model with lower Overall event-equal TRAINING Brier on
every training and test target. Use the original deterministic tie rule.
No test outcome chooses the fallback model or fits a calibration coefficient.

Run the same four fixed pools, the same matched single/joint control models,
and the same input- and output-calibration pipelines with this selection rule.
If fallback changes the selected/other roles, refit all affected calibration
and control coefficients using training data under the new fixed roles;
never attach old type-router calibration scores to the new baseline. Keep
the existing formulas, clipping, penalties, event weighting and fitting losses.
The UI still presents only Pipeline selection and the four requested pools.

Keep the two existing test scopes: original training-defined complementary
types and all common test events. All methods in a comparison use identical
targets and weights. Brier averages targets within events then events equally;
ECE uses the existing target-weighted ten bins. Cohort means weight pairs
equally. Publish no-reversal, overall-fallback, and all-pairs-with-fallback
cohorts separately; display no-reversal by default.

ECE retains the archive's numerical bin assignment min(9, floor(10*p)),
including floating-point rounding at bin boundaries. The independent audit
uses scalar bin assignments and separately averaged probability/outcome means.

## Verification and artifacts

Record input/code/protocol hashes. Export per-type train/test support, both
models' scores, reversal/tie/missing status, original choice, actual policy
choice, and the training-overall fallback model. Export all ten directions,
primary pair shards, cohort summaries, and calibration/control fit audits.

Test whole-pair fallback, sign/tolerance/missing-support boundaries, unchanged
training fallback choice under changed test labels, common-support weighting,
and refitting after role changes. Independently group event losses for sampled
pair-directions. Reconstruct each primary cohort summary from exported pair
scores. Verify retained pairs match prior published scores and fixed symmetric
pools remain unchanged on fallback pairs. Label downloads and UI as post-hoc.
