# Global dependence and rank-stability baseline

## Research questions

This experiment adds the non-topic baseline needed to interpret the existing
event-type results. It asks four separate questions:

1. What are the three pair-dependence metrics when targets are pooled without
   splitting by semantic event type?
2. Does the global ordering of model pairs carry over to a specific topic?
3. For a fixed focal model, does its ordering of candidate partners carry over
   to a specific topic?
4. Is the global ranking of individual-model forecasting ability stable within
   a specific topic?

The fourth question is a control. Individual-model BI rank and model-pair
dependence rank are different estimands and are never combined.

## Clean exact-model universe

The analysis uses exact model/configuration names. `LLM Crowd` geometric-mean,
geometric-mean-log-odds, and median aggregates are explicitly excluded before
the model and unordered-pair universes are constructed. The release audit
records their exact names, input row counts, and source-file counts. The clean
release is expected to contain 263 exact models and 34,453 unordered pairs.

No family collapsing is performed in this experiment. Consequently, prompt,
news, and freeze-value variants remain distinct models.

## Global scopes

Two prespecified global scopes are computed directly from target-level adjusted
Brier losses:

- `official_full`: all scored official ForecastBench targets. Taxonomy matching
  is checked as an integrity condition in this frozen release, but semantic
  eligibility is not an inclusion condition for this scope.
- `seven_topic_union`: the union of targets with
  `topic_analysis_eligible=true` whose topic is one of the seven audited
  semantic topics.

The global metrics are not averages of topic-level metrics. This is necessary
because oracle gain contains a minimum, high-loss lift is a ratio, and Pearson
correlation is nonlinear.

## Pair metrics and eligibility

For each global scope and every unordered clean exact-model pair, metrics use
only identical common targets, keyed by date, source, event ID, and horizon.

- Adjusted POG is the better common-support mean adjusted loss minus the mean
  target-wise oracle minimum.
- High-loss lift uses the strict event `adjusted_brier > 0.25` and reports its
  two marginal rates, joint rate, and joint count. A zero marginal produces a
  null metric with an explicit reason.
- Adjusted-loss correlation is Pearson correlation between the two common-
  support adjusted-loss vectors. Constant vectors produce a null metric with
  an explicit reason.

Pairs require at least 50 common targets. Common-support BI is computed using
the official equal weighting of available Dataset and Market stratum means,
followed by `BI = (1 - sqrt(adjusted_brier)) * 100`. The near-BI sample requires
an absolute common-support BI gap no larger than 2 points.

Every clean pair is retained in the published global pair archive. Ineligible
or undefined results are blank and carry explicit reasons; they are never
silently dropped or imputed.

## Primary leave-topic-out comparison

The primary global-to-topic comparison is `leave_topic_out`. Before comparing
the global ordering with topic `t`, all targets eligible for `t` are removed
from the global baseline and the three pair metrics and individual-model BI are
recomputed. For `seven_topic_union`, this is exactly the union of the other six
topics. For `official_full`, unclassified and other eligible official targets
remain in the baseline.

This prevents a mechanical self-inclusion correlation: an inclusive global
metric partly contains the topic metric it is being compared with. The
`inclusive_global` mode is retained as a sensitivity analysis and must be
described as such.

Leave-topic-out results are derived by exact subtraction of target-level
sufficient statistics for counts, sums, oracle minima, severe-loss counts,
origin-stratified means, variances, and covariance. Each internal leave-topic-
out pair table has a deterministic SHA-256, support counts, near-BI counts, and
defined-metric counts in the audit. The 14 internal tables are not duplicated
as public downloads.

## Global-to-topic pair-rank stability

For each global scope, comparison mode, topic, metric, and sample, the analysis
intersects the exact same unordered pairs that are eligible in both slices.
`near_bi_both` is primary and `eligible_both` is sensitivity. A metric must be
finite in both slices.

The primary statistic is tie-aware Spearman rank correlation. Pearson
correlation is secondary. Dependence-oriented percentiles are computed within
the exact comparison sample: lower POG means greater dependence, while higher
lift and higher loss correlation mean greater dependence. The analysis also
reports top-dependence and top-complementarity quartile Jaccard overlap,
directional persistence, dependency-to-complementarity flips, and the complete
4-by-4 quartile transition counts.

Cells with fewer than 30 defined pairs suppress correlations and quartile
summaries. Cells with 30--99 pairs are `limited`; cells with at least 100 are
`headline`. Constant vectors remain `insufficient` with an explicit reason.

## Focal-model partner-rank stability

For each focal exact model, only its partners are ranked. The same global/topic
intersection and metric orientation rules apply. At least 20 defined partners
are required. Each profile reports Spearman and Pearson correlation, quartile
overlap/persistence/flips, the globally and topically highest-dependence and
highest-complementarity partners, exact top-partner retention, and the global
top partner's percentile in the topic.

This estimand answers whether a model can reuse one global partner ranking. It
does not ask whether the focal model itself has stable forecasting ability.

## Individual-model BI-rank control

Individual-model adjusted Brier and BI are computed separately for each global
scope and topic. Models require at least 50 targets in both compared slices.
The common model set is ranked by BI, and the output reports tie-aware Spearman,
Pearson, top-ability-quartile Jaccard, and directional top-quartile retention.

Because models can cover different target subsets, this is a model-level
descriptive ability ranking rather than a pairwise common-support BI test.

## Interpretation limits

All results are descriptive. Model-pair observations share models and are not
independent, so ordinary i.i.d. p-values are not reported. The experiment is
not causal and is not an out-of-sample pair-selection evaluation. Topic slices
may also differ in source, market/dataset composition, dates, release cohorts,
and template structure. Leave-topic-out removes mechanical target overlap but
does not eliminate these sources of confounding.

The appropriate claim is whether global pair, partner, and ability rankings are
more or less stable across audited topic slices. A deployable claim about
topic-conditioned aggregation requires a separate time-split or prospective
selection evaluation.

## Published artifacts

The CLI writes deterministic derived files and mirrors them under
`site/public/data/global-baseline/`:

- `pair-metrics.csv.gz`: the two pooled global pair tables.
- `pair-stability.csv`: global-to-topic pair-rank comparisons.
- `partner-stability.csv.gz` and one compact `partner-profiles/{model_id}.json`
  shard per focal model: full audit rows and lazy browser profiles.
- `partner-summary.csv`: distribution summaries across focal models.
- `model-ability.csv` and `ability-stability.csv`: the BI-rank control.
- `summary.json`, `audit.json`, and `manifest.json`: browser payload,
  reproducibility record, and file hashes.
