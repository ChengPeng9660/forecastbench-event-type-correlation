# Independent audit of the cross-category argument study

**Verdict: the audited point calculations, corrected event influences, and control invariants pass independent checks.** This verifies implementation and reporting consistency; it does not turn exploratory findings into confirmatory evidence.

## Independence and coverage

The reviewer did not change the main mechanism, matching, label-control or analysis scripts. Separate expected-value calculations were written in `code/test_mechanism_independent.py` and `code/audit_mechanism_independent.py`. The latter reads the frozen panel and does not call the main prediction, scoring, fitting or profile functions to construct expected forecasts and risks.

- **17 new implementation fixtures passed**, in addition to the five earlier data-free mathematical constructions in `code/test_theory_constructions.py`.
- **278 mechanism rows** were independently reconstructed across every available split/dimension, including full-sample, random event holdouts, recurrent-event temporal views and the novel-event sensitivities.
- On **all 15,696 mechanism rows**, the raw/normalized between-within decompositions and every method's preservation, strict and practical flags were checked wherever defined.
- **15,260 defined retained-scope rows** satisfy hard-router gain = test between-category potential − specialist-misidentification regret.
- All **62,106 category profiles with finite BI/delta** have training BI winner directions consistent with the conditioned risk difference. The earlier mixed-origin display/fitting mismatch is removed.
- For **20 primary rows**, all six stored event-influence vectors were independently reconstructed, including the varying official offsets in BI derivatives.
- All 60 stored permutation maps were checked over **1,380 conditional strata**. An additional **100 actual/permuted pair results** were refitted and rescored independently.
- Accepted matching calipers and shared-support conditions were checked for **all 1,570 accepted triplets** across the original 80% run and three coverage sensitivities; **191 actual triplets** were independently re-evaluated. Another **1,140 numeric checks** reconstructed sampled saved aggregation-summary counts, missing denominators and rates.

Across the point-result, label-control, matching and summary reconstructions there were **43,124 scalar numeric checks**, with maximum absolute discrepancy **1.99×10⁻¹³**. The event-influence arrays were checked separately with an explicit tolerance for their stored float32 precision.

The exact current check counts, samples, source hashes and result hash are in `results/independent_mechanism_audit.json`; the reproducible test log is `results/independent_unit_tests.log`. These counts describe computational coverage, not independent statistical observations.

## Two implementation issues found and repaired before the final artifacts

### BI interval residuals must include target offsets

The first mechanism implementation centered raw losses for its event influence while transforming means after adding official offsets. A common target offset cancels in a raw-loss difference, but it does **not** fully cancel in a BI difference because the two square-root derivative denominators differ.

The main agent repaired the BI branch to center adjusted per-target losses within actual origin. The raw-loss branch continues to center raw losses, as appropriate. A finite-difference fixture perturbs an event's weight and renormalizes within origin; both BI and raw-loss derivatives now agree with the implementation. The final `primary_influence.npz` independently matches the corrected calculation. This issue did not change point estimates, but would have affected BI uncertainty intervals.

### Hierarchy must represent a genuine category refinement

Applying another shrinkage update when a source has only one topic can change coefficients even though no new category information was supplied. The main agent restricted child fits to sources with at least **two distinct nonempty training topics**. A single real topic plus unknown labels does not qualify. Unknown or insufficient-support children retain the source predictor.

Fixtures verify exact source/hierarchy equality when there is no real refinement, a valid update when there are two real topics, and unknown-label fallback. The final prediction reconstructions use this corrected restriction. The mechanism job was restarted rather than mixing pre-fix and post-fix output rows; the final audited output hash is recorded in the audit JSON.

## Mathematical and weighting checks

The independent reconstruction verifies the same retained categories and conditioned weights for all terms:

    C_total = C_between + C_within.

It also verifies the common raw-loss denominator for normalization. Empty/missing categories do not receive fabricated risks, and zero-risk normalizations remain undefined.

Category BI, category risk differences and fitting choices all condition the overall Dataset/Market-balanced target weights. They do not rebalance Dataset/Market again inside a category. These are **conditional category BI scores**, so comparisons against the preceding package must acknowledge the changed category scoring convention. Overall scores and the original six method formulas remain unchanged.

