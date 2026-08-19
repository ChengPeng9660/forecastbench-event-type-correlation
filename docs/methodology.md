# Methodology: event-type model dependence

## Scope and provenance

This project estimates pairwise dependence among **exact clean-LLM model
names** in three independent slice dimensions. Official ForecastBench
provenance remains separate from the derived taxonomy:

- `origin_type` is the official `Dataset` / `Market` distinction;
- `source` is the official source (`acled`, `dbnomics`, `fred`, `wikipedia`,
  `yfinance`, `infer`, `manifold`, `metaculus`, or `polymarket`);
- `topic_id` is a derived semantic label and must not be presented as an
  official ForecastBench field.

The output dimensions are derived semantic topic, official `origin_type`, and
official source. Semantic-topic slices include only rows where
`topic_analysis_eligible=true`. Origin and source slices retain the complete
official sample, including generic-pair and fallback rows whose semantic topic
cannot be defended.

The audited predecessor implementation is
`run_three_adjusted_pair_metrics_experiment.py`, with the scoring primitives in
`backtest_top2_cpt_official_fx.py`. Its full-sample output contained 23,595
eligible pair-date cells at minimum common support 50. The separate
random-half robustness run contained 47,190 directional cells (two directions
per eligible pair-date cell). Those legacy experiments are **per-date pair-cell
designs**. This repository introduces a different cross-date, pooled
target-level design. The historical counts check provenance and formulas only;
they are neither expected row counts nor direct parity targets for the pooled
slice output.

The existing classified resolved-event table was also audited before this
implementation: it contains 13,661 event-date rows, 13,661 unique
`date + source + event_id` keys, 8,204 unique `source + event_id` events, no
duplicate event-date keys, and no cross-date label conflicts. The new taxonomy
is still required to pass the stricter contract below.

## Data contracts

### Official fixed effects

The fixed-effect JSON is a list of records containing at least:

- `forecast_due_date` (Unix milliseconds or an ISO-like date);
- `source`;
- `id`;
- `horizon` (null for Market targets);
- `question_fixed_effect`.

The official scoring key is:

```text
date + source + event_id + horizon
```

Event IDs are not assumed to be globally unique.

### Processed forecast JSON

Each model file must contain an exact `model` name, optional
`model_organization`, and a `forecasts` list. A scorable forecast record must
have a probability, be resolved to binary 0/1, and match an official
fixed-effect key.

The clean-LLM universe follows the audited predecessor scripts. It excludes:

- ForecastBench baselines;
- `.external.` submissions;
- ensembles and `crowdadj` variants;
- median/public-median forecasts;
- superforecaster rows.

The model identity used for pairing is the exact `model` string, not a family
name. A model name with conflicting organizations fails validation.

### Derived taxonomy CSV

The taxonomy must contain:

```text
date,source,event_id,topic_id,origin_type,official_source,
topic_analysis_eligible,review_required
```

The join key is `date + source + event_id`. Each key must map to exactly one
`topic_id`, one official `origin_type`, one `official_source`, and explicit
eligibility/review booleans. Identical duplicate taxonomy rows are harmless;
conflicting duplicates fail. `origin_type` must be `Dataset` or `Market` and
must agree with the scored panel.

Primary semantic-topic slices exclude `topic_analysis_eligible=false`, which
removes all unrecoverable generic pairs and visible unmatched fallbacks.
Every initial keyword conflict was reviewed at the unique-event level. Eleven
eligible rows remain explicitly `review_required=true` because the resolution
predicate is genuinely cross-domain; `eligible_review_required_rows` is
reported in the audit JSON for sensitivity analysis. Official origin/source
slices do not use semantic eligibility.

The taxonomy does not join on `horizon`: all official horizon variants of one
event-date key inherit the same semantic topic. They remain distinct scored
targets because the metric target key retains `horizon`.

### Scored panel CSV

`analysis/scoring.py` produces:

```text
date,source,event_id,horizon,origin_type,
model_name,model_organization,source_file,
prediction,outcome,raw_brier,question_fixed_effect,
normalization_term,adjusted_brier
```

One row represents one exact model and one official target key. Identical
duplicates are collapsed and counted in the audit JSON. Conflicting duplicates
fail instead of being silently overwritten.

## Official adjusted loss

For target \(k\), model \(i\)'s adjusted Brier loss is

\[
\widetilde L_{ik}
= (p_{ik}-y_k)^2 - \alpha_k + \bar\alpha_{d(k),g(k)},
\]

where \(\alpha_k\) is the official question fixed effect and
\(\bar\alpha_{d,g}\) is the mean fixed effect for forecast date \(d\) and
official origin stratum \(g\in\{\text{Dataset},\text{Market}\}\).

Probabilities are clipped to \([10^{-6},1-10^{-6}]\), matching the audited
implementation.

For BI and near-BI only, adjusted losses are averaged within Dataset and Market
and then averaged equally across whichever of those strata are present:

