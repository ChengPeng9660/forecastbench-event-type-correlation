# Independent review: cross-category ability complementarity

Scope: mathematical and design review before evaluating this new analysis. The prior expanded `REPORT.md`, `METRIC.md`, and `CODE_AUDIT.md` were read. The new study remains exploratory on an already examined archive. This note does not certify results from code not yet audited, or make a novelty claim.

## 1. The object of interest

The user wants A and B to have close overall forecasting ability, with A stronger in some predeclared categories and B stronger in others. The primary construct is **organization of relative ability across categories**. It is not within-category prediction disagreement, and it does not establish that the models possess independent information.

Keep separate:

1. Overall ability comparability, assessed on training targets with a declared adjusted-BI gap threshold.
2. Between-category reciprocal advantage, assessed from the original, uncentered category risk differences.
3. Transfer of the training specialization pattern to other events.
4. Gain obtained by a named, train-fitted aggregation method.

An honest argument may support some of these links and reject others. A stronger conceptual match is not evidence of better out-of-sample ranking.

## 2. Exact between/within decomposition

Fix a pair, a retained set of categories, and common target weights w_i summing to one. If the original Dataset/Market-balanced weights are restricted, **condition those original weights** rather than rebalancing origins again. Every term below uses precisely that same support and weighting.

Let ℓ_Ai=(p_Ai−y_i)², ℓ_Bi=(p_Bi−y_i)², δ_i=ℓ_Ai−ℓ_Bi, π_g=P_w(G=g), and δ_g=E_w[δ_i|G=g]. Define:

    C_total   = (E_w|δ_i| − |E_w δ_i|)/2
    C_between = (Σ_g π_g |δ_g| − |Σ_g π_g δ_g|)/2
    C_within  = Σ_g π_g (E_w[|δ_i||g] − |δ_g|)/2.

Then, exactly,

    C_total = C_between + C_within.

All three are nonnegative by the triangle/Jensen inequalities. C_between is positive if and only if at least one positive-mass category favors A and another favors B. It is zero under one-sided category dominance, even if the size of the disadvantage varies greatly across categories.

Interpretation via increasingly informed loss oracles:

    C_total   = risk of better global single − per-question oracle risk
    C_between = risk of better global single − category oracle risk
    C_within  = category oracle risk − per-question oracle risk.

Here the category oracle chooses one entire constituent model per category. The within component measures additional **within-category winner switching**, not arbitrary probability disagreement. These are risk identities and hindsight potentials, not deployable forecasts.

Normalize every component only by the **same** Rbar=(E_wℓ_A+E_wℓ_B)/2. The normalized identity is then exact. Rbar=0 is undefined. A between-share C_between/C_total is undefined when C_total=0; a share near one can accompany negligible absolute complementarity, so it must not replace the magnitude score. Do not enter all three raw components as independent regressors: their exact identity makes them collinear.

Refining categories weakly increases C_between and decreases C_within while leaving C_total fixed. Therefore category granularity and category selection cannot be optimized on the outer test and then treated as evidence. Retained-category support thresholds and weighted coverage must be reported.

## 3. A direct explanation of whether learned specialization transfers

For a fixed, training-selected hard router r_g∈{A,B}, evaluate all quantities on the same test support and weights. Let R_oracle=Σ_gπ_g min(R_Ag,R_Bg). Then

    R_router − R_oracle
      = Σ_g π_g |δ_g,test| · 1{r_g selects the worse test constituent},

and hence

    R_best_single − R_router
      = C_between,test − misidentification_regret.

This is an exact decomposition: **available cross-category advantage minus the loss from identifying the wrong specialists**. It is a useful explanatory diagnostic rather than another selection metric. Test winners are used only to evaluate the decomposition, never to fit r_g.

The equality is in Brier-risk units, not BI points: the square-root BI transformation is nonlinear. Label harmonized per-category scores as conditional adjusted BI rather than silently presenting them as the earlier within-category-rebalanced official comparison.

The identity requires constant selection within each category. Unknown or unsupported categories must either be included as explicit fallback groups, or the identity must be reported only on the retained support. A retained-support C_between cannot be subtracted directly from a full-sample aggregation gain.

