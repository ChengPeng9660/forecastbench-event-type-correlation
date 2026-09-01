# Within-topic POG complementarity results

## Main result

The pre-specified main screen requires overall training BI gap <= 3, within-topic training BI gap <= 1, and at least 30 training events in the topic. Under Directional CF and selected-topic evaluation, 85,113 pair-topic-direction rows pass the training screen and 84,626 have a defined held-out topic outcome.

Normalized POG is positively associated with held-out aggregation gain. All eligible rows average +0.232 BI versus the better test single. The training top-POG quartile averages +0.619 BI and beats both test models in 67.3% of defined rows. The top-minus-all gain difference is positive in all ten fixed split directions.

This pattern remains after a descriptive linear adjustment for overall mean BI, within-topic mean BI, both BI gaps, log topic support, topic fixed effects, and split-direction fixed effects: standardized normalized-POG beta = +0.170 and incremental R2 = 0.023. Normalized POG has correlation +0.011 with overall mean training BI and +0.175 with within-topic mean BI under the main screen.

## Why normalization matters

Raw Adjusted POG is more predictive in this sample: its Directional-CF top quartile averages +0.643 BI, standardized adjusted coefficient is +0.352, and incremental R2 is 0.067. But raw POG correlates -0.589 with mean topic BI, showing substantial remaining loss-scale/ability association. Normalized POG reduces this association while retaining positive OOS screening value. The clean claim is therefore not that POG is ability-free; it is that explicit overall/topic ability gates plus loss normalization materially reduce the confound and leave useful held-out signal.

## Aggregation methods

For normalized-POG top-quartile rows on the selected topic, mean gains versus the better single are -0.006 BI for Simple mean, +0.210 for Log-odds mean, +0.297 for EC w=0.56, +0.354 for Piecewise odds, and +0.619 for Directional CF. The ranking screen does not change any aggregation formula.

## Topic heterogeneity

The normalized-POG Directional-CF pattern is strongest in Politics (+1.252 BI top quartile versus +0.712 all eligible), Finance (+0.381 versus +0.133), Health (+0.192 versus +0.025), and Climate / Weather (+0.221 versus -0.042). It does not generalize uniformly: Sports is negative (-0.126 top quartile versus -0.049 all), while Technology and Entertainment / Culture have very small main-screen samples and negative estimates. These sparse or negative domains should be shown rather than pooled away.

## Interpretation limits

POG is a retrospective oracle diagnostic, not a deployable question router. Pair rows and split directions reuse events, so counts are not independent trials and no significance claim is made. Top-quartile comparisons are ranked only by training POG; held-out outcomes never choose partners. The results support within-topic reciprocal error correction as a screening idea, with clear domain and method dependence.
