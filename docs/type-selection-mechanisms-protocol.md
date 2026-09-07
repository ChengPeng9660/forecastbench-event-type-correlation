# Why can pooling beat historical type selection?

Protocol fixed on 2026-09-07 before computing this extension. This is an
exploratory follow-up to already inspected historical holdouts, not a new
confirmatory test. No threshold, fitting parameter, or reporting direction
will be selected by the new test results.

## Frozen population and scores

Use the exact panel and crossed-strength pair directions in the published
type-selection experiment (commit 39ff6b0). Preserve the primary 20260910 A→B
direction, all ten fixed directions, Overall training BI gaps ≤3/≤5, training
coverage 50/60/70/80%, and exact configuration identity filters. Use the same
training router and the two nested test scopes: training-selected complementary
types and all common test events. Every fitted comparator uses the full common
training fold once, and its predictions are unchanged between test scopes.

Brier averages targets within each event, then events within each pair/scope,
then pairs equally. ECE retains target weights within each pair/scope and ten
equal-width bins. This mechanism analysis uses Brier as its primary endpoint.
Preserve each event's original scope weight when decomposing gains; a confidence
group may contain only some targets of an event. Group contributions must add
to the full score difference. Overlapping model pairs and event directions are
not independent replications; do not report naive pair-level significance.

## 1. Agreement and confidence decomposition

Four exhaustive, mutually exclusive prediction groups are fixed in advance:
both high (both ≥0.7), both low (both ≤0.3), opposite sides of 0.5 (strict), and
other forecasts (including exactly 0.5). Repeat the decomposition at symmetric
0.6/0.4 and 0.8/0.2 cutoffs as labeled sensitivity views. Groups use original
model forecasts only, never outcomes. For every fixed formula report group
mass, conditional Brier gain versus selection, additive contribution to total
gain, mean selected and aggregated probabilities, and observed event frequency.
The primary displayed comparator is Piecewise odds, which was already strongest
in the preceding experiment; all four comparators remain available.

Also partition all-test gain into routed and fallback targets. Separately record
how often supported training type winners retain their test type-Brier lead.
That retention statistic describes drift; it never selects eligible pairs.

## 2. Incremental predictive information

Fit nested, regularized logistic models separately for every pair direction.
Let s be the selected model's probability, o the other probability, and
z=logit(clip(p, 1e-6, 1-1e-6)). The baseline has offset z_s and features:
intercept, z_s/4, hinge functions max(z_s-k,0)/4 at fixed k=-2,0,2, and seven
event-type indicators. Unknown types have all indicators zero. The joint model
adds (z_o-z_s)/4 to exactly the same baseline. These flexible single-forecast
controls reduce the chance of calling simple single-forecast miscalibration
incremental information. They do not identify an unrestricted conditional law.

Minimize event-weighted training log loss plus 0.005/2 times squared coefficient
norm; the intercept penalty multiplier is 0.1. Zero coefficients reproduce
the clipped selection forecast. Use deterministic damped Newton updates with
gradient tolerance 1e-8; verify convergence independently. No validation or
test result tunes regularization. Report held-out Brier differences, pair win
rates, and all ten direction means. A lower joint score supports incremental
predictive usefulness under this model, not independence of internal evidence.

As a descriptive primary-direction cross-check, match observations within each
pair, exact event type, and selected-probability bin of width 0.1. Compare
o-s ≥0.1 with o-s ≤-0.1. Retain cells with at least five distinct test events
on each side, based on support only. Report high-minus-low outcome frequency,
selected forecast, and residual y-q_single from the training-fitted flexible
baseline. Weight matched cells by harmonic overlap mass 2*m_high*m_low /
(m_high+m_low), then average defined pairs equally. Export pair coverage and
matched-cell counts. Coarse matching and support restrictions make this a
descriptive check, not a causal test or an exact conditioning argument.

## 3. Calibration, averaging, and extremization controls

Evaluate on identical test support:

- Original type selection and the four unchanged fixed pooling formulas.
- Calibrated selection: offset z_s plus intercept and z_s/4, using the same
  training loss and penalty as above.
- Flexible type-adjusted selection and its nested joint model from section 2.
- Training convex pool: alpha*p_A+(1-alpha)*p_B, with alpha in [0,1] minimizing
  event-weighted training Brier by the closed-form quadratic solution. Exact
  prediction ties use alpha=0.5.
- Extremized convex pool: freeze alpha, then choose gamma from 1,1.05,...,2
  minimizing training Brier of sigmoid(gamma*logit(clipped convex pool)). Ties
  choose the smaller gamma. Gamma=1 nests the clipped convex pool; clipping's
  numerical difference from the original convex pool is bounded and reported.

For EC versus log-odds mean, and extremized versus convex pool, attribute gains
to the same confidence groups and inspect signed calibration gaps. Agreement
does not imply independent evidence, and raising confidence is beneficial only
when warranted by outcomes. Calibrated controls and added-predictor controls
are separate diagnostics; their gains are not an additive causal mediation.

## Exports and verification

Publish aggregate summaries for every existing filter, ten direction results,
primary pair details including fitted coefficients, matching support, and
confidence decompositions, a report, source hashes, and an audit. Independently
reconstruct selected primary predictions, event means, group contributions,
and optimizer gradients without calling the corresponding scoring helpers.
Test group boundaries, event weighting and additivity, training-only fitting,
matching support, predictive-signal recovery, and behavior with duplicate
forecasts. Existing published experiment files remain unchanged.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
