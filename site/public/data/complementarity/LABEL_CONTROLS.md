# Conditional category-label controls

This is the fixed primary-split experiment in PROTOCOL.md, not a posthoc search for favorable label controls. All results below are unweighted averages across the frozen eligible model pairs; overlapping pairs are not independent observations.

## What was held fixed

- Exactly the same genuine forecasts, outcomes, official scoring offsets, actual Dataset/Market origin weights, common pair test targets, and source/event-disjoint train/test split.
- All 718 original training Near-BI pairs in each dimension were screened using TRAIN data only. Each pair needed at least two categories with at least 30 unique training events each; those categories had to cover at least 80% of the original whole-training scoring weight.
- The actual eligible pair cohort is frozen across all 30 controls. A control is never dropped because its shuffled labels reduce supported-category coverage or its result is negative.
- The original global convex fit and category-shrunk fit are unchanged: category coefficients shrink toward the global coefficient with n/(n+100), n is unique training events, minimum 30; unfit and unknown categories use the global coefficient.
- Permutation seeds are 2026093000 through 2026093029. One full-panel event-label map per seed/dimension/fold is shared by every pair. Train/test maps are generated separately. Every event keeps one label across all dates and horizons.

## What was shuffled

- Topic: known topic labels within their ACTUAL source. Unknown topic remains unknown.
- Source: source labels within ACTUAL Dataset/Market origin × actual topic, including an unknown-topic stratum. The fake source label is a fitting label only; it never changes origin weights.
- Fits use permuted training labels only. Test labels determine which fitted coefficient applies; test outcomes never determine that coefficient.

## Attrition is a substantive limitation

| Dimension | Original Near-BI pairs | At least two supported categories | Median supported training mass | Main eligible pairs |
|---|---:|---:|---:|---:|
| source | 718 | 636 | 67.6% | 132 |
| topic | 718 | 570 | 46.9% | 1 |

Only ONE topic pair passes the declared 80% coverage threshold: GLM-4.6 (zero shot) + Gemini-2.5-Flash (zero shot), train BI gap 1.4669, 370 train events and 372 test events. Thus the strict topic-control experiment has no credible population-level evidence. We do not replace this primary threshold after observing the result; the lower-coverage sensitivity below is explicitly post-protocol.

Across the full panel, 24,453/26,531 target rows (92.17%) have known topic. But Dataset supplies 24,225 rows with 96.45% known topic, whereas Market supplies 2,306 rows with only 47.22% known topic. Under equal Dataset/Market total weights, full-panel known-topic mass is 71.84% BEFORE any >=30-event category exclusion. Hence 92% row labeling is not 92% pair-level scoring coverage. label_panel_known_mass.csv records these counts.

## Primary result

Positive increments mean category-shrunk aggregation improves BI over global convex aggregation, evaluated on identical whole pair test targets. Positive raw-loss reduction has the same favorable direction.

| Dimension / TRAIN cohort | Pairs | Actual BI increment | Mean shuffled increment | Actual minus shuffled | Range across 30 shuffled means |
|---|---:|---:|---:|---:|---:|
| topic / all_eligible | 1 | +0.21958 | +0.05013 | +0.16945 | [-0.55537, +0.40264] |
| topic / train_crossing | 1 | +0.21958 | +0.05013 | +0.16945 | [-0.55537, +0.40264] |
| source / all_eligible | 132 | +0.02929 | +0.05851 | -0.02922 | [-0.00262, +0.09612] |
| source / train_crossing | 97 | +0.03354 | +0.06725 | -0.03371 | [+0.00572, +0.10570] |

The source result does NOT support an advantage from the real source labels over these controls. The topic singleton has a positive actual-minus-average-control contrast, but its control range crosses the actual value and one pair cannot substantiate the intended general claim.

| Dimension / TRAIN cohort | Actual raw-loss reduction | Mean shuffled raw-loss reduction | Actual minus shuffled |
|---|---:|---:|---:|
| topic / all_eligible | +0.0015999 | +0.0003589 | +0.0012410 |
| topic / train_crossing | +0.0015999 | +0.0003589 | +0.0012410 |
| source / all_eligible | +0.0002432 | +0.0004956 | -0.0002523 |
| source / train_crossing | +0.0002856 | +0.0005750 | -0.0002895 |

## Source/topic entanglement and effective randomization

The panel contains 3,670 event clusters; 1,179 have unknown topic. ACLED, DBnomics, FRED and YFinance each have only one known topic. Their 1,597 known-topic events cannot change category under within-source topic permutation. Dataset origin×topic strata for climate, health, politics and sports also contain just one source.

| Labels | Changed event fraction | Changed known-label event fraction | Changed row fraction | Changed scoring-weight fraction |
|---|---:|---:|---:|---:|
| source | 27.07% | 27.07% | 24.69% | 37.01% |
| topic | 15.91% | 23.44% | 11.52% | 22.08% |

These fractions average the 30 maps and two folds over the whole panel, not only eligible pairs. The controls can assess incremental topic structure within source or source structure within origin/topic. They cannot remove the large shared source/topic component, so they do not identify a general causal value of categories.

