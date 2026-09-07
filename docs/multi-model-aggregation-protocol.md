# Complementary teams with two, three, and four forecasts

Specification fixed on 2026-09-08 before computing the extension's results.
This is a post-hoc exploration of the frozen event-equal ForecastBench panel.
The user chooses collective specialization: every member must have a type
where it is the best member; pairwise complementarity is not required.

## Search population and eligibility

Start from the existing primary no-reversal, crossed-training-strength pairs
with training Overall BI gap <=3 and supported-type coverage >=50%. Extend
each pair by every other exact configuration in the frozen 313-configuration
panel. Deduplicate the resulting three-member sets and retain qualifying teams.
Extend retained three-member sets by each other configuration to find four-member
teams. This is an anchored growth search, not exhaustive enumeration of all
possible four-member combinations. Do not rank or truncate teams by test gain.

Recompute all eligibility statistics on each team's genuine common targets.
Use primary split seed 20260910, train A and test B. Require >=100 common events
on both sides, training Overall BI range <=3, at least two supported types with
>=30 training events each, and >=50% training event coverage by supported types.
A complementary type has a unique best training member with >=1 BI lead over
the runner-up. Every team member must win at least one complementary type.
Every complementary type must appear on the test side, and its training winner
must have test Brier no worse than every other member (tolerance 1e-12).
Test ties count as no reversal, not a strictly positive advantage. No new
per-type test count or significance threshold is imposed.

Training outcomes determine routing and fitted parameters. Test outcomes
determine no-reversal eligibility. Results are test-conditioned descriptive
evidence and cannot establish prospective selection or statistical independence.

## Matched model-count comparisons

For a selected team of up to four members, freeze the intersection of ALL its
members' genuine forecast targets before fitting or scoring any subset. Use
these identical train/test targets for every two-, three-, and four-member
subset shown in its growth trajectory. The complementary-event test mask is
also fixed to the final team's training-defined complementary types.
Changing the final team changes this support; label this explicitly in the UI.
Never splice earlier pair scores computed on a larger pair-specific sample
into the model-count curve.

Fit the historical type router within each subset using training Brier, with
the training-overall winner for sparse or tied types. Exact name order breaks
ties deterministically. Record each subset's collective specialization and
no-reversal status on the common support. Permit trajectories only when all
displayed subsets satisfy the same eligibility rule. The user chooses the
inclusion order; do not optimize this order using test scores.

The single-forecast comparator has the same intercept, selected-logit slope,
three logit hinges (-2, 0, 2), seven type offsets, event weights, penalized
log-loss fitting, and ridge values as the existing Strong single baseline.
For K inputs, extend Matched aggregation with K-1 other-minus-selected logit
features, each divided by 4. Other forecasts are ordered by their training
Overall Brier (exact name for ties) after removing the selected member. This
rule is fixed from training and reduces to the existing two-model feature.
Fit all coefficients jointly on training data. The no-calibration control
fixes all intercept, slope, hinge, and type-adjustment coefficients to zero,
and fits only those K-1 fusion coefficients with the same loss and ridge.
Zero fusion coefficients reproduce the clipped selected forecast.

Score raw type selection, Strong single, matched calibrated aggregation,
matched uncalibrated aggregation, and simple mean on both fixed scopes.
Brier is equal within-event targets then equal events. ECE uses the existing
target-weighted ten-bin rule. Comparisons across model counts are paired
within a final team and support. Do not describe monotonic gains as guaranteed.

## Validation and presentation

Publish all qualifying primary teams, model identities, group type profiles,
sample counts, subset scores, eligible inclusion paths, coefficients, and
source/code hashes. Preserve original pair results and the six-row table.
Compare the two-input implementation against the existing calibrator and
uncalibrated joint solver on the same training and test data. Independently
reconstruct sampled event-equal scores; test common-support invariance,
test-label isolation of fitting, member specialization, and direction changes.
Show an explicit empty state when no third/fourth member qualifies. Report
retention counts without treating overlapping teams as independent samples.