\[
\operatorname{BI}(i)
=100\left(1-\sqrt{\operatorname{AdjustedBrier}(i)}\right).
\]

This preserves the official scoring aggregation. The three dependence metrics
below remain event-weighted, exactly as in the predecessor experiment.

## Common-support construction

For slice \(s\) and exact models \(i,j\), define common support as the
intersection of their scored target keys after the taxonomy join:

```text
(date, source, event_id, horizon)
```

Only this identical support is used for both models. The output records
`n_overlap`, `n_dates`, date range, sources, and origin strata.

The primary minimum is `n_overlap >= 50`. Pairs below it remain in the output
with blank metrics and one of these explicit reasons:

- `model_missing_in_slice`;
- `no_common_targets`;
- `n_overlap_N_below_min_50`.

The output enumerates every global exact-model-name pair for every retained
topic, both origins, and all nine official sources, so missingness is visible
rather than selected away.

### Repeated events

Within a model, an identical
`date + source + event_id + horizon` target is counted once. The same underlying
`source + event_id` observed on different forecast dates is retained because it
is a distinct forecast snapshot with a distinct official fixed effect. Thus the
analysis removes accidental duplicate rows without pretending that a repeated
event-date forecast is the same observation.

## Three pairwise metrics

All formulas below use slice-specific common support \(C_{ijs}\).

### 1. Adjusted Pairwise Oracle Gain (POG)

\[
\operatorname{POG}_{ijt}
=\min\left(\overline{\widetilde L_i},
           \overline{\widetilde L_j}\right)
-\overline{\min(\widetilde L_i,\widetilde L_j)}.
\]

Higher values indicate more realized per-target complementarity. This is an
oracle diagnostic, not a deployable aggregation rule.

### 2. Adjusted high-loss lift at 0.25

Define severe adjusted loss with a strict threshold:

\[
H_{ik}=\mathbf 1\{\widetilde L_{ik}>0.25\}.
\]

Then

\[
\operatorname{Lift}_{ijt}
=\frac{P(H_i=1,H_j=1)}{P(H_i=1)P(H_j=1)}.
\]

Lower values indicate fewer shared severe losses. If either marginal severe-loss
rate is zero, lift is undefined and the output gives the exact zero-marginal
reason. It is not coerced to zero.

### 3. Adjusted-loss Pearson correlation

\[
\rho_{ijt}=\operatorname{Corr}
(\widetilde L_i,\widetilde L_j).
\]

Lower values indicate less redundant loss patterns. Correlation is undefined
with fewer than three observations or a constant loss vector; these cases are
reported explicitly.

## BI gap and near-BI

Both models' BIs are recomputed on the same slice-specific common support.

```text
bi_gap_common = abs(model_a_common_bi - model_b_common_bi)
near_bi = bi_gap_common <= 2.0
```

Near-BI is a quality-comparability flag, not a prerequisite for producing the
three metrics. Published views should make near-BI filtering available and
should not mix all-pair and near-BI conclusions.

## Cross-event-type dependence stability

The cross-event-type experiment asks whether the dependence of one exact model
pair is stable across two derived semantic topics. Its observation unit remains
the canonical unordered exact-model pair, not an event row. With seven topics,
the release evaluates all 21 unordered topic combinations.

For topics \(s\) and \(t\), metric \(m\), and exact-model pair \((i,j)\), the
primary sample is the intersection satisfying all of the following in both
topics:

1. the pair is eligible at `n_overlap >= 50`;
2. the metric is finite and has no undefined-value reason;
3. the pair is near-BI on each topic's own common support.

The sensitivity sample drops only the third condition and therefore includes
all pairs eligible in both topics. Undefined lift or correlation values are
never imputed. Ranks are recomputed within the exact two-topic intersection so
that differing model coverage cannot silently change the comparison set.

For every metric and topic pair, the primary stability coefficient is the
tie-aware Spearman correlation across exact-model pairs. Raw-value Pearson
correlation is secondary, especially because high-loss lift can be
heavy-tailed. The cross-topic sign has the same stability interpretation for
all three raw metrics: a positive coefficient means model-pair ordering tends
to persist across the two topics. This does not change the within-topic metric
directions: higher POG is more complementary, while lower lift and lower loss
correlation are more complementary.

To answer whether highly dependent pairs remain dependent, each metric is also
converted to a within-intersection dependence percentile. Lift and loss
correlation retain their order; POG is reversed so that a higher percentile
always means greater dependence. The audit reports:

- top-dependence and top-complementarity quartile Jaccard overlap;
- dependence and complementarity persistence in both topic directions;
- dependence-to-complementarity flip rates in both directions.

Coefficients with fewer than 30 metric-defined common pairs are suppressed.
Results with 30--99 pairs are labeled limited and results with at least 100 are
eligible for headline descriptive interpretation. These are reporting
thresholds, not statistical significance thresholds.

