# Category complementarity across all exact ForecastBench configurations

## Expansion and audit

The earlier study was restricted to 94 zero-shot, no-extra-information
configurations. This run removes that restriction while preserving identity:
model version, prompt, and information condition are separate fields and are
never collapsed.

The expanded panel contains 313 exact configurations from 96 model versions,
1,273,203 genuine scored forecasts, 26,531 targets, and 3,670 event clusters.
It contains every one of the earlier 94 configurations and every one of the 238
configurations in the site's Polymarket analysis, plus 75 configurations that
have usable support on other ForecastBench sources.

Across 48,828 unordered configuration pairs, 135,960 event directions passed
the basic support check. The training BI-gap-5 rule retained 110,592 directions,
or 221,184 direction-by-grouping rows. No train/test event overlap was found.

An independent implementation reconstructed 80 primary rows, including the
five aggregation formulas and the category complementarity coordinate. Its
maximum absolute error was `3.98e-13`. All 25,580 rows from the earlier
restricted experiment were also joined by exact configuration names and
reproduced within the same bound.

## Primary results

The table uses the primary A-to-B direction, at least 50% supported category
row mass, crossed training strengths, and a training BI gap no larger than 3.
Gain is relative to the better single configuration on the same test targets.

| Pair scope | Grouping | Method | Pairs | Mean BI gain | Beats both |
|---|---|---|---:|---:|---:|
| All exact configurations | Event type | Directional CF | 2,449 | **+1.359** | **96.6%** |
| All exact configurations | Source/platform | Directional CF | 3,126 | **+0.657** | **90.7%** |
| Different model versions | Event type | Directional CF | 2,333 | **+1.340** | **96.4%** |
| Different model versions | Source/platform | Directional CF | 3,053 | **+0.650** | **90.5%** |
| Same prompt and information condition | Event type | Directional CF | 582 | **+0.901** | **94.0%** |
| Same prompt and information condition | Source/platform | Directional CF | 989 | **+0.488** | **87.5%** |

The different-version result is almost unchanged, so pairs made from two
conditions of the same model version do not explain the aggregate finding.
Matching prompt and information condition reduces the magnitude but leaves a
positive result. Condition differences therefore amplify the broad result, but
they are not required for it.

## Existing-method comparison under matched conditions

| Grouping | Method | Pairs | Mean BI gain | Beats both |
|---|---|---:|---:|---:|
| Event type | Simple mean | 582 | +0.192 | 64.9% |
| Event type | Log-odds mean | 582 | +0.266 | 68.9% |
| Event type | EC, w = 0.56 | 582 | +0.220 | 65.6% |
| Event type | Piecewise odds | 582 | +0.190 | 61.2% |
| Event type | Directional CF | 582 | **+0.901** | **94.0%** |
| Source/platform | Simple mean | 989 | +0.094 | 60.2% |
| Source/platform | Log-odds mean | 989 | +0.215 | 66.5% |
| Source/platform | EC, w = 0.56 | 989 | +0.173 | 62.0% |
| Source/platform | Piecewise odds | 989 | +0.077 | 51.8% |
| Source/platform | Directional CF | 989 | **+0.488** | **87.5%** |

All five formulas are unchanged. Categories select and explain pairs but never
enter a formula.

## What the category signal adds

Within the matched-condition, gap-3 sample, every near-skill eligible pair has
mean Directional-CF gain `+0.642` BI for event type and `+0.400` for source.
Restricting to crossed training strengths raises these means to `+0.901` and
`+0.488`. The training `D_type` coordinate has Pearson correlations of `0.404`
and `0.244` with held-out Directional-CF gain. Its correlations with the
training ability gap are only `-0.133` and `-0.121`, respectively.

This supports `D_type` as a more targeted screening signal than raw forecast
spacing: it is constructed from which configuration has the error advantage in
each category after an overall ability-gap restriction. It is not independent
of absolute ability. Its correlation with mean training BI is `-0.296` for
event type and `-0.069` for source, and the largest gains occur among weaker
pairs.

The strongest ability quartile still has positive matched-condition results:
event-type crossed pairs average `+0.322` BI with a 94.1% win rate, while source
pairs average `+0.273` BI with an 83.5% win rate. The magnitude is smaller than
in the weakest quartile (`+1.775` and `+0.748`). This directly confirms that
base ability remains an important axis alongside complementarity.

## Transfer of the named category strengths

The whole-test endpoint is stronger than the category-by-category transfer
claim. Among matched-condition event-type pairs with enough test support in
both selected categories, 75.5% retain both training advantages and 44.8% have
Directional CF beat the better test configuration in both categories and over
the whole test set. For source/platform, the corresponding rates are 54.5% and
17.7%.

Thus the source grouping is useful as a broad screening association, but its
specific named strengths transfer much less reliably than event-type strengths.

## Sensitivity and interpretation

For matched conditions, widening the training BI-gap limit from 3 to 5 gives
`+0.921` BI and a 93.2% win rate for event type (636 pairs), and `+0.440` BI and
an 85.2% win rate for source (1,177 pairs). Directional-CF mean gain is positive
in all ten fixed event directions for both groupings and all three pair scopes.

The evidence supports the following claim: after enforcing similar overall
training ability, crossed category strengths and the training-only `D_type`
coordinate identify configuration pairs with stronger held-out aggregation
outcomes, including when prompt and information conditions are matched. The
evidence does not establish a universal or causal diversity metric. Models,
questions, and pairs repeat across directions; the archive has been explored
repeatedly; and a genuinely untouched future sample is still required.
