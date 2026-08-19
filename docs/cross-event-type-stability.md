# Cross-event-type model-pair stability

## Research question

For the same exact unordered model pair, does high loss dependence in one
derived event type predict high dependence in another event type? This is a
cross-topic stability analysis of realized pair diagnostics. It is not an OOS
aggregation test and does not estimate a causal topic effect.

## Released design

- Seven analysis-eligible derived topics form 21 unordered topic pairs.
- The global universe contains 263 exact model names and 34,453 unordered
  model pairs.
- The all-pair detail archive retains all `21 * 34,453 = 723,513` rows,
  including ineligible, non-near-BI, and undefined-metric cases.
- The primary sample requires eligibility, a finite metric, and near-BI in
  both topics. The sensitivity sample requires eligibility and a finite metric
  in both topics but does not require near-BI.
- Spearman rank correlation is primary; raw-value Pearson correlation is
  secondary.
- Within-intersection quartiles are oriented so that Q4 always means greater
  dependence: POG is reversed, while lift and loss correlation are direct.
- Correlations with fewer than 30 defined model pairs are suppressed, 30--99
  are labeled limited, and at least 100 are eligible for headline descriptive
  interpretation.

The complete formulas, intersection rules, transition definitions, and
inferential limitations are in `docs/methodology.md`.

## Main descriptive result

Cross-topic model-pair rankings are usually positively related, but the
association is moderate rather than universal.

| Sample | Metric | Reportable topic pairs | Median Spearman | Range |
|---|---|---:|---:|---:|
| Near-BI in both | Adjusted POG | 20 / 21 | 0.337 | -0.016 to 0.562 |
| Near-BI in both | High-loss lift | 15 / 21 | 0.275 | -0.304 to 0.455 |
| Near-BI in both | Adjusted-loss correlation | 20 / 21 | 0.240 | -0.089 to 0.459 |
| Eligible in both | Adjusted POG | 21 / 21 | 0.198 | 0.052 to 0.513 |
| Eligible in both | High-loss lift | 21 / 21 | 0.221 | 0.060 to 0.556 |
| Eligible in both | Adjusted-loss correlation | 21 / 21 | 0.163 | -0.066 to 0.429 |

Thus, a model pair that is relatively dependent in one topic is somewhat more
likely to be dependent in another, but event type still changes pair ordering
materially. The stronger near-BI medians also show why ability matching should
precede complementarity interpretation.

## Stable and topic-specific examples

The strongest near-BI relationships with headline support include:

- Finance × Sports: POG `0.562` and loss correlation `0.459` (`n=861`).
- Climate × Politics: POG `0.554` and loss correlation `0.379` (`n=1,073`).
- Climate × Finance: POG `0.466`, high-loss lift `0.428`, and loss
  correlation `0.453` (`n=917` for each).
- Finance × Politics: POG `0.454` and loss correlation `0.419` (`n=1,370`).

The clearest supported topic-specific example is Health × Technology:

- POG Spearman `-0.016` (`n=154`);
- loss-correlation Spearman `-0.089` (`n=154`);
- high-loss-lift Spearman `-0.304`, but with only `n=35`, so it is limited.

For Health × Technology, 15.4% of Health's top-dependence POG quartile moves
to Technology's top-complementarity quartile, while the reverse directional
flip is 41.0%. These are descriptive transition rates, not probabilities for
future forecasts.

## Coverage warning

Entertainment intersections are small. All near-BI Entertainment high-loss
lift cells fall below the 30-pair reporting threshold and are suppressed.
Several Technology comparisons are limited. High-loss lift also has smaller
Health intersections because it is undefined whenever either model has no
loss above the 0.25 threshold.

## Safe interpretation

The release supports this statement:

> Among exact model pairs that have adequate common support and comparable BI
> in two derived topics, the relative ordering of realized pair dependence is
> moderately persistent on average, but important topic-specific reversals
> remain. This motivates event-type-conditioned pair selection.

It does not establish future/OOS stability, deployable aggregation gain,
statistical significance, or topic causality. Dyads share models, so ordinary
iid correlation p-values are invalid. A future inferential layer should use
QAP or dyadic/model-cluster-aware resampling, together with event/date block
bootstrap of the underlying pair metrics.

## Artifacts

- `data/derived/cross_type_summary.csv`
- `data/derived/cross_type_summary.json`
- `data/derived/cross_type_pair_details.csv.gz`
- `data/derived/cross_type_audit.json`
- `site/public/data/cross-type/`

The audit records the frozen pair-metrics SHA-256, row counts, reporting
thresholds, output sizes, and output hashes. The website exposes both samples,
all three metrics, cell diagnostics, and downloads of the summary and complete
pair-detail archive.
