# Probability-calibrated versions of the raw pooling experiment

2026-09-07. Freeze this protocol before computing this extension. This is an
exploratory follow-up to previously inspected historical holdouts. No setting,
calibration location, method, or direction is selected using the new test scores.

## Frozen population and scoring

Use the exact 2026-09-05 panel, genuine common forecasts, training router, crossed
strengths, near-ability pair directions and test supports from commit 3c070ca.
Retain gaps 3/5, coverage 50/60/70/80%, three exact-configuration identity scopes,
and all ten directions, with primary seed 20260910 A to B. Evaluate both
training-defined complementary types and all common test events. The same
training-fitted predictions are used for both test scopes. Do not reselect the
router, fallback, types, pairs, or eligibility after calibration.

Brier averages targets within each event, then events equally within each
pair/scope, then pairs equally. ECE remains target-weighted within each
pair/scope, with ten equal-width bins. Every method comparison uses identical
targets and events. Pair wins use a 1e-10 tolerance. The overlapping directions
are stability views, not independent replications; do not infer naive significance.

## Common probability calibration family

Let z=logit(clip(p,1e-6,1-1e-6)). Fit

C(p) = sigmoid(z + a + b*z/4).

Minimize event-weighted training log loss plus
0.005*(0.1*a^2+b^2)/2. These are the same calibration family, feature scaling,
penalty and gradient tolerance 1e-8 as the preceding Calibrated selection
experiment. The zero coefficients reproduce the clipped input forecast.
Use damped Newton iterations; independently check gradients, coefficients and
predictions on sampled primary pairs. No type feature or spline enters this
calibration. Parameters are pair-specific and use common outer training data only.
Retain learned slopes and intercepts in the export, including slope signs.

## Two prespecified locations for calibration

**Input calibration (primary displayed version).** Fit C_A and C_B separately
on the two exact configurations' common training forecasts and outcomes. Apply
the existing raw-training router to determine which model is selected. Its
calibrated forecast is s_c=C_selected(p_selected); the other is
o_c=C_other(p_other). Compute every fixed pooling formula F(s_c,o_c). For the
three one-weight methods, fit their original training objectives and penalties
on these calibrated training inputs, then freeze those weights. The baseline is
calibrated type selection s_c, using the exact same C_A/C_B as every pool.

**Output calibration (separate comparator).** Reproduce each raw pooling method
and its raw-training mixing weight from the preceding experiment. Fit one C_m
to each method's training output and freeze it. Predict C_m(F_m(s,o)) on test
events. The baseline is a separately fitted C_selection(s) of the same family
and regularization. Check it against the previously published Calibrated
selection result. Do not recalibrate inputs in this version.

The two versions have different calibrated-selection baselines. Their gains
must always identify their own baseline. Compare both with the original raw
scores for each method, but never compare a calibrated pool only with an
uncalibrated single and call the whole improvement aggregation benefit.

This is an outer event-holdout evaluation of training-fitted pipelines. Where a
pipeline has multiple fitted stages, those stages reuse its outer training
data. No inner cross-fitting is added or claimed. This can increase fitting
optimism, especially for learned-weight methods; the fixed outer test still
evaluates the frozen complete pipeline. Report the limitation explicitly.

## Methods and controls

Retain the same ten method identities: type selection, other forecast alone,
Simple mean, Log-odds mean, EC (w=0.56), Piecewise odds, normalized product,
unrestricted one-weight log-odds pool, bounded log-odds pool, and Brier convex
pool. The formulas and weight objectives are unchanged from the no-calibration
protocol. The previously named Uncalibrated joint is labeled One-weight
log-odds pool in this calibrated extension. Model identities and selected/other
roles remain explicit; the single mixing coefficient is shared across types.

For the duplicate diagnostic, preserve every fitted parameter and substitute
the selected forecast for the other only at evaluation:

- Input version: compare F(s_c,o_c) with F(s_c,s_c).
- Output version: compare C_m(F(s,o)) with C_m(F(s,s)), using the same C_m.

Do not refit the duplicate pipeline. Also report the separately calibrated
selection comparator, which is a different baseline from same-formula duplication.
Negative gains must remain visible. Normalized product remains a heuristic
pooling rule, without an assumption of independent internal evidence.

## Exports, diagnostics and verification

Publish both locations and both test scopes for all 24 filter views and ten
directions. For each method report calibrated Brier/ECE, original raw
Brier/ECE, gain from calibrating that method, gain and win rate versus the
appropriate calibrated selection, same-formula duplicate Brier/gain/win rate,
and fitted coefficients/weights. Retain exact primary-pair outputs.

Confidence groups use original raw model probabilities, with both-high >=0.7,
both-low <=0.3, opposite sides of 0.5, and other forecasts. Preserve original
event weights so group gain contributions add to the full scope gain.

Reconstruct original raw forecasts and compare all method scores and pair
counts against the preceding no-calibration publication. Independently rebuild
input/output calibration and pooling predictions, event means, group and
duplicate contributions, and optimality for every nineteenth primary pair.
Record source/code/protocol hashes and a pre-run protocol lock. Test known
miscalibration recovery, duplicate controls, both calibration locations,
training-only prediction invariance, weighting, clipping and publication contracts.

Interpret improvements as empirical performance of these pipelines. Neither
calibration nor duplicate controls identify unrestricted conditional information
or independence of internal evidence. Existing historical test reuse and
overlapping model pairs limit confirmatory and causal interpretation.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
