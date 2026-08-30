# Predictive total variation and cross-fit-only controls

## Scope — 2026-08-30

This update adds `total_variation` to the current website's diversity experiments
and removes the **Same-sample diagnostic** mode from the two aggregation explorers
that offered it. It does not introduce a new aggregator or change any existing
model selection, outcome, BI, gain denominator, support filter, or random split.

In **Markets → Model performance against the market**, TV is the fifth horizontal
axis choice, alongside prediction-correlation diversity and the three existing
adjusted-loss metrics. Provider, exact model version, prompt, information condition,
and the Raw Brier / Brier Index vertical-axis choices are retained.

This records the TV implementation and its initial local verification. The later
publication is included with the
[all-configuration aggregation extension](configuration-pair-aggregation.md).
The pre-change source revision is
`60154fb79dec51bb2d941aee27ad45dc2e9fbe9f`; the TV source changes accompany this record.

## Definition

For two binary forecasts on the **same target**,

\[
\mathrm{TV}(\mathrm{Bernoulli}(p_a),\mathrm{Bernoulli}(p_b))
=\tfrac12\left(|p_a-p_b|+|(1-p_a)-(1-p_b)|\right)=|p_a-p_b|.
\]

For a given common set of targets, the displayed metric is the arithmetic mean
of these per-target distances. `TV = 0.03` means an average probability gap of
three percentage points. It is not a relative performance gain.

- Valid range: `[0, 1]`; larger values mean greater predictive diversity.
- Inputs: original aligned forecast probabilities, not outcomes, losses, logits,
  or histograms pooled across unrelated questions.
- It is distinct from `1 − Pearson r`; a constant additive probability difference
  can have high correlation but nonzero TV.
- Missing or invalid probabilities must not be imputed or silently dropped to
  manufacture a TV value. Loss-only legacy inputs receive an explicit unavailable
  TV value while their existing loss metrics remain usable.
- Exactly zero is valid data, not a missing-value sentinel. Sufficient-statistic
  subtraction is clipped only to prevent floating-point endpoint roundoff.

`analysis.metrics.total_variation` is the shared direct implementation. Streaming
topic/global builders retain the sum of absolute differences and its valid count;
leave-one-topic-out comparisons subtract the same sufficient statistics.

## Where TV is computed

| Experiment | TV support | Performance support |
| --- | --- | --- |
| Topic and global matrices, topic stability | Existing pair-common targets in the selected slice | Existing descriptive metrics |
| Model-pair and market-pool cross-fit explorers | Training fold only | Opposite test fold |
| Without-freeze fixed-focal pairs | Training fold only | Opposite test fold |
| Market-informed prompts and without-freeze-base exposure | Training fold only for aggregation; the similarity summary retains its descriptive common support | Opposite test fold for aggregation |
| All-configuration market-performance scatter | Each exact configuration's common model–market targets | The identical common targets; this is a descriptive scatter, not an OOS experiment |
| Fixed selected upper-left pairs | Existing full-sample pair support | Existing full-sample pair-matched market comparison |
| Train-selected upper-left pairs | Training fold only; selection rule unchanged | Opposite pair-matched test fold |

The legacy, unmounted single-focal JSON export also receives TV for schema
consistency. It is not reintroduced into the public navigation.

Cross-fit keeps ten seeds, `20260825` through `20260834`, and both A→B and B→A.
Combined retains each module's existing averaging rule: the main pair, market,
and exposure explorers use train-support weighting for diversity and test-support
weighting for performance; upper-left pairs average their qualifying fold summaries
equally as before. The upper-left selection rule still uses prediction-correlation
diversity quartiles, not the newly selectable TV axis. Near-BI remains a training-fold
decision. The folds
are grouped by event so recurring dates/horizons do not cross the split boundary.
Repeated splits are not twenty independent experiments or a chronological holdout.

Every market-comparison block retains the restriction to non-imputed market
questions with a valid freeze-time **Polymarket** probability. Dataset questions
are excluded. A pair is compared with Polymarket on that pair's identical common
test targets. The overview scatter's dashed line is still a visual, support-weighted
summary; its selected-configuration panel gives the exact matched-market comparator.

