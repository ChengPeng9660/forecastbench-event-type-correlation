# Unweighted category-complementarity sensitivity

## Requested changes

This is a new sensitivity experiment. It does not overwrite the frozen
`specialization_argument_2026-08-31` package.

1. Every common forecast target receives weight `1 / n`. Dataset and Market are
   not forced to receive equal total weight. Existing per-target official scoring
   offsets remain in adjusted Brier and BI.
2. Training overall adjusted-BI eligibility is evaluated separately at absolute
   gaps `<= 3` and `<= 5`. No test BI gap enters selection.
3. The first endpoint is whole-test Category-shrunk BI minus the better of the
   two test single-model BIs on identical targets. A positive value means that
   category aggregation beats both constituent models. Gain versus the
   training-selected single model is a deployable secondary reference.
4. Category-shrunk minus Global-convex BI is retained as a mechanism endpoint,
   rather than used as the first performance result.

## Fixed design

- Input: 94 genuine plain-zero-shot, no-extra-information configurations from
  the frozen preceding package. Imputed or repaired predictions remain excluded.
- Categories: event type and question source/platform, analyzed separately.
- Splits: five fixed event-cluster splits (`20260910` through `20260914`), both
  directions. Primary view: `20260910`, train fold 0. No seed search.
- Support: at least 100 unique events in each train/test half; a fitted category
  needs at least 30 unique training events. Unknown or unsupported categories
  use the global fitted weight.
- Crossing cohort: training data must contain an A-favored and a B-favored
  category, each separated by at least 1 conditional adjusted-BI point.
- Coverage: 50%, 60%, 70% and 80% uniform-row training-mass thresholds are all
  reported. The lower thresholds remain sensitivity views.
- Category-shrunk weights use the unchanged `n / (n + 100)` shrinkage toward a
  train-fitted global convex weight. Test outcomes never fit a coefficient.
- Original aggregation methods and the preceding balanced-weight results are not
  modified.

## Interpretation

The stringent whole-test endpoint compares against the hindsight-better test
single. It is descriptive but directly answers whether aggregation exceeded both
models. The train-selected-single endpoint is deployable but can be easier to
beat when the selected model is not the stronger test model.

Conditional event-cluster multiplier intervals reuse one multiplier for every
occurrence of an event across overlapping model pairs. They condition on the
training-selected cohort and do not account for all model, threshold, metric or
archive exploration.
