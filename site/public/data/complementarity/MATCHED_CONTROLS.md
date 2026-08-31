# Same-anchor, same-support matched controls

This is an observational comparison, not a causal intervention. It tests whether
cross-category organization adds predictive value after matching several measures
of overall capability and total complementarity. It does not establish an
ability-independent universal diversity metric.

## Selection and support

The script recomputes harmonized TRAIN profiles for all prior train-eligible pair
directions, without using prior test outcomes or prior test-selected crossing
labels. Each anchor's five highest-Cbetween crossing partners are considered.
For each, at most ten noncrossing counterparts are tried, ordered by squared
distance in prior TRAIN mean BI (scale 1), BI gap (scale 0.5), and normalized total
POG (scale max(0.01, 0.2 times pair mean)); low Cbetween and model ID break ties.
Initial profiles may have less than 80% coverage because the ABC intersection can
change coverage; every accepted match satisfies the full final requirement.

Both arms are then recomputed on exactly the same ABC-common training and test
rows. Matching requires >=100 distinct events in each half, both train BI gaps
<=2, pair-mean-BI difference <=1, gap difference <=0.5, normalized-total-POG
difference <=max(0.01,0.2 times mean), >=2 training categories with >=30 events
each and >=80% total training weight, and Cbetween difference >=0.005. Treatment
must have opposing category margins >=1 conditional BI; control must not. To
avoid treating missing evidence as no crossing, every retained category has
finite conditional BI in both arms. One accepted triplet per anchor/view.

Cbetween, Cwithin, and Ctotal all use the same retained training categories and
the same conditioned overall Dataset/Market weights. The matching Ctotal is
normalized by each arm's mean raw loss on that scope. The prior full-support
normalized POG only orders candidate searches; the final caliper is recomputed
on the retained-group scope. The original nine method outputs are evaluated on
all ABC-common test rows, including category fallback. Original six formulas
and prior three research fits are unchanged.

Accepted 115 triplets from 1926 anchor/view candidates;
35838 bounded comparisons were tried. Status counts:
`{"matched": 115, "no_crossing_treatment": 334, "no_defined_noncrossing_control": 75, "no_match_under_fixed_calipers": 1402}`.
The full attrition, all rejection reasons, balance, and partner reuse are saved.
Repeated counterparty use is permitted; it does not create independent samples.

## Primary fixed event split (20260910, train 0)

The primary contrast is high-minus-low in [BI(type-shrunk)-BI(global convex)].
Positive means the crossing arm benefits more from using category information.
Raw-loss reduction uses the equivalent direction: R(global)-R(type-shrunk).
Gains over the whole-test better constituent are descriptive additional outcomes,
not train selection criteria.

| dimension | endpoint | triplets | finite_triplets | high_mean | low_mean | contrast_mean |
| --- | --- | --- | --- | --- | --- | --- |
| source | type_increment_bi | 6.0000 | 6.0000 | 0.0493 | 0.0118 | 0.0374 |
| source | type_increment_raw | 6.0000 | 6.0000 | 0.0004 | 0.0001 | 0.0003 |
| source | cf_directional_gain_testbest_bi | 6.0000 | 6.0000 | 0.7121 | 0.3314 | 0.3807 |
| source | type_shrunk_gain_testbest_bi | 6.0000 | 6.0000 | 0.3155 | -0.0239 | 0.3394 |

Conditional 95% intervals use 2,000 shared event-cluster normal multipliers and
an origin-stratified ratio-estimator / BI derivative linearization. All reuse of
an event across triplets receives the same multiplier. They condition on fitted
methods and training matches, and do not account for metric discovery, training
selection, or dependence between different events from the same real-world story.

| dimension | endpoint | finite_triplets | estimate | ci_low | ci_high |
| --- | --- | --- | --- | --- | --- |
| source | high_type_increment_bi | 6.0000 | 0.0493 | -0.0461 | 0.1434 |
| source | high_type_increment_raw | 6.0000 | 0.0004 | -0.0004 | 0.0012 |
| source | low_type_increment_bi | 6.0000 | 0.0118 | -0.0449 | 0.0668 |
| source | low_type_increment_raw | 6.0000 | 0.0001 | -0.0003 | 0.0006 |
| source | contrast_type_increment_bi | 6.0000 | 0.0374 | -0.0484 | 0.1223 |
| source | contrast_type_increment_raw | 6.0000 | 0.0003 | -0.0004 | 0.0010 |
| topic | high_type_increment_bi | 0.0000 | undefined | undefined | undefined |
| topic | high_type_increment_raw | 0.0000 | undefined | undefined | undefined |
| topic | low_type_increment_bi | 0.0000 | undefined | undefined | undefined |
| topic | low_type_increment_raw | 0.0000 | undefined | undefined | undefined |
| topic | contrast_type_increment_bi | 0.0000 | undefined | undefined | undefined |
| topic | contrast_type_increment_raw | 0.0000 | undefined | undefined | undefined |