The full detail archive enumerates every global exact-model pair for every
topic combination: `21 * 34,453 = 723,513` rows. Ineligible pairs, insufficient
overlap, non-near-BI status, and undefined metrics remain explicit so that the
cross-topic intersection is auditable.

## Pair-slice output

`analysis/metrics.py` writes one row per
`slice_dimension + slice_id + model_a + model_b`, with models
lexicographically ordered so that an unordered pair appears once.
`slice_dimension` is `topic`, `origin_type`, or `official_source`. For backward
compatibility, `topic_id` equals `slice_id` on topic rows and is blank on the
two official dimensions. Core fields include:

- exact model and organization labels;
- each model's topic coverage and their common support;
- date/source/origin coverage;
- eligibility and insufficiency reason;
- common-support BIs, BI gap, and near-BI flag;
- adjusted POG;
- lift, marginal severe-loss rates, joint rate/count, and validity reason;
- adjusted-loss Pearson correlation and validity reason;
- a combined `metric_status`.

Blank numeric cells always have a reason field; they do not mean zero.

For production scale, the metrics runner reads the scored panel in date order
and retains only one date of target rows at a time. It accumulates exact
sufficient statistics for means, severe-loss counts, Pearson correlation, and
origin-stratified BI. A parity test verifies that these streaming statistics
match direct loss-vector calculations.

## Reproduction

```bash
python -m analysis.scoring \
  --processed-root /path/to/forecastbench-processed-forecast-sets \
  --fixed-effects /path/to/question_fixed_effects.json \
  --output data/derived/scored_panel.csv \
  --audit-output data/derived/scored_panel.audit.json

python -m analysis.metrics \
  --scored-panel data/derived/scored_panel.csv \
  --taxonomy data/derived/event_taxonomy.csv \
  --output data/derived/pair_slice_metrics.csv \
  --audit-output data/derived/pair_slice_metrics.audit.json
```

By default, a scored row without a taxonomy match is fatal. The frozen release
has four official fixed-effect targets without resolved-event metadata, so its
release command may explicitly add `--allow-unclassified
--max-unclassified-targets 4`. This is a bounded metadata exception, not a
strict full join. The audit records every excluded scored row, the number of
unique missing targets, and the target keys; a fifth unique target is fatal.
Any release using this exception must state that it is not a strict full join.

## Validation plan

The implementation and published artifacts must pass all of the following:

1. **Formula unit tests:** known-value tests for POG, strict 0.25 lift, Pearson
   correlation, official origin-stratum weighting, BI gap, and near-BI.
2. **Key integrity:** no conflicting fixed-effect keys, taxonomy keys, or
   model-target rows; identical duplicates are counted in audit JSON.
3. **Join accounting:** strict runs require zero missing taxonomy targets. The
   frozen bounded-exception release permits at most four unique missing
   metadata targets, records every affected model row, and requires zero origin
   mismatches.
4. **Common-support symmetry:** swapping model A/B leaves POG, lift,
   correlation, BI gap, and overlap counts unchanged.
5. **Metric invariants:** POG is nonnegative up to floating tolerance, lift is
   nonnegative when defined, and correlation is within [-1, 1].
6. **Coverage accounting:** within each dimension, output rows equal
   `n_slice_ids * choose(n_exact_model_names, 2)`, including ineligible pairs.
   Generic/fallback rows must be absent from topic slices but present in their
   official origin/source slices.
7. **Legacy alignment, not parity:** unit and single-cell checks reproduce the
   predecessor scoring primitives and three formulas. The new cross-date pooled
   target-level estimates and pooled near-BI flags are not called reproductions
   of the legacy per-date pair-cell experiment. Random-half OOS is a separate
   robustness design.
8. **Determinism:** sorted inputs and model pairs plus recorded SHA-256 hashes
   make reruns byte-stable for unchanged inputs.

## Interpretation limits

- Topic is derived and partly confounded with official source and question
  template. Topic differences are not automatically causal topic effects.
- The 61 initial keyword-conflict rows were manually reviewed as 17 unique
  events. Eleven eligible rows remain marked review-required because their
  resolution predicates are genuinely cross-domain. A review-excluded
  sensitivity analysis should accompany headline results. The present
  three-dimension output audits that count but does **not** yet emit a separate
  review-excluded topic sensitivity table; that robustness result must not be
  claimed as completed.
- Pairwise diagnostics describe realized outcome losses. POG in particular is
  hindsight-based.
- Repeated underlying events across dates can induce dependence in inferential
  uncertainty. This release reports descriptive metrics and exact coverage; a
  future inferential layer should cluster or block-bootstrap by
  `source + event_id` and date.
- Near-BI controls a major quality-gap concern but does not remove selection,
  source, or time-composition differences.
- Cross-topic coefficients reuse models across many dyads, so ordinary
  independent-observation p-values are invalid. This release treats them as
  descriptive stability statistics; a future inferential analysis should use
  dyadic/model-cluster-aware resampling in addition to event/date blocking.
