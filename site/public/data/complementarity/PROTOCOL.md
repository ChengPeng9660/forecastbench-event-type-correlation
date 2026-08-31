# Cross-category ability complementarity: argument and falsification study

## Question and status

The user means similar OVERALL ability with different strengths across question categories. We do NOT require similar within-category ability: that would remove the intended specialization. Diversity is a relationship between two exact model configurations, not a standalone model score.

This extension is fixed before its new results. Prior experiments and data have already been inspected. It is exploratory evidence-building, not preregistration or an untouched confirmation set. Keep the previous results and failed metrics unchanged.

Frozen input: the preceding expanded panel with 94 genuine plain-zero-shot configurations, 421,932 forecasts and 3,670 source/event clusters. All model versions, scoring offsets, probabilities and inherited topic labels are fixed. Main event splits remain seeds20260910–20260914, both directions; primary20260910 train0. No seed search.

## Claims, in order

1. Structure: near-equal overall risk can coexist with opposite category advantages. This is distinct from one model simply being inferior.
2. Reproducibility: category advantage directions learned on training events predict their direction on other events.
3. Exploitation: a category-aware aggregation method benefits from that organization of strengths, beyond a global pooling method and capability-matched controls.
4. Scope: the conclusion survives some changes of source composition and date; if it does not, report that limit instead of asserting universal diversity benefits.

## Metrics and harmonized weighting

Primary overall eligibility: original adjusted-BI gap<=2 on all common training targets; each overall train/test half>=100 unique events. Training eligible categories require>=30 events, at least two categories. Main metric comparisons require eligible-category training mass>=80%; no outcome-based test eligibility or test BI-gap selection.

Overall evaluation continues the existing Dataset/Market-balanced weights. Category profiles, fitting and metrics CONDITION these same weights within categories; they do not rebalance origins a second time. Standalone category BI under that conditional weighting is labeled explicitly. This resolves the preceding display/fit inconsistency without changing earlier outputs.

On the SAME eligible groups, same target support and same weights, let delta=lossA-lossB and pi_g be category mass:

    Ctotal = [E|delta| - |E delta|]/2
    Cbetween = [sum_g pi_g |E(delta|g)| - |E delta|]/2
    Cwithin = sum_g pi_g [E(|delta||g)-|E(delta|g)|]/2
    Ctotal = Cbetween + Cwithin

Report all three in raw Brier units and normalized by the same average raw loss. Do not sum separately normalized scores. Cbetween is the previous group reciprocal POG concept; it is not a new invention. Cbetween>0 requires bidirectional group advantages; centered group heterogeneity alone does not.

Training strong crossing requires an A-favored and B-favored category each at least1 conditional BI apart. Pick the strongest margin in each direction, deterministic group-name ties. Do not use test signs to pick categories. Record support/coverage and all unavailable cases.

Measure training/test profile transfer on the training-selected eligible groups, with training category masses fixed for the diagnostic. Require>=30 test events in every retained group for the complete-profile diagnostic; label this support conditioning. Report missing rates, weighted sign agreement, centered profile cross-product and persistence of the two training-selected specialists. Recomputing test scores is diagnostic only.

## Aggregation and endpoints

Preserve the original six formulas; Best Single remains a hindsight comparison, not a deployable method. Reuse global convex, hard category router and category-shrunk convex mixture from the preceding study.

Additional fixed research sensitivities:

- Training-inner-CV gate: compare type-shrunk with global convex on concatenated inner event holdouts across ALL training targets, including fallback. Enable the final type fit only if its inner loss is strictly lower. All fits use>=30 category training events, fixed n/(n+100) shrinkage. No test tuning.
- Source-aware hierarchy for topic analysis: shrink a source coefficient toward global; shrink each source×topic coefficient toward its source coefficient, each with n/(n+100), threshold30 distinct training events. Compare with source-only and topic-only aggregation.

Primary outcome: held-out BI(type-shrunk)-BI(global convex). Report raw-loss reduction too. Other outcomes: gain over the training-selected whole best model, over the better whole-test single, original CF gain, overall preservation of the two selected specialists, strict group wins, and a practical0.5-BI tolerance sensitivity. The whole-test reference model is fixed globally, while each group's stronger-single reference is local and must be labeled accordingly.

