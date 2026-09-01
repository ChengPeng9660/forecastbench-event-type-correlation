# Existing aggregation methods under near-skill category complementarity

## What changed

Category-shrunk aggregation is not used in this result. Event type and question
source/platform only identify model pairs with similar overall training ability
and different category strengths. Aggregation then uses one of five existing
methods unchanged: Simple mean, Log-odds mean, EC (`w = 0.56`), Piecewise odds,
or Directional CF.

The default result uses Directional CF. Its two sign-specific weights are fit on
the whole training fold and applied unchanged to the opposite event-disjoint
test fold. Category labels do not enter the aggregation formula.

## Main results

The table reports mean test BI gain over the better of the two single models on
the same targets, followed by the fraction of pairs that beat both. The cohort
requires crossed training strengths, at least 50% supported category row mass,
and the stated overall training BI-gap limit.

| BI-gap limit | Grouping | Method | Mean BI gain | Beats both |
|---:|---|---|---:|---:|
| 3 | Event type | Directional CF | **+0.748** | **92.0%** |
| 3 | Event type | Log-odds mean | +0.227 | 67.7% |
| 3 | Event type | Simple mean | +0.205 | 67.3% |
| 3 | Event type | EC · w = 0.56 | +0.145 | 60.6% |
| 3 | Event type | Piecewise odds | +0.051 | 53.5% |
| 3 | Question source/platform | Directional CF | **+0.434** | **86.3%** |
| 3 | Question source/platform | Log-odds mean | +0.178 | 64.6% |
| 3 | Question source/platform | Simple mean | +0.107 | 61.3% |
| 3 | Question source/platform | EC · w = 0.56 | +0.091 | 56.3% |
| 3 | Question source/platform | Piecewise odds | -0.071 | 43.3% |
| 5 | Event type | Directional CF | **+0.758** | **91.7%** |
| 5 | Event type | Log-odds mean | +0.179 | 66.0% |
| 5 | Event type | Simple mean | +0.129 | 64.3% |
| 5 | Event type | EC · w = 0.56 | +0.100 | 59.3% |
| 5 | Event type | Piecewise odds | +0.017 | 52.3% |
| 5 | Question source/platform | Directional CF | **+0.399** | **85.1%** |
| 5 | Question source/platform | Log-odds mean | +0.083 | 57.4% |
| 5 | Question source/platform | EC · w = 0.56 | +0.004 | 50.1% |
| 5 | Question source/platform | Simple mean | -0.017 | 54.3% |
| 5 | Question source/platform | Piecewise odds | -0.147 | 38.8% |

For the gap-3 event-type cohort, Directional CF is positive in all ten fixed
event directions. The primary direction contains 226 eligible crossed-strength
pairs. The corresponding question-source/platform cohort contains 432 pairs.

The crossed-strength screen is associated with stronger Directional CF results
than the full near-skill cohort in the same archive. At gap 3, mean BI gain is
`+0.748` versus `+0.507` for event type and `+0.434` versus `+0.367` for question
source/platform. This comparison supports the screen as a useful descriptive
selection signal, but it is not randomized evidence that category
complementarity caused the gain.

## Interpretation

The experiment supports a careful claim: after controlling overall training
ability, models with crossed category strengths can form a strong aggregation
cohort, especially when combined by the existing train-fitted Directional CF
rule. It does not show that category-aware weighting is responsible, because no
category-aware aggregation is used here. It also does not show that the current
category metric is a fully validated universal diversity metric.

Every common target receives equal row weight, so the empirical mixture is
Dataset-dominated. Official question-difficulty offsets remain in adjusted
Brier and BI. The event splits are internal holdouts from an archive that has
been examined repeatedly. The next confirmatory test should freeze models,
thresholds, category definitions, and Directional CF before evaluating genuinely
new events.
