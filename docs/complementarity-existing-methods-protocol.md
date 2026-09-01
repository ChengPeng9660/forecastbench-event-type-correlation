# Full exact-configuration category-complementarity experiment

## Question

Can training-only category specialization identify pairs with similar overall
ability that aggregate well on event-disjoint test questions when model version,
prompt, and information condition are all retained as distinct configurations?

Category labels are used only to measure and screen complementarity. They never
route forecasts or alter an aggregation formula.

## Configuration universe

- The unit is an exact `model version × prompt × information condition` string.
- All clean LLM configurations in the archived ForecastBench files are eligible.
- The moving 2024 `GPT-4o` alias is pinned to `GPT-4o-2024-05-13` for every
  prompt and information condition.
- Imputed rows, unresolved questions, nonbinary outcomes, baselines, external
  submissions, ensembles, crowd aggregates, and superforecaster variants are
  excluded by fixed rules.
- No configuration is chosen or discarded using its score.

The resulting panel contains 313 exact configurations from 96 canonical model
versions: 190 zero-shot, 122 scratchpad, and one configuration without a prompt
label. Information conditions comprise 142 no-extra-information, 141 freeze,
14 news, 12 news-plus-freeze, two web-search, and two web-search-plus-freeze
configurations.

## Scores and support

- Each pair is evaluated on its common target rows.
- Every common row receives weight `1/n`; Dataset and Market are not forced to
  receive equal total weight.
- The archived official question fixed effect and its date/origin normalization
  remain in adjusted Brier and Brier Index.
- Five deterministic event-cluster splits (`20260910` through `20260914`) are
  evaluated in both directions. The primary view trains on fold A of split
  `20260910` and tests on fold B.
- A direction requires at least 100 distinct events in both train and test.
  Train and test event identities must be disjoint.

## Training-only selection

Overall ability proximity is the absolute difference between the two training
BI values. Results are reported separately for limits of 3 and 5 BI points.
Test BI never enters eligibility.

The event-type view uses seven mutually exclusive displayed domains: Health,
Politics, Sports, Finance, Technology, Climate / Weather, and Entertainment /
Culture. Science is included in Health, conflict in Politics, economics in
Finance, and AI in Technology. Climate / Weather and Entertainment / Culture
remain combined domains. This is a deterministic coarsening of the prior
audited semantic taxonomy; it reads neither outcomes nor model forecasts.

For event type and question source/platform separately, only categories with at
least 30 training events enter the profile. At least two supported categories
and the selected row-mass coverage threshold are required. The crossed-strength
cohort additionally requires configuration A to lead by at least 1 training BI
point in one category and configuration B to lead by at least 1 training BI
point in another.

The training complementarity coordinate is

`D_type = min(R_A, R_B) - sum_g pi_g min(R_A,g, R_B,g)`,

divided by the two configurations' mean raw Brier risk on supported training
rows. `R` is raw Brier risk and `pi_g` is category row mass. This quantity is
the part of reciprocal error advantage attributable to the identity of the
better configuration changing across categories. It is computed on training
questions only.

## Pair-scope controls

Every exact configuration is included in the main scope. Two prespecified
diagnostic scopes retain the same observations while testing identity
confounding:

1. `different_model_version` excludes pairs whose canonical model version is
   the same.
2. `matched_conditions` requires the same prompt class and information
   condition on both sides. Because exact configurations are unique, such a
   pair necessarily contains different canonical model versions.

## Unchanged aggregation methods

All methods use the same pair and test targets.

1. Simple mean: `(p_A + p_B) / 2`.
2. Log-odds mean: `sigmoid((logit(p_A) + logit(p_B)) / 2)`.
3. EC, `w = 0.56`: `sigmoid(0.56 × (logit(p_A) + logit(p_B)))`.
4. Piecewise odds: the existing threshold-5 piecewise transform of summed
   logits.
5. Directional CF: choose the better training configuration as anchor. For
   `d = p_partner - p_anchor`, fit a clipped closed-form coefficient separately
   on `d >= 0` and `d < 0`, then apply those two fixed coefficients to test.

Only Directional CF uses training outcomes. It fits on the whole training fold;
categories do not enter either coefficient.

## Endpoints

The primary endpoint is aggregation test BI minus the higher BI of the two
single configurations on identical test targets. The better test single is a
hindsight reference, not a selectable method. Secondary diagnostics include
the fraction beating both singles, gain over the training-selected single,
raw-Brier reduction, crossed-strength persistence, ability tiers, condition
matching, and stability over ten event directions.

This is internal holdout evidence from a repeatedly studied historical archive.
It is descriptive and is not a fresh external confirmation.
