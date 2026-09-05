# Category complementarity with event-equal scoring

## Scoring update and audit

This run recomputes the full exact-configuration study under the paper's new
score definition. For each event, it first averages squared errors across the
evaluated targets and then averages equally across events. The reported Brier
Index is

`BI = 100 * (1 - sqrt(BS))`,

applied once to the event-averaged ordinary Brier score. Archived question
fixed effects remain available as provenance diagnostics but do not enter BS,
BI, gains, pair selection, category profiles, stability screens, or the
Directional-CF training objective. ECE remains a separate target-weighted,
ten-bin calibration diagnostic.

The panel contains 313 exact configurations from 96 model versions, 1,273,203
genuine scored forecasts, 26,531 targets, and 3,670 event clusters. Across
48,828 unordered configuration pairs, 135,960 directions passed the basic
support check. The training BI-gap-5 rule retained 108,437 directions, yielding
216,874 direction-by-grouping rows. No train/test event overlap was found.

An independent implementation reconstructed 80 primary rows, including all
five aggregation formulas and the category-complementarity coordinate. Its
maximum absolute error was `3.55e-14`, below the prespecified `2e-11`
tolerance. Numerical equality with the earlier target-weighted run is not an
audit objective because the score definition has intentionally changed.

## Primary results

The primary view trains on fold A of split `20260910` and evaluates on fold B.
It requires at least 50% supported category event mass, crossed training
strengths, and a training BI gap no larger than 3. Gain is measured against the
better single configuration on identical held-out support.

| Pair scope | Grouping | Method | Pairs | Mean BI gain | Beats both |
|---|---|---|---:|---:|---:|
| All exact configurations | Event type | Directional CF | 2,431 | **+1.427** | **96.6%** |
| All exact configurations | Source/platform | Directional CF | 3,181 | **+0.850** | **93.7%** |
| Different model versions | Event type | Directional CF | 2,334 | **+1.416** | **96.6%** |
| Different model versions | Source/platform | Directional CF | 3,118 | **+0.849** | **93.6%** |
| Same prompt and information condition | Event type | Directional CF | 624 | **+0.941** | **96.6%** |
| Same prompt and information condition | Source/platform | Directional CF | 1,065 | **+0.600** | **91.2%** |

The different-model-version estimates are nearly identical to the unrestricted
estimates, so same-version pairs do not explain the result. Matching prompt and
information conditions lowers the mean gain but leaves it positive in both
groupings.

## Existing methods under matched conditions

| Grouping | Method | Pairs | Mean BI gain | Beats both |
|---|---|---:|---:|---:|
| Event type | Simple mean | 624 | +0.228 | 70.5% |
| Event type | Log-odds mean | 624 | +0.347 | 76.1% |
| Event type | EC, w = 0.56 | 624 | +0.358 | 75.3% |
| Event type | Piecewise odds | 624 | +0.337 | 71.6% |
| Event type | Directional CF | 624 | **+0.941** | **96.6%** |
| Source/platform | Simple mean | 1,065 | +0.165 | 65.9% |
| Source/platform | Log-odds mean | 1,065 | +0.287 | 72.6% |
| Source/platform | EC, w = 0.56 | 1,065 | +0.266 | 69.7% |
| Source/platform | Piecewise odds | 1,065 | +0.167 | 58.4% |
| Source/platform | Directional CF | 1,065 | **+0.600** | **91.2%** |

The aggregation formulas are unchanged. Category labels select and describe
pairs but never enter an aggregation formula. Directional CF fits its two
coefficients using event-equal training loss and applies them unchanged to the
held-out events.

## Contribution of the category signal

Among matched-condition, gap-3 pairs, the full near-skill cohort has mean
Directional-CF gains of `+0.727` BI for event type and `+0.491` BI for source.
Restricting to crossed training strengths raises the means to `+0.941` and
`+0.600`, respectively. Training `D_type` has Pearson correlations of `0.377`
and `0.344` with held-out gain. Its correlations with the training BI gap are
`-0.224` and `-0.274`, while its correlations with mean training BI are
`-0.212` and `-0.097`.

These comparisons show that the category signal contains information beyond
the overall training-gap screen, while absolute ability remains related to the
size of the gain. In the highest-ability quartile, event-type and source pairs
still average `+0.422` and `+0.394` BI, compared with `+1.924` and `+0.769` in
the lowest-ability quartile.

## Transfer and sensitivity

Among matched-condition pairs with adequate held-out support in both selected
categories, 68.9% of event-type pairs and 56.4% of source pairs retain both
training advantages. Requiring those two category advantages and a positive
whole-test gain gives rates of 42.4% and 24.7%. The whole-test aggregation
endpoint therefore transfers more consistently than the names of the two
specialist categories.

Widening the training BI-gap limit from 3 to 5 yields `+0.959` BI with a 96.4%
beat-both rate for 667 matched-condition event-type pairs. The corresponding
source result is `+0.556` BI with an 88.8% rate for 1,201 pairs. Directional-CF
mean gain is positive in all ten fixed event directions for both groupings and
all three pair scopes.

The study supports a descriptive conclusion: after controlling for similar
training ability, crossed category strengths identify exact-configuration
pairs with stronger held-out aggregation outcomes in this archive. Reused
events, models, and pairs make the ten directions stability views rather than
independent replications. A prospectively frozen future sample is still needed
for external confirmation.