At population level, if all training-selected categories identify their true test winners and C_between>0, the category router improves on both global single models. Empirical success requires estimating these winners well enough; no training-only score guarantees that.

## 4. Fixed averaging: correction to the proposed counterexample

For any two probability forecasts and the same weights,

    R_mean = (R_A+R_B)/2 − E_w[(p_A−p_B)²]/4,
    R_best − R_mean = E_w[(p_A−p_B)²]/4 − |R_A−R_B|/2.

Consequently, **exact equal risk on the evaluation distribution implies that simple mean cannot be worse than either constituent**. More generally, any fixed convex mixture with weight α has risk R_A−α(1−α)E[(p_A−p_B)²] when R_A=R_B. A claim that simple mean can hurt under exact equal evaluation Brier would be mathematically false.

The valid near-equality counterexample is:

- Two equally weighted categories, y=0 in both.
- A predicts (0.15,0.15), B predicts (0.14,0.16).
- R_A=0.0225, R_B=0.0226; zero-offset BI gap≈0.03330.
- B is better in category 1 and A in category 2; C_between=0.00145>0.
- Simple mean predicts (0.145,0.155), with risk 0.022525, which is **0.000025 worse than A**.

Thus close ability plus crossing categories does not guarantee that a fixed averaging method beats the stronger constituent. Exact training equality also does not imply equal test risk. Nonlinear odds-based pools are not governed by the fixed convex probability-pool guarantee.

An even stronger magnitude demonstration keeps **all category risks and all three POG components the same**, with exactly equal overall risk:

- In each of two equally weighted categories, strong-model risk is 0.02 and weak-model risk is 0.10; swap A/B between categories. Both overall risks are 0.06, C_total=C_between=0.04 and C_within=0.
- Version I: predictions are constant sqrt(0.02) and sqrt(0.10) within each category, with y=0. Simple-mean gain is about 0.0076393.
- Version II: in each category's 100 y=0 questions, the weak model predicts one on 10 questions; the strong model predicts one on two of those same questions; all other forecasts are zero. Swap A/B in category 2. Simple-mean gain is 0.02.
- Category-oracle routing gain is 0.04 in both versions.

Therefore the full loss-winner decomposition does not uniquely determine simple-mean gain. Probability cross moments still matter to a fixed pool, while category specialization has a direct interpretation for category routing. This is a limitation of the claim, not a reason to redefine the user's target as within-category disagreement.

## 5. Type-specific convex weighting and the role of the global baseline

Let p_α=p_A+α(p_B−p_A), α∈[0,1]. A population category-specific convex oracle satisfies

    min_α Σ_gπ_g R_g(α) − Σ_gπ_g min_α R_g(α) ≥ 0.

This is the potential value of letting weights depend on category beyond the best global convex weight. It is a different quantity from C_between. With Brier loss and genuine positive/negative category risk differences, the category-optimal weights lie on opposite sides of 0.5, so the oracle increment is strictly positive when the relevant categories have positive mass. However, fitted finite-sample type weights can lose to the fitted global mixture because of estimation error.

Conversely, type-specific convex weights may help even when C_between=0: both optimal weights can lie on the same side of 0.5 but differ across categories. A type-weighting improvement alone therefore does not establish the user's stricter reciprocal-specialization pattern. Report both the pattern and the incremental method gain.

Preserve the original six methods. Global convex, type-shrunk, hard routing, hierarchy, and inner-CV-gated type weighting are additional research algorithms, each explicitly labeled. Gate selection must use inner out-of-fold performance; after selection, refit the permitted model on outer training only. Failed gates fall back to the fixed global alternative. Unknown/insufficient groups are included when scoring the gate if the deployed outer method will encounter them.

## 6. Common-support matching: accepted design and remaining conditions

The revised anchor design is materially stronger than comparing arbitrary pairs:

- Fix anchor A; compare high-between partner B against lower-between/noncrossing partner C.
- Recompute both pairs on the **identical A/B/C target intersection** in train and test.
- Recheck Near-BI eligibility, mean ability, gap, category support/coverage, total normalized POG, and the between-component difference on that shared training support. Original pair eligibility is insufficient after taking the three-way intersection.
- Choose matches, ordering and limits using training data only. Declare the finite search order and report failed matches, overlap loss and balance rather than widening thresholds until enough matches succeed.
- The primary comparison of type-shrunk-minus-global gains isolates the incremental value of conditional weighting more directly than raw aggregate BI alone.

Shared support makes category/source composition and weights identical within each contrast. A balance table must still report the achieved mean ability, gap, total POG, raw mean loss, training support and between-component difference. Near matching is not exact equality, and partner identity, calibration, model family and training-period effects remain possible confounders. The matched contrast is observational, not a causal effect of changing specialization.

Matching total POG means that increasing the between component reallocates existing per-question oracle potential away from the within component. This is precisely an “organization by category” comparison. Do not condition on test Near-BI, test transfer, realized gain, or test score finiteness beyond transparent availability handling when constructing the primary scientific matching rule.

## 7. Negative controls and composition checks

- For topic analysis, shuffle event-level topic labels **within actual source**.
- For source analysis, shuffle source labels **within topic × actual Dataset/Market origin**. Shuffling across actual origins would create mixed-origin pseudo-sources and change the original structural weighting problem.
- Keep actual model forecasts, outcomes, target identities, origin labels, train/test assignment, and exact model availability unchanged. Refit only on training labels/outcomes after each shuffle.
- Preserve the event cluster through all its dates/horizons. Temporal repeated events need a declared rule for whether a pseudo-label is shared across periods; independently changing pseudo-labels over time adds a form of concept drift absent from a fixed category.
- Preserved event-label counts do **not** imply preserved target-row counts or weighted category mass: events have different numbers of dates and horizons. Report category event counts, row counts, weighted masses, eligibility and fallback coverage for true and shuffled labels.
- If source/topic strata permit little label exchange, report that limitation; a nearly unchanged null is not a strong falsification test.

These are descriptive negative controls. Conditional exchangeability is unproven, so do not present a count of wins against shuffled datasets as an exact causal/randomization p-value. Retain failed or degenerate shuffles and their support reasons.

## 8. Honest claim map

| Claim | Required evidence | What it does not establish |
|---|---|---|
| The metric measures crossing category ability | Same-support decomposition and dominance counterexamples | Independence from all ability confounding |
| The category pattern is more than training noise | Outer-event transfer of frozen training signs, signed inner CV, uncertainty | Temporal stability or external replication |
| Organization by category adds value | Shared-anchor/common-support matching at similar total POG; type-over-global comparison; conditional shuffles | A causal effect or superiority for every aggregator |
| A pair satisfies the user's example | Near training overall BI; two frozen opposite specialists; test overall gain plus category preservation | Universality across versions, categories or future dates |
| The argument generalizes | Consistency across stated views, families and genuinely later untouched evaluation | Independence of reused splits or discovered examples |

The best defensible conclusion may be that between-category complementarity is the correct descriptive construct, with specific successful cases, but currently weak or unstable ability to rank future gains. Preserve that possibility explicitly.

## 9. Required implementation audit

Before publication of this package, independently verify:

1. C_total=C_between+C_within on every audited row, including mixed-origin categories, unknown labels, exact ties and zero risks.
2. Raw and adjusted loss differences cancel offsets on common weights; every conditional category profile agrees with fitting direction under the harmonized weighting rule.
3. The near-equality counterexample and exact-equality non-harm theorem; equal decomposition/different mean-gain construction.
4. Training gates, category choices, matching and global/type weights cannot change after perturbing only outer-test outcomes.
5. Matching recomputes identical triple support and uses only training values; shuffle diagnostics preserve the intended invariants.
6. Hard-router gain equals test between potential minus misidentification regret on the same scope.
7. All reported finite-value denominators, preservation/strict definitions and failed/unsupported cases are handled explicitly.

Current status: design and identities reviewed; toy calculations independently checked. Main new experiment code and numerical outputs are pending separate review.