## Balance on the primary view

The two arms have exactly the same targets, event counts, origin composition,
category support and metric coverage. The remaining score balance is measured,
not claimed exact; the intended contrast is in Cbetween at similar Ctotal.

| dimension | metric | high_mean | low_mean | absolute_difference | max_absolute_difference |
| --- | --- | --- | --- | --- | --- |
| source | train_mean_bi | 58.8274 | 58.9895 | 0.4643 | 0.9220 |
| source | train_gap | 0.8026 | 0.9993 | 0.2547 | 0.4844 |
| source | total_normalized | 0.1773 | 0.1623 | 0.0156 | 0.0387 |
| source | between_normalized | 0.0423 | 0.0057 | 0.0366 | 0.0561 |
| source | within_normalized | 0.1350 | 0.1565 | 0.0258 | 0.0475 |
| source | mean_raw | 0.1637 | 0.1638 | 0.0037 | 0.0076 |
| source | coverage | 0.8310 | 0.8310 | 0.0000 | 0.0000 |

## Repeated views and limits

| dimension | endpoint | views | positive_views | mean_view_contrast | min_view_contrast | max_view_contrast |
| --- | --- | --- | --- | --- | --- | --- |
| source | cf_directional_gain_testbest_bi | 10.0000 | 7.0000 | 0.1281 | -0.2406 | 0.3807 |
| source | type_increment_bi | 10.0000 | 9.0000 | 0.0373 | -0.0148 | 0.0989 |
| source | type_increment_raw | 10.0000 | 9.0000 | 0.0003 | -0.0002 | 0.0008 |
| source | type_shrunk_gain_testbest_bi | 10.0000 | 7.0000 | 0.1214 | -0.1382 | 0.3394 |

The ten random directions overlap heavily and are not ten independent studies.
The temporal views use the frozen historical cutoffs but may contain recurring
events already present in training; shared-event counts are exported per triplet.
No temporal test BI-gap filter is imposed. Counterparts and support may differ
between views, so view-to-view means are not a fixed-cohort longitudinal effect.

Strict calipers can leave very few controls. We do not relax them after inspecting
results. This bounded greedy match can miss feasible alternatives outside the
5x10 search budget, and source/topic classification itself is observational.
Even a positive contrast would support a limited predictive association, not
proof that specialization causes an aggregation benefit.

## Reproduction

Run `python code/matched_controls.py` from any directory using the package's
prepared data and numpy/pandas. The code uses package-relative paths.
Key outputs: `results/matched_triplets.csv`, `matched_split_summary.csv`,
`matched_primary_intervals.csv`, `matched_balance.csv`,
`matched_anchor_attrition.csv`, `matched_attempts.csv.gz`,
`matched_partner_reuse.csv`, and `matched_audit.json`.


## Post-feasibility coverage sensitivity: 50%

This sensitivity was added after seeing strict 80% coverage feasibility and the
initial matched-control counts. Only minimum eligible-category coverage changes;
all ability, total-POG, category crossing, ABC-common support, and search-budget
requirements remain unchanged. Each anchor is matched anew using the same
training-only ordering and the first valid counterpart under THIS threshold.
It is not obtained by filtering lower-threshold selections. The 80% primary
results remain unchanged and lower-coverage results have a narrower metric scope.

Accepted 637 triplets from 1926 anchor/view candidates;
24322 bounded attempts. Status counts:
`{"matched": 637, "no_crossing_treatment": 334, "no_defined_noncrossing_control": 75, "no_match_under_fixed_calipers": 880}`.