Primary random views: all train-eligible pairs, train-crossing pairs, and no additional outcome-selected successful cohort. Report all nine original/reused method results. Treat gate/hierarchy as separate experimental methods. Unknown categories use the declared global/source fallback; failed or negative scores are not hidden.

## Controlled comparisons

1. Continuous/all-pair: relate TRAIN Cbetween, Cwithin and total POG to held-out outcomes; control training mean BI, BI gap, event count, metric coverage, source composition and category concentration. Report source and topic separately. Retain total POG as a baseline.
2. Same-anchor, same-support triplets: compare pair A+B (crossing/high Cbetween) with A+C (noncrossing/low Cbetween). Start with each anchor's highest-Cbetween candidates and lowest-Cbetween controls, training data only; try at most5 treatment partners×10 ordered control candidates. Recompute on the exact ABC-common train/test targets before accepting. Train/test each>=100 events; both train overall gaps<=2; mean-BI difference<=1; gap difference<=0.5; normalized-total-POG difference<=max(0.01,0.2 times their mean); same supported train categories with mass>=0.8; Cbetween normalized difference>=0.005; B crossing margins>=1 and C not crossing. No test outcomes or test ability gaps in matching. Choose one valid triplet per anchor/dimension/split; allow counterpart reuse and report it. Use identical targets for all methods and both arms. Primary contrast is the difference in type-minus-global increments. This is an observational matched comparison, not random assignment.
3. Label controls on the primary eligible pair cohort: 30 fixed permutations. Topic labels permute among events within source; source labels within actual origin×topic (including unknown-topic stratum). Perform permutations separately within train/test. Preserve all predictions, outcomes, overall ability and total prediction disagreement. Refit each method only on permuted training labels. Report changed-label event fraction, row/weighted category-mass changes and fallback coverage; event count preservation does not imply row-weight preservation. Compare actual type-minus-global increment with controls descriptively, not an exact causal permutation test.

## Uncertainty and generalization

Use common event-cluster multiplier draws across overlapping pairs/triplets for primary raw-loss and BI contrasts, conditional on training selections. Do not treat pairs or repeated splits as independent replications. Confidence intervals do not correct all metric/model discovery or macro-event dependence. No causal p-value claims.

Report the two existing temporal views separately. Also remove every test event seen in temporal training; retain novel-event views only with>=50 test events (train>=100). No lower threshold after observing gains. Report missing category support rather than filling it. The later FE snapshot and lack of verified historical publication times remain limitations.

## Required falsification and delivery

Verify squared-loss mean identity: Rbest-Rmean=E[(pA-pB)^2]/4-|RA-RB|/2. With exactly equal risks, arithmetic mean cannot hurt; with near-equal risks and category crossing it still can. Category specialization does not uniquely determine fixed-mean gain. Do not claim the contrary.

Deliver a theory note with counterexamples, harmonized full/heldout tables, matched-control balance and attrition, label controls, model cases including failures, a claim/evidence/limitation table, and an English argument suitable for a paper discussion. Preserve prior catalogue examples as posthoc illustrations, not newly confirmed discoveries. No website or original aggregation formula changes.

## Feasibility-triggered addendum (after initial label-control results)

The strict80% retained-training-mass criterion leaves only1topic pair and132source pairs in the primary direction. This was discovered alongside the first strict label-control outcomes, so the following are explicitly post-protocol sensitivities, not newly predeclared primary evidence: repeat summaries, label controls and same-anchor matching with50%,60%,70% coverage requirements, keeping every other rule fixed. Keep80% results, including no/sparse matches. For matching, each coverage threshold has its own first-valid search rather than filtering a lower-threshold selected triplet afterwards.

Also clarified during implementation audit, before the completed main mechanism outputs were analyzed: a source needs at least two distinct nonempty observed training topics before any source×topic update. Otherwise the hierarchy retains the source predictor. Unknown labels do not qualify as an additional real topic. This prevents spurious 'topic benefit' from a redundant second shrinkage update or from label-availability stratification alone.
