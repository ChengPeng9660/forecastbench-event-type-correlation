# Does a second raw forecast help without calibration?

2026-09-07. Fixed before computing this follow-up. The historical holdouts have
already been inspected in the preceding routing and mechanism experiments;
this extension is exploratory, not a fresh confirmatory study.

## Shared population and endpoint

Use the same frozen 2026-09-05 panel, genuine common forecasts, exact configuration
pairs, training router, crossed training strengths, Overall training BI gaps
3/5, coverage thresholds 50/60/70/80%, three identity scopes, and ten event
directions as commit 523154a. Primary direction is seed 20260910, A to B.
Evaluate the unchanged training rule on both training-defined complementary
types and all common test events. A learned pooling weight uses the full common
training fold, once, and is unchanged between test scopes. No test scores select
weights, methods, thresholds, or a reporting direction.

Let s be the historical type-selected raw probability and o the unselected raw
probability for that target. These roles may switch between A and B by type.
The router is the existing training-Brier rule, including its original fallback.
Types enter only this unchanged router. The new aggregators have no calibration
intercept, fitted single-forecast slope, spline, or type adjustment.

Brier averages common targets within each event, then events equally within a
pair/test scope, then pairs equally. ECE remains target-weighted within each
pair/scope, with ten equal-width bins. Report pair wins using a 1e-10 tolerance
and positive-direction counts, without naive significance or independence
claims for overlapping pairs or event directions.

## Fixed raw-forecast comparisons

Publish raw selection s and the other forecast o alone, plus all four original
unchanged formulas: Simple mean, Log-odds mean, EC with w=0.56, and Piecewise
odds. Also publish a normalized-product rule:

q_product = s*o / (s*o + (1-s)*(1-o)) = sigmoid(logit(s)+logit(o)).

Use the original clipping epsilon 1e-6 for log-odds computations. This is a
product aggregation rule, not the probability of two separate events occurring
together. Its Bayesian interpretation would require appropriate assumptions
about evidence and a common prior of 0.5; this archive experiment does not
establish those assumptions. It is evaluated as a fixed heuristic.

## Matched removal of calibration and pooling controls

1. Uncalibrated joint: q = sigmoid(z_s + beta*(z_o-z_s)/4). Fit beta alone by
   event-weighted training log loss plus 0.005*beta^2/2. This fixes every
   calibration/type coefficient in the preceding joint model at zero and
   retains exactly its additional predictor, loss, feature scaling and penalty.
   beta is unrestricted; report lambda=beta/4 and the fractions below 0, inside
   [0,1], and above 1. Convexity and the fixed ridge yield a unique minimizer.
2. Bounded log-odds pool: the same objective with beta in [0,4], equivalently
   lambda in [0,1]. This prevents extrapolation beyond the two clipped inputs.
   Obtain the constrained solution by clipping the unconstrained minimizer.
3. Brier convex pool: q=(1-lambda)*s+lambda*o, lambda in [0,1], minimizing
   event-weighted training Brier by its closed-form quadratic solution. If
   forecasts coincide in all training targets, use lambda=0. These weights
   attach to selected/other roles, unlike the preceding fixed-A/B convex pool.

All three fit one coefficient per pair direction, shared across types. For
duplicate training forecasts beta=0. Scalar log-loss optimization uses a
bracketed monotone-gradient root and checks the first-order/KKT residual.
Preserve zero weight as the selected-forecast baseline, subject only to the
documented clipping error in log-odds methods.

## Same-formula duplicate control

For every method, also compute its prediction after replacing o by s at test
time. Use the identical formula and already trained weight, with no refitting.
Report two differences: Brier(s)-Brier(F(s,o)), and
Brier(F(s,s))-Brier(F(s,o)). The second asks whether replacing a duplicate with
the other forecast helps under the same aggregation rule. Simple/Log-odds means
preserve duplicated inputs; EC, Piecewise and the product may change confidence
even with a duplicate. Therefore improvement versus raw selection alone does
not by itself identify incremental information.

This control does not prove an unrestricted conditional-information claim:
pooling may still improve calibration, and forecasts need not encode independent
internal evidence. No explicit calibration step is different from no change in
calibration. Retain negative results and report both test scopes.

## Diagnostics and audit

Publish per-method Brier, ECE, gains and win rates against raw selection and
same-formula duplication; pairwise beat-both-selected-and-other rates; fitted
weight distributions; all ten direction means; and exact primary pair outputs.
Partition gains by original both-high (>=0.7), both-low (<=0.3), opposite sides
of 0.5, and other forecasts, retaining original scope weights so contributions
sum to the total. Also report the overlapping fallback partition separately.

Verify the unchanged first four formulas and selection against the preceding
publication. Independently reconstruct all new primary predictions, event
weights, duplicate comparisons, and optimizer conditions for every nineteenth
primary pair. Record input/code/protocol hashes and a pre-run protocol lock.
Test signal recovery, duplicate invariance, boundaries, convex restrictions,
direct ablation equivalence and immutable predictions under changed test labels.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