| dimension | endpoint | triplets | finite_triplets | high_mean | low_mean | contrast_mean |
| --- | --- | --- | --- | --- | --- | --- |
| source | type_increment_bi | 34.0000 | 34.0000 | 0.1168 | 0.0581 | 0.0587 |
| source | type_increment_raw | 34.0000 | 34.0000 | 0.0009 | 0.0004 | 0.0005 |
| source | cf_directional_gain_testbest_bi | 34.0000 | 34.0000 | 0.7586 | 0.6408 | 0.1178 |
| source | type_shrunk_gain_testbest_bi | 34.0000 | 34.0000 | 0.4512 | 0.3093 | 0.1419 |
| topic | type_increment_bi | 30.0000 | 30.0000 | 0.0654 | 0.0169 | 0.0485 |
| topic | type_increment_raw | 30.0000 | 30.0000 | 0.0005 | 0.0001 | 0.0003 |
| topic | cf_directional_gain_testbest_bi | 30.0000 | 30.0000 | 0.8445 | 0.9907 | -0.1462 |
| topic | type_shrunk_gain_testbest_bi | 30.0000 | 30.0000 | 0.2763 | 0.3137 | -0.0374 |

| dimension | endpoint | finite_triplets | estimate | ci_low | ci_high |
| --- | --- | --- | --- | --- | --- |
| source | high_type_increment_bi | 34.0000 | 0.1168 | 0.0656 | 0.1638 |
| source | high_type_increment_raw | 34.0000 | 0.0009 | 0.0005 | 0.0013 |
| source | low_type_increment_bi | 34.0000 | 0.0581 | 0.0362 | 0.0798 |
| source | low_type_increment_raw | 34.0000 | 0.0004 | 0.0003 | 0.0006 |
| source | contrast_type_increment_bi | 34.0000 | 0.0587 | 0.0109 | 0.1037 |
| source | contrast_type_increment_raw | 34.0000 | 0.0005 | 0.0001 | 0.0009 |
| topic | high_type_increment_bi | 30.0000 | 0.0654 | 0.0062 | 0.1230 |
| topic | high_type_increment_raw | 30.0000 | 0.0005 | 0.0000 | 0.0009 |
| topic | low_type_increment_bi | 30.0000 | 0.0169 | -0.0215 | 0.0555 |
| topic | low_type_increment_raw | 30.0000 | 0.0001 | -0.0002 | 0.0004 |
| topic | contrast_type_increment_bi | 30.0000 | 0.0485 | -0.0222 | 0.1171 |
| topic | contrast_type_increment_raw | 30.0000 | 0.0003 | -0.0002 | 0.0009 |

| dimension | endpoint | views | positive_views | mean_view_contrast | min_view_contrast | max_view_contrast |
| --- | --- | --- | --- | --- | --- | --- |
| source | cf_directional_gain_testbest_bi | 10.0000 | 7.0000 | 0.1003 | -0.0430 | 0.3588 |
| source | type_increment_bi | 10.0000 | 9.0000 | 0.0445 | -0.0078 | 0.0795 |
| source | type_increment_raw | 10.0000 | 9.0000 | 0.0004 | -0.0001 | 0.0006 |
| source | type_shrunk_gain_testbest_bi | 10.0000 | 7.0000 | 0.0803 | -0.0415 | 0.3237 |
| topic | cf_directional_gain_testbest_bi | 10.0000 | 2.0000 | -0.1348 | -0.6019 | 0.0678 |
| topic | type_increment_bi | 10.0000 | 9.0000 | 0.0382 | -0.0345 | 0.1004 |
| topic | type_increment_raw | 10.0000 | 9.0000 | 0.0003 | -0.0003 | 0.0007 |
| topic | type_shrunk_gain_testbest_bi | 10.0000 | 6.0000 | -0.0332 | -0.5412 | 0.1445 |

All detailed outputs use prefix `matched_coverage50_`. Empty primary cohorts
are explicitly represented in the interval table, and anchor attrition includes
every unmatched anchor. These results are exploratory sensitivities, not a
replacement confirmatory analysis.


## Post-feasibility coverage sensitivity: 60%

This sensitivity was added after seeing strict 80% coverage feasibility and the
initial matched-control counts. Only minimum eligible-category coverage changes;
all ability, total-POG, category crossing, ABC-common support, and search-budget
requirements remain unchanged. Each anchor is matched anew using the same
training-only ordering and the first valid counterpart under THIS threshold.
It is not obtained by filtering lower-threshold selections. The 80% primary
results remain unchanged and lower-coverage results have a narrower metric scope.

Accepted 500 triplets from 1926 anchor/view candidates;
27109 bounded attempts. Status counts:
`{"matched": 500, "no_crossing_treatment": 334, "no_defined_noncrossing_control": 75, "no_match_under_fixed_calipers": 1017}`.