The original six-method implementation is byte-identical to the preceding audited package. New gated and hierarchical methods are additional research algorithms, not changes to those six pools.

The two different profile diagnostics use different explicitly stated estimands:

- Direction agreement and profile covariance fix training category masses while comparing category risk differences.
- The test-scope hard-router identity uses actual test category masses, on the same retained test rows as its router and better-single reference.

The identity is in Brier-risk units, not BI points. The field `scope_router_oracle_loss` stores the **between-category gain potential**, rather than the absolute oracle risk; human-facing descriptions must preserve that meaning. A retained-scope gain must not be presented as an exact decomposition of full-support overall BI.

## Training/test separation

Changing only outer-test answers leaves all eleven non-hindsight forecasts, gate decisions and fitted coefficients unchanged. The whole-test Best Single comparator is the one intentional exception and remains labeled hindsight.

The inner gate fits each candidate on one inner training half, predicts the other half, and compares concatenated losses across all outer-training targets, including fallback categories. It does not fit the gate using outer-test gains. A failed or unsupported gate falls back to global convex weighting.

Category specialists are selected from training conditional BI margins. Test signs are used only to diagnose transfer or evaluate regret, never to choose specialists. Profile-completeness conditions depend on category support counts and are reported separately.

Random event folds keep every date/horizon from the same source/event together. Novel temporal views remove every test event seen in temporal training and apply the declared minimum of 50 remaining test events. The original temporal views retain recurring events. Neither view removes the later-FE-snapshot and historical-answer-publication limitations.

## Matching audit

The matching implementation recomputes both A+B and A+C on the exact same A/B/C target intersection. Near-BI, mean/gap, retained categories, normalized total POG, between-component differences and coverage are checked again on that shared training support. Row hashes identify both shared train and test sets.

An independent fixture creates a valid crossing-versus-within-category control with equal overall risks and total POG; changing all test outcomes leaves the complete matching decision unchanged. The source audit confirms that test predictions are consulted only for availability/support, not test scores or signs. The declared bounded first-valid search is not expanded after evaluating outcomes.

The 50%, 60% and 70% runs have separate first-valid searches. They are explicitly post-protocol coverage sensitivities; they do not replace the sparse original 80% comparison. Counterpart reuse, residual ability imbalance, partner identity and changing historical availability remain limitations of this observational design.

## Label controls

The saved maps preserve known topic labels within actual source, and source labels within actual origin × actual topic, separately by random fold. Unknown topics remain unknown. Each underlying event receives one map value across its repeated targets, and every model pair uses the same map.

The independent audit confirms the relevant within-stratum label counts and reproduces fitted global/type scores for sampled actual and shuffled rows. Actual origin, outcomes, model predictions and whole-pair test support remain fixed. No control is removed because it loses category fitting coverage or produces a negative gain.

Pair-level label counts and row/weighted category masses can still change under a full-panel event permutation because model coverage and event repetition differ. The logged coverage/mass changes are therefore part of the interpretation. These controls are descriptive structured comparisons, not exact causal permutation tests.

## Success and missing-value handling

All three outcome definitions require finite group references, group aggregation BI and whole-test aggregation/reference BI:

- Exact preservation: whole-test gain over the better test single >1e-10; neither selected group loses more than 1e-10 BI.
- Strict: whole and both selected-group gains each >1e-10 BI.
- Practical sensitivity: whole gain ≥0.5 BI; neither selected group loses more than 0.5 BI.

Equal category predictions count as preservation but not strict superiority. Undefined values are never promoted to success. Noncrossing rows lack two selected specialist groups; their group success is undefined rather than silently false or true. Saved summaries report the relevant finite denominators and are checked independently.

## Interpretation limits

The 80% training-coverage requirement leaves only one primary topic pair; broader topic statements must identify their lower-coverage analyses as sensitivities added after strict-control results were seen. Report missing support, failed matches, null/negative contrasts and dependence across reused events and models.

The tests establish that the code measures the declared between-category construct and evaluates its transfer without the audited leakage routes. They do not establish universal predictive validity, causal exploitation of category information, or superiority of category-aware aggregation over strong global baselines. Those conclusions must follow the actual effect sizes and limitations.