## Event-count preservation is not scoring-mass preservation

| Dimension / all-eligible cohort | Actual train fitted mass | Shuffled train fitted mass | Actual test fitted mass | Shuffled test fitted mass | Mean train / test category-mass TV |
|---|---:|---:|---:|---:|---:|
| topic | 80.43% | 60.49% | 67.70% | 56.08% | 0.118 / 0.107 |
| source | 82.27% | 78.70% | 82.38% | 78.48% | 0.125 / 0.115 |

All full-panel event-label counts are preserved within permutation strata and fold. Model pairs observe different subsets, and events have different numbers of date/horizon rows. Consequently pair-level event counts, row masses, origin-balanced masses and the >=30-event fitting threshold can change. The whole outcome support and whole origin-balanced weights do not change. This is why the comparison is descriptive, not an exact permutation p-value or pure isolated category-semantics effect.

## Audit and files

- Global fit weights and predictions are unchanged exactly; maximum difference 0. Actual type-shrunk BI matches the frozen preceding experiment to 7.11e-14.
- No undefined BI in the retained actual/control rows. Negative increments are preserved.
- label_cohort.csv records all 1,436 candidate pair/dimension rows, including attrition.
- label_pair_results.csv.gz keeps each actual/control pair result and coverage diagnostics; label_pair_category_masses.csv.gz gives unique-event counts, rows, weighted/row category masses and actual comparison.
- label_permutation_maps.csv.gz reproduces each event assignment; label_permutation_audit.csv and label_panel_category_masses.csv verify full-panel changes and count preservation.
- label_summary.csv and label_permutation_summary.csv give primary averages and all 30 individual control means.
- label_source_topic_entanglement.csv gives original event counts by source/topic/origin; label_audit.json records computational invariants.

Run `python code/label_controls.py` from the package with numpy and pandas available. The script derives the entire cohort from prepared data and prior split rows; it does not reuse any prior crossing/test-outcome eligibility.

## Feasibility-driven post-protocol coverage sensitivity

After observing the 80% coverage attrition AND the first strict-control results, we added 50%, 60% and 70% training coverage sensitivities. These are explicitly post-protocol and do not replace the 80% primary result. All other thresholds, labels, fits, seeds, permutations and test endpoints remain fixed. Each threshold uses the same actual/control pair identities and identical whole pair test targets; no test outcomes or test BI gaps enter inclusion.

| Coverage | Dimension / TRAIN cohort | Pairs | Actual BI increment | Mean shuffled increment | Actual minus shuffled |
|---|---|---:|---:|---:|---:|
| 50% | topic / all_eligible | 321 | +0.02709 | +0.03694 | -0.00985 |
| 50% | topic / train_crossing | 152 | +0.06196 | +0.06010 | +0.00186 |
| 50% | source / all_eligible | 443 | +0.07045 | +0.06981 | +0.00064 |
| 50% | source / train_crossing | 275 | +0.08096 | +0.08421 | -0.00325 |
| 60% | topic / all_eligible | 209 | +0.02511 | +0.02028 | +0.00483 |
| 60% | topic / train_crossing | 115 | +0.06208 | +0.04050 | +0.02158 |
| 60% | source / all_eligible | 443 | +0.07045 | +0.06981 | +0.00064 |
| 60% | source / train_crossing | 275 | +0.08096 | +0.08421 | -0.00325 |
| 70% | topic / all_eligible | 111 | +0.06007 | +0.01951 | +0.04055 |
| 70% | topic / train_crossing | 66 | +0.10815 | +0.03451 | +0.07364 |
| 70% | source / all_eligible | 282 | +0.07992 | +0.08607 | -0.00615 |
| 70% | source / train_crossing | 187 | +0.08972 | +0.10037 | -0.01065 |
| 80% | topic / all_eligible | 1 | +0.21958 | +0.05013 | +0.16945 |
| 80% | topic / train_crossing | 1 | +0.21958 | +0.05013 | +0.16945 |
| 80% | source / all_eligible | 132 | +0.02929 | +0.05851 | -0.02922 |
| 80% | source / train_crossing | 97 | +0.03354 | +0.06725 | -0.03371 |

All actual/control fits and group masses at >=50% coverage are in label_sensitivity_pair_results.csv.gz and label_sensitivity_pair_category_masses.csv.gz. The original label_pair_results.csv.gz and label_summary.csv remain the 80% primary subset. label_coverage_quantiles.csv and label_cohort.csv expose the full training coverage distribution across all 718 pairs per dimension, including all ineligible pairs.

A high number of globally labeled targets does not guarantee high pair-level scoring coverage. Targets repeat events over dates/horizons; the >=30 requirement counts distinct events, not target rows. Each pair has different common forecasts and dates. Finally Dataset and Market receive equal total weight when both are present, so many repeated known Dataset targets cannot compensate for unknown or sparse Market categories. The diagnostics separate unknown-topic mass from known-but-sparse mass and report each origin separately.