| dimension | endpoint | triplets | finite_triplets | high_mean | low_mean | contrast_mean |
| --- | --- | --- | --- | --- | --- | --- |
| source | type_increment_bi | 34.0000 | 34.0000 | 0.1168 | 0.0581 | 0.0587 |
| source | type_increment_raw | 34.0000 | 34.0000 | 0.0009 | 0.0004 | 0.0005 |
| source | cf_directional_gain_testbest_bi | 34.0000 | 34.0000 | 0.7586 | 0.6408 | 0.1178 |
| source | type_shrunk_gain_testbest_bi | 34.0000 | 34.0000 | 0.4512 | 0.3093 | 0.1419 |
| topic | type_increment_bi | 18.0000 | 18.0000 | 0.0889 | 0.0481 | 0.0408 |
| topic | type_increment_raw | 18.0000 | 18.0000 | 0.0007 | 0.0004 | 0.0003 |
| topic | cf_directional_gain_testbest_bi | 18.0000 | 18.0000 | 0.7340 | 0.9932 | -0.2592 |
| topic | type_shrunk_gain_testbest_bi | 18.0000 | 18.0000 | 0.3354 | 0.4319 | -0.0966 |

| dimension | endpoint | finite_triplets | estimate | ci_low | ci_high |
| --- | --- | --- | --- | --- | --- |
| source | high_type_increment_bi | 34.0000 | 0.1168 | 0.0656 | 0.1638 |
| source | high_type_increment_raw | 34.0000 | 0.0009 | 0.0005 | 0.0013 |
| source | low_type_increment_bi | 34.0000 | 0.0581 | 0.0362 | 0.0798 |
| source | low_type_increment_raw | 34.0000 | 0.0004 | 0.0003 | 0.0006 |
| source | contrast_type_increment_bi | 34.0000 | 0.0587 | 0.0109 | 0.1037 |
| source | contrast_type_increment_raw | 34.0000 | 0.0005 | 0.0001 | 0.0009 |
| topic | high_type_increment_bi | 18.0000 | 0.0889 | 0.0372 | 0.1415 |
| topic | high_type_increment_raw | 18.0000 | 0.0007 | 0.0003 | 0.0010 |
| topic | low_type_increment_bi | 18.0000 | 0.0481 | 0.0127 | 0.0858 |
| topic | low_type_increment_raw | 18.0000 | 0.0004 | 0.0001 | 0.0006 |
| topic | contrast_type_increment_bi | 18.0000 | 0.0408 | -0.0158 | 0.0980 |
| topic | contrast_type_increment_raw | 18.0000 | 0.0003 | -0.0001 | 0.0007 |

| dimension | endpoint | views | positive_views | mean_view_contrast | min_view_contrast | max_view_contrast |
| --- | --- | --- | --- | --- | --- | --- |
| source | cf_directional_gain_testbest_bi | 10.0000 | 8.0000 | 0.1012 | -0.0430 | 0.3588 |
| source | type_increment_bi | 10.0000 | 9.0000 | 0.0425 | -0.0088 | 0.0795 |
| source | type_increment_raw | 10.0000 | 9.0000 | 0.0003 | -0.0001 | 0.0006 |
| source | type_shrunk_gain_testbest_bi | 10.0000 | 7.0000 | 0.0808 | -0.0415 | 0.3237 |
| topic | cf_directional_gain_testbest_bi | 9.0000 | 3.0000 | -0.1985 | -0.6987 | 0.1473 |
| topic | type_increment_bi | 9.0000 | 8.0000 | 0.0542 | -0.0082 | 0.1490 |
| topic | type_increment_raw | 9.0000 | 8.0000 | 0.0004 | -0.0001 | 0.0012 |
| topic | type_shrunk_gain_testbest_bi | 9.0000 | 2.0000 | -0.0552 | -0.2203 | 0.1601 |

All detailed outputs use prefix `matched_coverage60_`. Empty primary cohorts
are explicitly represented in the interval table, and anchor attrition includes
every unmatched anchor. These results are exploratory sensitivities, not a
replacement confirmatory analysis.


## Post-feasibility coverage sensitivity: 70%