## User-interface changes

- TV appears in the topic/global selectors, rankings, stability, model aggregation,
  market aggregation, exposure experiments, and selected-pair plots.
- TV scatter axes retain raw `[0, 1]` probability-distance units. Larger X means
  greater diversity; dependence rankings use the opposite ordering as intended.
- The aggregation evaluation switch is replaced by a **Cross-fit OOS** label.
  Combined / A→B / B→A remain available.
- Old `gain_eval=same_sample` links are normalized to cross-fit rather than silently
  displaying the retired mode.
- The market-performance descriptive scatter and the intentionally fixed full-sample
  selected-pair experiment remain: neither was the removed same-sample switch.
- Historical data/audit outputs are retained, including `data.points`. Removal is
  from the displayed aggregation mode, not destruction of reproducibility evidence.
- Focal-left split-color markers, algorithms, defaults, and existing filters are
  unchanged. Extra explanations stay inside the existing Methods disclosures.

## Reproduction and regression evidence

The original `site/public/data` was copied before regeneration. Structured
comparisons remove only newly added TV fields/rows, then compare all existing
numeric leaves at tolerance `1e-12` and require unchanged identifiers, supports,
folds, selection membership, and metric values. Generation metadata and the hash
of a CSV to which a TV column was appended are explicitly exempted where needed.

Audit results are stored in `data/derived/total_variation_audit/`. The core check
can be repeated against a pre-change data copy:

```sh
.venv/bin/python -m analysis.audit_total_variation_core \
  --baseline-site-data /path/to/pre-change/site-data \
  --output data/derived/total_variation_audit/core.json
```

Generation order is: `analysis.metrics`, `analysis.export_site`,
`analysis.global_baseline`, `analysis.cross_type`; then `analysis.pair_aggregation`
and `analysis.fixed_focal_without_freeze`. Market outputs use
`analysis.freeze_exposed_market_aggregation`, `analysis.export_freeze_correlation_site`,
`analysis.polymarket_aggregation`, `analysis.market_diversity_performance`, and
`analysis.upper_left_model_pair_aggregation`, with the original processed-forecast
root. The archived single-focal export uses `analysis.focal_gain`. These commands
reuse the preexisting scored panels and taxonomy; they do not request new LLM forecasts.

Tests cover Bernoulli TV identities and counterexamples; missing/invalid inputs;
streaming and leave-one-topic-out equality; train-only probability changes;
directional/Combined aggregation; published-data schemas; original-value regression;
TV=0 visibility; market prompt/provider/information filters; legacy URLs;
focal-left markers; desktop and mobile layouts. Existing local duplicate files
named `* 2.*` are excluded from the TypeScript project rather than edited or deleted.

All 100 compared result JSON files passed the old-value regression: 93 core/legacy
focal files, five market files, and two model-pair files. The two model-pair files
alone contain 165,487 checked old numeric values with maximum absolute difference
`0.0`; their fold-level TV reconstruction differs by at most `1.11e-16`.

The Python suite completed with 154 passed and one preexisting optional taxonomy
snapshot test skipped because `FORECASTBENCH_RESOLVED_EVENTS_CSV` was not set.
The frontend suite passed 119 tests across 22 files. Desktop/mobile browser
regression passed 65 cases, with one intentional desktop skip for a mobile-only
case. These checks include all new TV selectors, filter retention, both fold
directions, old-link normalization, and existing split-color marker orientation.
The production build also passed with `GITHUB_ACTIONS=true`; generated asset paths
use `/forecastbench-event-type-correlation/`. These counts describe the initial
TV-only verification; the subsequent all-configuration release also contains
new navigation, configuration, and complete-payload checks.

Higher TV is a measured forecast difference, not proof of better aggregation or
a causal explanation. The new plots and correlations remain subject to the same
sample, selection, and internal-OOS limitations as the existing experiments.
