# Uniform-target category aggregation with BI-gap limits 3 and 5

## Result in one sentence

With every common forecast target weighted equally, Category-shrunk aggregation
beats the hindsight-better test single model on average for both event-type and
question-source groupings at training BI-gap limits 3 and 5. The newly admitted
gap-3-to-5 pairs remain positive on average but weaken the aggregate result.

This is a sensitivity estimand dominated by Dataset rows. It is not a replacement
for the preceding Dataset/Market-balanced result.

## What changed

- Dataset and Market no longer receive equal total mass. A pair with `n` common
  targets assigns each target weight `1/n`.
- The training adjusted-BI eligibility limits are evaluated separately at 3 and
  5. Test BI gaps never enter pair selection.
- The first endpoint is whole-test Category-shrunk BI minus the higher of the two
  test single-model BIs. Positive values therefore mean aggregation beats both
  constituents on the same targets.
- Gain versus the training-selected single is reported as the deployable
  reference. Category-shrunk minus Global-convex is retained as the secondary
  category-information increment.

Everything else remains fixed: exact plain-zero-shot/no-extra-information model
configurations, event-cluster splits, minimum 100 train/test events, minimum 30
training events per fitted category, crossing selection from training only, and
`n/(n+100)` shrinkage toward a train-fitted global convex coefficient.

## Primary split, at least 50% supported training mass

The cohort below requires crossed training strengths: model A leads by at least
1 conditional BI point in one category and model B leads by at least 1 point in
another category.

| Train BI gap | Grouping | Pairs | Category-shrunk minus better test single BI | Conditional 95% interval | Beats both | Gain vs train-selected single | Category-shrunk minus global BI |
|---:|---|---:|---:|---:|---:|---:|---:|
| <=3 | Event type | 226 | +0.509 | [+0.376, +0.646] | 92.0% | +0.718 | +0.162 |
| <=3 | Question source/platform | 432 | +0.419 | [+0.308, +0.525] | 89.8% | +0.548 | +0.116 |
| <=5 | Event type | 241 | +0.490 | [+0.359, +0.625] | 90.5% | +0.686 | +0.164 |
| <=5 | Question source/platform | 505 | +0.388 | [+0.281, +0.489] | 88.9% | +0.499 | +0.119 |

The corresponding mean reductions in raw Brier loss versus the better test
single are 0.004245, 0.003518, 0.004091 and 0.003246 in table order. Thus the BI
result is not only a consequence of reporting the nonlinear BI transformation.

The stringent endpoint uses the hindsight-better test constituent. The interval
conditions on the observed training-selected cohort and the observed identity of
that reference model. It shares event multipliers across overlapping pairs but
does not account for all prior archive, threshold and method exploration.

## What relaxing 3 to 5 adds

At 50% coverage, the gap-5 analysis adds 15 event-type pairs and 73 source pairs
whose training BI gaps are in `(3,5]`.

| Newly admitted ring | Pairs | Mean gain vs better test single | Beats both | Category increment over global |
|---|---:|---:|---:|---:|
| Event type | 15 | +0.205 | 66.7% | +0.197 |
| Question source/platform | 73 | +0.200 | 83.6% | +0.136 |

These added pairs are still positive on average, but they are less reliable than
the gap-3 cohort. This is why the full gap-5 averages are slightly lower. The
experiment supports using 3 as the cleaner main sensitivity and 5 as a wider
robustness check, rather than treating 5 as automatically preferable.

## Stability across fixed event splits

All ten pre-existing random event directions are positive for the whole-test
Category-shrunk gain and for its increment over Global-convex.

| Train BI gap | Grouping | Mean across 10 directions | Direction range | Mean beats-both rate | Mean category increment |
|---:|---|---:|---:|---:|---:|
| <=3 | Event type | +0.506 | [+0.441, +0.607] | 91.5% | +0.142 |
| <=3 | Question source/platform | +0.417 | [+0.360, +0.503] | 89.6% | +0.107 |
| <=5 | Event type | +0.493 | [+0.430, +0.597] | 90.8% | +0.145 |
| <=5 | Question source/platform | +0.390 | [+0.342, +0.464] | 89.7% | +0.112 |

The ten directions reuse events, models and model pairs. They are stability views,
not ten independent replications.

## Is crossed category strength doing anything?

At 50% coverage in the primary split, Category-shrunk gains are larger in the
training-crossing cohort than among all ability-eligible pairs:

| Train BI gap | Grouping | All eligible | Crossed strengths |
|---:|---|---:|---:|
| <=3 | Event type | +0.315 | +0.509 |
| <=3 | Question source/platform | +0.327 | +0.419 |
| <=5 | Event type | +0.274 | +0.490 |
| <=5 | Question source/platform | +0.294 | +0.388 |

This comparison is consistent with useful category organization, but it is not a
causal contrast. Crossing pairs may differ in model identity, disagreement and
other training properties. The preceding matched and label-control warnings
still apply.

## Consequence of removing origin balancing

Under uniform target-row weights, Dataset rows receive about 92.3% of training
mass in the event-type crossing cohort and about 91.1% in the source crossing
cohort. Previously Dataset and Market each received 50% total mass when both were
present.

This explains two important changes:

1. Event-type coverage is much less restrictive because topic labels are much
   more complete among Dataset rows. At 80% uniform-row coverage the primary
   event-type cohort has 122 pairs at gap 3 and 126 at gap 5, but only two have a
   complete test profile with at least 30 test events in every retained category.
2. The result now answers performance on the empirical target-row mixture, which
   is dominated by Dataset questions. It does not give equal scientific priority
   to Market performance.

The 80% whole-test gains remain positive because unsupported categories use the
predeclared global fallback. They should not be interpreted as strong evidence
that every selected category specialist transfers on Market questions.

## Method comparison

At gap 3 and 50% coverage, Directional CF gains +0.748 BI for event type and
+0.434 BI for question source, while Category-shrunk gains +0.509 and +0.419.
Thus Category-shrunk clearly beats both single models on average, but it is not
the best method in every view. Hard category routing is markedly weaker; regularized
partial pooling is doing important work.

## Audit

- 4,371 unordered model pairs were considered.
- 12,790 pair directions passed support and the maximum gap-5 gate, yielding
  25,580 dimension-specific rows and 90,364 category profiles.
- Train and test share no event cluster; no test BI gap enters selection.
- The gap-3 cohorts are exact subsets of the gap-5 cohorts.
- Four output contract tests pass.
- An independent implementation reconstructed 80 primary rows. Maximum absolute
  error across train gap, single BIs, Global-convex BI, Category-shrunk BI,
  whole-test gain, category increment and coverage was below `8e-14`.

## Current interpretation

The direct answer to the requested first question is yes: under uniform target
weights, category-shrunk aggregation generally exceeds both individual models in
this internal event-holdout archive, for both BI-gap limits 3 and 5.

The safer scientific interpretation is narrower. Much of the benefit already
comes from global blending, the no-balance estimand is strongly Dataset-dominated,
and the model-pair archive has been repeatedly studied. This sensitivity supports
the practical aggregation result; it does not by itself establish that semantic
category complementarity is a universally transferable diversity measure.