This sensitivity was added after seeing strict 80% coverage feasibility and the
initial matched-control counts. Only minimum eligible-category coverage changes;
all ability, total-POG, category crossing, ABC-common support, and search-budget
requirements remain unchanged. Each anchor is matched anew using the same
training-only ordering and the first valid counterpart under THIS threshold.
It is not obtained by filtering lower-threshold selections. The 80% primary
results remain unchanged and lower-coverage results have a narrower metric scope.

Accepted 318 triplets from 1926 anchor/view candidates;
31274 bounded attempts. Status counts:
`{"matched": 318, "no_crossing_treatment": 334, "no_defined_noncrossing_control": 75, "no_match_under_fixed_calipers": 1199}`.

| dimension | endpoint | triplets | finite_triplets | high_mean | low_mean | contrast_mean |
| --- | --- | --- | --- | --- | --- | --- |
| source | type_increment_bi | 20.0000 | 20.0000 | 0.1352 | 0.1030 | 0.0322 |
| source | type_increment_raw | 20.0000 | 20.0000 | 0.0010 | 0.0008 | 0.0002 |
| source | cf_directional_gain_testbest_bi | 20.0000 | 20.0000 | 0.9756 | 0.7175 | 0.2581 |
| source | type_shrunk_gain_testbest_bi | 20.0000 | 20.0000 | 0.3973 | 0.2062 | 0.1910 |
| topic | type_increment_bi | 13.0000 | 13.0000 | 0.1041 | 0.0153 | 0.0888 |
| topic | type_increment_raw | 13.0000 | 13.0000 | 0.0007 | 0.0001 | 0.0006 |
| topic | cf_directional_gain_testbest_bi | 13.0000 | 13.0000 | 0.6662 | 0.9048 | -0.2386 |
| topic | type_shrunk_gain_testbest_bi | 13.0000 | 13.0000 | 0.4504 | 0.4831 | -0.0327 |

| dimension | endpoint | finite_triplets | estimate | ci_low | ci_high |
| --- | --- | --- | --- | --- | --- |
| source | high_type_increment_bi | 20.0000 | 0.1352 | 0.0742 | 0.1912 |
| source | high_type_increment_raw | 20.0000 | 0.0010 | 0.0006 | 0.0014 |
| source | low_type_increment_bi | 20.0000 | 0.1030 | 0.0735 | 0.1303 |
| source | low_type_increment_raw | 20.0000 | 0.0008 | 0.0005 | 0.0010 |
| source | contrast_type_increment_bi | 20.0000 | 0.0322 | -0.0271 | 0.0875 |
| source | contrast_type_increment_raw | 20.0000 | 0.0002 | -0.0002 | 0.0007 |
| topic | high_type_increment_bi | 13.0000 | 0.1041 | 0.0406 | 0.1681 |
| topic | high_type_increment_raw | 13.0000 | 0.0007 | 0.0003 | 0.0012 |
| topic | low_type_increment_bi | 13.0000 | 0.0153 | -0.0194 | 0.0491 |
| topic | low_type_increment_raw | 13.0000 | 0.0001 | -0.0001 | 0.0004 |
| topic | contrast_type_increment_bi | 13.0000 | 0.0888 | 0.0139 | 0.1685 |
| topic | contrast_type_increment_raw | 13.0000 | 0.0006 | 0.0001 | 0.0012 |

| dimension | endpoint | views | positive_views | mean_view_contrast | min_view_contrast | max_view_contrast |
| --- | --- | --- | --- | --- | --- | --- |
| source | cf_directional_gain_testbest_bi | 10.0000 | 8.0000 | 0.1445 | -0.0313 | 0.3239 |
| source | type_increment_bi | 10.0000 | 9.0000 | 0.0415 | -0.0063 | 0.0861 |
| source | type_increment_raw | 10.0000 | 9.0000 | 0.0003 | -0.0001 | 0.0007 |
| source | type_shrunk_gain_testbest_bi | 10.0000 | 7.0000 | 0.1167 | -0.0398 | 0.3132 |
| topic | cf_directional_gain_testbest_bi | 5.0000 | 2.0000 | -0.0077 | -0.2743 | 0.3950 |
| topic | type_increment_bi | 5.0000 | 4.0000 | 0.0662 | -0.0047 | 0.1007 |
| topic | type_increment_raw | 5.0000 | 4.0000 | 0.0005 | -0.0000 | 0.0007 |
| topic | type_shrunk_gain_testbest_bi | 5.0000 | 3.0000 | -0.0068 | -0.2462 | 0.1866 |

