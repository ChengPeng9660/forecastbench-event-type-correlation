# Event-type matched aggregation without explicit calibration

2026-09-09. Protocol version: `20260909-normalized-ridge`.
Method version: `type_normalized_ll_ridge_v1`.

This revision promotes the retained `ll_type_normalized` variant following
exploratory evaluation of the existing historical holdout. The algorithm
variant was selected after inspecting those results; it is not a fresh
confirmatory study. Every individual coefficient still uses training data
only. The original 2026-09-08 artifacts remain a separate archived method.

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
an individual coefficient, threshold, pair in the main cohort, or reporting
direction. The choice of the algorithm variant is the exploratory decision
disclosed above.

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
   training events. Sparse, empty, and unseen types use the unchanged global
   matched coefficient. No pooled fallback coefficient is fitted.

Fit each supported event-type coefficient independently on that type's
common training events by minimizing

`sum_{i: type(i)=g} w_{i|g} * logloss(y_i, q_i) + 0.005/2 * beta_g^2`,

where the weights sum to one **within the type**. Each type's events receive
equal total weight, and each event's weight is divided equally among its
targets. Call the same scalar ridge-logistic solver used by the global fit
on these type-restricted arrays. The coefficient on the raw logit difference
is `lambda_g = beta_g/4`; thus the penalty is equivalently
`0.08/2 * lambda_g^2` for every type and for global. It does not become
`0.08/W_g` for a type with training mass `W_g`.

Coefficients remain unrestricted; no intercept or calibration slope is
estimated. A type with no varying predictor receives zero. The global fit
continues to use the complete common training fold with event-equal weights
and its existing ridge value. Selection, filtering, split directions, score
definitions, and the global predictions are unchanged.

Apply this rule to every exported filter and all ten directions, including
all-pair and post-hoc stability partitions, rather than replacing only the
default no-reversal summary. Indexes, views, coefficient records, and audit
metadata carry the method and protocol versions above. The fit's `objective`
field is the sum of the supported types' independently normalized penalized
objectives; it excludes the separate global fallback fit.

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
