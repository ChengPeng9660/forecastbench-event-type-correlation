# Near-skill category complementarity with existing aggregation methods

## Research question

Can training-only category specialization identify pairs of similarly skilled
models that aggregate well on different, held-out events when the aggregation
rule itself does not use category labels?

The category analysis and the aggregation rule are deliberately separated.
Event type or question source/platform is used only to measure complementary
strengths and define the model-pair cohort. It never routes predictions, selects
a category-specific model, or fits a category-specific aggregation weight.

## Sample and scores

- 94 exact plain-zero-shot configurations with no extra information.
- Imputed or repaired predictions are excluded.
- Each pair is evaluated on its common forecast targets.
- Every common target receives weight `1/n`; Dataset and Market are not forced
  to receive equal total weight.
- Official per-target difficulty offsets remain in adjusted Brier and Brier
  Index (BI).
- Five fixed event-cluster splits are evaluated in both directions. Train and
  test events are disjoint. The page's pair explorer uses split `20260910`,
  train A to test B; the stability view reports all ten directions.

## Training-only pair selection

Overall ability is controlled using the absolute training BI gap. The main
limit is 3 BI points; 5 BI points is a wider sensitivity analysis. Test BI never
enters pair eligibility.

For each grouping dimension, only categories with at least 30 training events
enter the category profile. At least two supported categories and the selected
coverage threshold are required. The crossed-strength cohort additionally
requires model A to lead by at least 1 BI point in one training category and
model B to lead by at least 1 BI point in another.

The plotted training complementarity coordinate is

`D_type = min(R_A, R_B) - sum_g pi_g min(R_A,g, R_B,g)`,

divided by the two models' mean raw Brier risk on the supported training rows.
Here `R` is raw Brier risk and `pi_g` is category row mass. The metric is large
when the better model changes across categories, even though overall training
ability is similar.

## Existing aggregation methods

All five rules are the pre-existing implementations and use identical pair/test
support:

1. **Simple mean:** `(p_A + p_B) / 2`.
2. **Log-odds mean:** `sigmoid((logit(p_A) + logit(p_B)) / 2)`.
3. **EC, w = 0.56:** `sigmoid(0.56 * (logit(p_A) + logit(p_B)))`.
4. **Piecewise odds:** the existing threshold-5 piecewise transform of the
   summed logits.
5. **Directional CF:** choose the higher-BI training model as the anchor. Let
   `d = p_partner - p_anchor` and `r = y - p_anchor`. Separately for `d >= 0`
   and `d < 0`, fit `alpha_s = clip(E[r d 1_s] / E[d^2 1_s], 0, 1)` on the
   entire training support. Apply the two fixed weights on the test fold as
   `q = p_anchor + alpha_s d`.

Only Directional CF uses training outcomes to fit aggregation weights. Its two
weights are fit over the whole training support and are reused unchanged for
every category. The other four rules are fixed and outcome-blind.

The stronger single model on the test fold is a hindsight reference, not a
selectable aggregation method.

## Endpoints

The primary endpoint is the selected method's test BI minus the higher BI of the
two single models on the identical test targets. Secondary summaries report the
share of pairs that beat both singles, gain over the model selected by training
BI, raw Brier reduction, sensitivity to BI-gap limits 3 and 5, and stability
across the ten event directions.

This is internal event-holdout evidence from a repeatedly studied archive. It
does not establish a causal or externally validated effect of semantic category
complementarity.