All detailed outputs use prefix `matched_coverage70_`. Empty primary cohorts
are explicitly represented in the interval table, and anchor attrition includes
every unmatched anchor. These results are exploratory sensitivities, not a
replacement confirmatory analysis.


## Consolidated interpretation and numerical verification

| Coverage | Dimension | Primary matched N | Difference in type increment (BI) | Conditional 95% interval |
| --- | --- | --- | --- | --- |
| 80% | source | 6 | +0.0374 | [-0.0484, +0.1223] |
| 80% | topic | 0 | not estimable | no matches |
| 50% | source | 34 | +0.0587 | [+0.0109, +0.1037] |
| 50% | topic | 30 | +0.0485 | [-0.0222, +0.1171] |
| 60% | source | 34 | +0.0587 | [+0.0109, +0.1037] |
| 60% | topic | 18 | +0.0408 | [-0.0158, +0.0980] |
| 70% | source | 20 | +0.0322 | [-0.0271, +0.0875] |
| 70% | topic | 13 | +0.0888 | [+0.0139, +0.1685] |

The strict primary design cannot estimate a topic matched contrast: no topic
triplets satisfy all requirements. The source contrast uses only six primary
triplets, is small, and its interval includes zero. Lower-coverage exploratory
sensitivities provide some positive contrasts, but they change the representable
category scope and leave several topic split directions without matches. They
are not an upgraded confirmatory claim. The all-view coverage grid explicitly
includes zero-match views; no unmatched view is counted as a positive result.

Calipers also do not create exact score balance. In the strict primary source
matches, mean training gaps are 0.803 versus 0.999 BI and mean normalized total
POG is 0.177 versus 0.162. Residual measured and unmeasured differences remain.
The findings support investigating a small conditional predictive association,
while not identifying a causal benefit or a universal diversity metric.

| Coverage | Temporal view | Dimension | Matched N | High type increment | Low type increment | Difference (BI) |
| --- | --- | --- | --- | --- | --- | --- |
| 80% | temporal_2026 | source | 7 | -0.0676 | +0.0507 | -0.1184 |
| 80% | temporal_late | source | 1 | -0.2992 | -0.0163 | -0.2828 |
| 50% | temporal_2026 | source | 7 | -0.0676 | +0.0507 | -0.1184 |
| 50% | temporal_2026 | topic | 9 | +0.0513 | +0.0532 | -0.0019 |
| 50% | temporal_late | source | 1 | -0.2992 | -0.0163 | -0.2828 |
| 50% | temporal_late | topic | 5 | -0.0340 | -0.0509 | +0.0170 |
| 60% | temporal_2026 | source | 7 | -0.0676 | +0.0507 | -0.1184 |
| 60% | temporal_2026 | topic | 9 | +0.0513 | +0.0532 | -0.0019 |
| 60% | temporal_late | source | 1 | -0.2992 | -0.0163 | -0.2828 |
| 60% | temporal_late | topic | 4 | -0.0020 | -0.0229 | +0.0208 |
| 70% | temporal_2026 | source | 7 | -0.0676 | +0.0507 | -0.1184 |
| 70% | temporal_2026 | topic | 7 | +0.0996 | +0.0347 | +0.0650 |
| 70% | temporal_late | source | 1 | -0.2992 | -0.0163 | -0.2828 |
| 70% | temporal_late | topic | 1 | -0.0163 | -0.0901 | +0.0738 |

The strict source temporal contrasts reverse sign (−0.1184 BI for 7 triplets and −0.2828 BI for 1 triplet). Sparse support and recurring events limit interpretation, but these results do not support a claim of robust temporal transfer. Views with no matches remain in matched_coverage_grid.csv and have no estimable contrast.

Numerical verification reconstructed all 1,570 saved triplets across the four coverage thresholds and 84,780 method/score entries; maximum reconstruction error was 4.3e-14. All 40 test-outcome perturbation checks left the eight deployable method predictions unchanged; only hindsight Best Single is exempt. Six numerical event-influence checks passed (maximum error 2.4e-08). This verification is by the implementation author and is not an independent review.

Reproduce sensitivities with `python code/matched_controls.py --coverage 0.5 --reuse-initial`, then coverage `0.6` and `0.7`; each run reselects matches from scratch. Finish with `python code/matched_controls.py --verify-saved` to rebuild the consolidated grid and numerical verification. Run the primary 0.8 experiment first.
