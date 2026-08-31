# How to argue the result

## The claim to make

**Similar overall forecasting skill can conceal different strengths across event categories. This structure creates potential for conditional aggregation, but its realized value depends on learning the category specialists reliably.**

This is narrower than claiming that more diverse forecasts always aggregate better. It is also different from claiming independent information or an ability-invariant metric. Use “cross-category complementarity” or “complementary category strengths”; define the object explicitly.

## Suggested English argument

Aggregate skill scores do not fully describe how forecasting models differ. Two models with comparable overall performance may have opposing comparative advantages across question categories. We study this form of complementarity under a training-only overall skill-matching constraint, using identical forecast targets and fixed model configurations.

We distinguish complementarity organized between categories from residual complementarity within categories. For squared loss, the pairwise oracle gain decomposes exactly into these two components on a common evaluation distribution. The between-category component is positive only when different categories favor different constituent models; heterogeneous degrees of one-sided inferiority are insufficient. This provides a direct interpretation of the construct as the value of a category-level model oracle over the better global constituent, rather than treating large numerical disagreement as evidence of complementary expertise.

Potential complementarity and its exploitation are separate empirical questions. For a category router selected using training outcomes, its held-out risk improvement equals the available category-oracle gain minus the cost of selecting the wrong specialists. This decomposition explains how crossed training strengths can coexist with disappointing aggregation: the specialization pattern may fail to transfer, or its estimation error may consume the oracle advantage.

On the already studied ForecastBench archive, we find illustrative skill-matched pairs with persistent crossed strengths, and modest average gains from regularized category-dependent pooling in internal event holdouts. However, common-anchor comparisons at matched forecast support and similar total oracle gain, conditional label controls, and temporal analyses provide mixed evidence for a broadly transferable benefit specifically attributable to semantic category organization. High-coverage event-type analyses are severely restricted by missing and sparse category support. We therefore interpret the results as evidence for a useful distinction and an estimation problem, with limited empirical gains, rather than a universally effective diversity metric.

## Evidence to attach to each sentence

| Statement | Current evidence | Essential qualification |
|---|---|---|
| Overall similarity does not imply identical strengths | Gemini-2.5-Pro / Grok-4-Fast-Reasoning: train overall gap0.561BI, test gap0.040BI; political/economic advantages persist | Posthoc example;63.2% training metric coverage, outside80% primary |
| Between-category score rejects one-sided ability gaps | Exact reciprocal-gain formula and independent dominance examples | It is the existing group-POG concept, not established novelty or complete deconfounding |
| Potential differs from realized benefit | Exact scope-matched router gain=potential−misidentification loss; independently checked on15,260 defined rows | Brier-risk identity, not additive BI; retained scope is not whole-test scope |
| Conditional pooling can add value | At50% sensitivity, topic152train-crossing pairs: type-shrunk adds0.062BI beyond global convex, conditional interval[0.028,0.096];9/10 dependent random directions positive | Post-protocol coverage sensitivity, small effect, conditional intervals, not external confirmation |
| The effect is specifically caused by category semantics | Current evidence is insufficient: topic50% real labels add0.062BI, conditional shuffles0.060BI; matched topic30contrast0.049BI with interval containing0 | Source/topic entanglement; shuffled mass/fallback changes; observational matching |
| The effect generalizes over time | Some small positive increments remain; late source reverses and novel-event subgroup support is sparse | Do not claim stable future generalization or omit negative temporal matches |

The new empirical contribution, if developed further, is the measured gap between available cross-category complementarity and reliable exploitation. The risk identities are straightforward mathematical consequences and should not be advertised as an established novel theorem without a separate literature review.

## What the concrete example does and does not establish

For Gemini-2.5-Pro and Grok-4-Fast-Reasoning, type-shrunk test BI is63.144 versus singles62.180/62.220. Global convex pooling already reaches63.079. Thus the type-aware increment is0.065BI, not the entire0.924BI improvement over the stronger single. Directional CF reaches63.465 without explicit type weights.

Use the example to demonstrate coexistence of comparable overall skill, crossed category strengths and successful aggregation. Do not use it to attribute the whole gain to category specialization. The class-specific point estimates are illustrative and are not both declared statistically significant.

Other retained examples and failures are in results/primary_case_inventory.csv. One finding worth showing as a counterexample is that type-weighting can preserve group performance even when the training specialists' identities reverse, or that a type method may help without bidirectional specialization. Method success alone does not prove the specific mechanism.

## Claims to avoid

- “We have eliminated model ability as a confounder.”
- “This metric measures independent information.”
- “Higher cross-category diversity necessarily improves every aggregation method.”
- “The full aggregation gain is caused by category specialization.”
- “Ten split directions constitute ten independent replications.”
- “The significant-looking70% sensitivity establishes the hypothesis.”
- “The80% topic primary experiment passed.” It has one eligible pair and no matched controls.

## The next confirmation study, specified before collecting its outcomes

This is a proposed next study, not an additional completed validation.

1. Freeze a taxonomy based on question text and source metadata without access to model forecasts, errors or aggregation gains. Resolve ambiguous labels with blinded review; retain an explicit unknown category and report weighted coverage.
2. Ensure evaluation mass is sufficient in both Dataset and Market. Determine the number of independent event clusters needed from training-only variance estimates and a declared minimum useful increment, rather than treating30events as statistical power.
3. Freeze exact model versions/configurations, the training ability-matching rule, primary between-category metric, one category-shrunk method and the global convex comparator. Retain CF and existing POG as comparisons; do not pick the primary method on the new test.
4. Define a genuinely later test block whose outcomes and results have not been used in this research. Record forecast and answer publication timestamps. Report both novel-event and recurring-event tracks, using one declared fixed-effect/scoring policy.
5. Primary endpoint: category-method improvement over the global mixture on the same targets. Mechanism endpoints: sign transfer beyond the constant-winner baseline, oracle potential versus selection regret, and common-anchor matched comparison. Require a sufficient support denominator for each claim.
6. Use shared event-cluster uncertainty, expose model/family dependence, correct or clearly separate confirmatory from exploratory multiple comparisons, and report unknown-label/fallback performance. A null result remains part of the study.

## Literature positioning

The need to consider individual accuracy, dependence and the combiner jointly is consistent with the [squared-loss ambiguity decomposition](https://papers.nips.cc/paper_files/paper/1994/hash/b8c37e33defde51cf91e1e03e51657da-Abstract.html) and the [unified ensemble diversity framework](https://jmlr.org/papers/v24/23-0041.html). These sources motivate the distinction; they do not validate this dataset's claim, establish the novelty of group POG, or turn exploratory gains into confirmatory evidence.
