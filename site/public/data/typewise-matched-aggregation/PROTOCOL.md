# Event-type matched aggregation without explicit calibration

2026-09-08. This exploratory follow-up is fixed before computing the new
event-type-weight results. Existing global-weight Brier and ECE results have
already been inspected, so this is not a fresh confirmatory study.

## Question and unchanged population

Ask whether replacing the single global matched-aggregation coefficient with
event-type-specific coefficients improves held-out Brier and ECE without adding
an intercept, calibration slope, spline, event-type probability offset, or
post-hoc calibration layer.

Reuse the frozen 2026-09-05 panel, genuine common forecasts, exact configuration
pairs, training router, crossed training strengths, Overall training BI gaps
3/5, coverage thresholds 50/60/70/80%, three identity scopes, and ten fixed
event directions from the published no-calibration experiment. The primary
direction remains seed 20260910, A to B. All methods use identical train/test
events, test targets, router choices, and scope masks.

The main cohort is selected entirely from training information. Also report a
post-hoc no-reversal partition for direct comparison with the later stability
analysis. Test outcomes may label that diagnostic partition, but never select
a coefficient, method, threshold, pair in the main cohort, or reporting
direction.

## Methods

Let `s` be the raw probability from the training-selected model and `o` the raw
probability from the other model. Their roles may switch by event type. Let

`z_s = logit(clip(s, 1e-6, 1-1e-6))`

and `x = (logit(o) - z_s) / 4`.

Compare three methods:

1. Raw type selection: `q = s`.
2. Global matched aggregation: `q = sigmoid(z_s + beta*x)`, using the already
   published one-coefficient training objective.
3. Event-type matched aggregation: `q = sigmoid(z_s + beta_g*x)`, where `g` is
   the exact seven-domain event type when that type has at least 30 distinct
   training events. All remaining sparse, empty, or unseen types share one
   fallback group.

Fit the event-type coefficients on the full common training fold only by
minimizing

`sum_i w_i * logloss(y_i, q_i) + 0.005/2 * sum_g beta_g^2`,

where `w_i` gives every training event equal total weight across the complete
training fold. Do not renormalize weights within an event type; consequently,
coefficients for smaller groups receive stronger effective shrinkage toward
zero, which is raw type selection. Coefficients are unrestricted. If a group
has no varying predictor, use zero. If no fallback-group observations exist,
unseen test types use the fitted global coefficient.

This is an aggregation-only interaction: replacing `o` with `s` sets `x=0`
and reproduces the selected probability up to the documented clipping error.
No coefficient can shift a prediction without a second distinct forecast.

## Endpoints and reporting

Brier averages common targets within each event, events equally within each
pair/test scope, and eligible pairs equally. ECE is target-weighted within each
pair/scope with the existing ten equal-width bins and numerical assignment
`min(9, floor(10*p))`.

Report both all common test events and training-defined complementary event
types. For each method report mean Brier, ECE, gain versus raw selection, pair
win share, same-formula duplicate gain, and positive directions out of ten.
Retain every negative result. The ten directions and configuration pairs share
events and models and are not independent replications; do not report naive
significance.

## Verification and artifacts

Record hashes for the frozen inputs, this protocol, implementation, independent
audit, and reused source files. Before the full run, test opposite type-specific
signals, sparse-type fallback, duplicate invariance, event weighting, optimizer
gradients, and prediction immutability under changed test outcomes.

Independently reconstruct sampled primary predictions, event-equal Brier,
target-weighted ECE, duplicate predictions, and first-order conditions. Export
all-direction scores, primary pair fits, all requested filtered views, an audit,
and a concise report.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
