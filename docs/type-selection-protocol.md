# Type-based model selection: two test scopes

Protocol fixed on 2026-09-07 before computing the new method's test scores.

## Question and inputs

Among exact configuration pairs with similar overall training ability and
crossed event-type strengths, does choosing a model by historical event-type
performance beat Simple mean, Log-odds mean, EC (w = 0.56), or Piecewise odds?

Use the frozen `complementarity_all_configurations_event_weighted_2026-09-05`
panel, seven-domain taxonomy, exact configuration identities, and all five
event-cluster split seeds (20260910–20260914) in both directions. The primary
direction is 20260910 A→B. These are event-disjoint internal archive holdouts,
not chronological future-event tests. No archived artifact is modified.

## Pair and category selection

Use the existing experiment's common-target support, at least 100 training
and 100 test events, training Overall BI gap ≤3 (main) or ≤5 (sensitivity), at
least two types with ≥30 training events, and supported-type training event
mass ≥50% (with the existing 60%, 70%, 80% sensitivity controls). Retain only
crossed-strength pairs: each model must lead by ≥1 training BI point in at
least one different supported type. Preserve all exact-configuration, different
model version, and matched prompt/information scopes.

For each retained pair, the complementary types are **all** supported types
with an absolute training BI gap ≥1; they are not limited to the two largest
opposite edges shown in the original profile. No test score, test category
margin, or persistence condition determines membership.

## Frozen prediction rule

For each type with ≥30 common training events, choose the model with lower
event-equal training Brier score. This includes supported types whose BI gap
is below 1. On a new target of that type, output that model's original
probability with a 0/1 choice and no probability averaging or recalibration.

For absent, unlabeled, or sparse training types, or a category Brier tie within
1e-12, choose the pair's lower Overall training-Brier model. An Overall tie
within 1e-12 chooses the lexicographically earlier exact configuration name.
The entire routing map is fitted once per training fold and used unchanged
in both test scopes. Test outcomes are supplied only to scoring.

## Two nested test scopes

1. **Complementary events only:** the pair's common test targets whose type
   belongs to the training-selected complementary types.
2. **All test events:** every common test target for that pair, including
   other, sparse, and unlabeled types. Nothing is dropped for lacking a route.

Both scopes use the same trained router and model pair. The first is a subset
of the second. Every method and single-model reference uses identical targets
within each scope. Empty scopes have null scores and an explicit support
count; they are never replaced with zeros or selected on performance. Do not
require both historical specialists to retain their lead in the test set.

## Metrics and comparisons

Within each evaluation scope, average squared errors within each event, then
equally across events. BI = 100 × (1 − sqrt(Brier score)), transformed once
per pair/scope. ECE is separately calculated from target-weighted probability
and outcome rows using ten equal-width bins [0, 0.1), …, [0.9, 1]. Archived
difficulty offsets do not enter any reported metric.

Compare Type-based selection directly with the four fixed formulas. Keep
Model A, Model B, and the Overall training-selected single as references. The
better test single is a hindsight reference chosen by Brier score on the
current test scope; it is not a deployable selection rule. ECE of that reference
refers to the same Brier-selected single, not a separately ECE-selected oracle.

Cohort summaries give each defined model pair equal weight. Report absolute
mean scores, mean routing gain versus each formula, pair win fractions (strict
gain >1e-10), support and complementary/fallback coverage. For Brier and ECE,
routing gain is comparator minus routing; for BI it is routing minus comparator.
No claim of statistical significance is made from treating overlapping model
pairs or the ten split directions as independent observations. Publish all ten
direction summaries as stability checks, with no direction selected by outcome.

## Validation and publication

Hash the panel, identities, events, frozen pair results, and this protocol.
Reconstruct training eligibility and compare all-event fixed-formula BI/Brier
scores with the existing frozen results. Independently reconstruct sampled
primary routing scores using event-level grouped means and separately written
formulas. Test outcome invariance of the fitted map, nested masks, tie/sparse
fallback, empty scopes, and unequal-target event weighting. Publish the code,
protocol, primary pair results, all direction summaries, and audit.

Derived from ForecastBench by the Forecasting Research Institute, under
CC BY-SA 4.0. This retrospective extension is descriptive internal evidence.
