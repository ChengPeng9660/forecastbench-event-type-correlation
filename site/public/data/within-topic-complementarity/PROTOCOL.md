# Within-topic POG complementarity protocol

## Question

Can two exact model configurations have similar overall and within-topic ability, yet make their smaller errors on different forecast targets inside that topic, and does that training pattern predict held-out aggregation gain?

## Unit and data

The unit is an exact model version x prompt x information condition pair, a seven-domain topic, and one fixed train-to-test direction. The frozen panel contains 313 configurations, 26,531 targets, and 3,670 events. No imputed forecasts are used.

## Split and selection

Five deterministic event-level half splits yield ten directions. Events never cross train and test. Partner eligibility uses only training data: overall adjusted-BI gap <= 3 or <= 5, topic adjusted-BI gap <= 1, <= 2, or <= 3, at least 20, 30, or 50 training events in the selected topic, and the requested exact-configuration scope. Test support and outcomes never select or rank a pair.

## Within-topic POG

For target i in topic g, let L_Ai and L_Bi be squared Brier losses. The official question fixed effect is identical for both models on the same target and therefore cancels in their loss difference. Define

    POG_g = min(mean((L_B-L_A)_+), mean((L_A-L_B)_+)).

This equals min(mean adjusted loss A, mean adjusted loss B) minus the mean per-target oracle adjusted loss. It is positive only when each model rescues some loss from the other. Normalized POG divides POG by the two-model mean raw Brier loss within the topic. This normalization reduces scale differences after the BI-gap controls; it does not turn the oracle into a deployable router.

## Evaluation

Partners are ranked by training POG. The five existing aggregation formulas are unchanged: Simple mean, Log-odds mean, EC w=0.56, Piecewise odds, and Directional CF. Their outputs are evaluated on the other event half against the better of the two single models on either the selected topic or the whole test support. A selected-topic outcome is reported only with at least 20 test events; this affects whether Y is defined, never pair selection.

## Weighting and dependence

Every common target row receives equal weight within the evaluated sample. There is no Dataset/Market rebalancing. Repeated split directions and pairs reuse events and are not independent observations. Correlations and win rates are descriptive.
