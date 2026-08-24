# Cross-event-type model-pair stability

## Research question

For the same unordered model-version pair, does high loss dependence in one
derived event type predict high dependence in another event type? This is a
cross-topic stability analysis of realized pair diagnostics. It is not an OOS
aggregation test and does not estimate a causal topic effect.

## Released design

- Seven analysis-eligible derived topics form 21 unordered topic pairs.
- The global universe contains 70 model versions and 2,415 unordered
  model pairs.
- The all-pair detail archive retains all `21 * 2,415 = 50,715` rows,
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
| Near-BI in both | Adjusted POG | 11 / 21 | 0.188 | -0.409 to 0.605 |
| Near-BI in both | High-loss lift | 7 / 21 | 0.298 | -0.008 to 0.313 |
| Near-BI in both | Adjusted-loss correlation | 11 / 21 | 0.183 | -0.108 to 0.604 |
| Eligible in both | Adjusted POG | 15 / 21 | 0.191 | -0.118 to 0.435 |
| Eligible in both | High-loss lift | 15 / 21 | 0.249 | 0.037 to 0.394 |
| Eligible in both | Adjusted-loss correlation | 15 / 21 | 0.280 | 0.072 to 0.465 |

Thus, a model pair that is relatively dependent in one topic is somewhat more
likely to be dependent in another, but event type still changes pair ordering
materially. The stronger near-BI medians also show why ability matching should
precede complementarity interpretation.

## Stable and topic-specific examples

The strongest near-BI relationships include:

- Finance × Sports: POG `0.605` and loss correlation `0.604` (`n=79`, limited).
- Climate × Politics: POG `0.473` and high-loss lift `0.298` (`n=105`, headline).
- Finance × Politics: POG `0.188`, high-loss lift `0.313`, and loss
  correlation `0.486` (`n=111`, headline).

The clearest topic-specific reversal is Health × Sports:

- POG Spearman `-0.409` (`n=68`, limited);
- loss-correlation Spearman `-0.108` (`n=68`, limited).

## Coverage warning

Entertainment intersections are small. All near-BI Entertainment high-loss
lift cells fall below the 30-pair reporting threshold and are suppressed.
Several Technology comparisons are limited. High-loss lift also has smaller
Health intersections because it is undefined whenever either model has no
loss above the 0.25 threshold.

## Safe interpretation

The release supports this statement:

> Among model-version pairs that have adequate common support and comparable BI
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
