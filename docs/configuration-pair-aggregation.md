# All exact configurations: fixed-base aggregation

## Scope and interaction

The user requested a complete extension after the existing-results lookup found
only 83 of 238 overview configurations with a matching earlier experiment.
Click or keyboard-activate a point in the market-performance overview to pin its
exact version, prompt, and information condition as the base of a new block.
Focus alone updates the inspector, not the experiment. Overview filters cannot
silently replace the pinned base. The block has independent partner filters.

Candidates are all 238 configurations in the existing overview catalog, including
all providers. For each base, consider every other exact configuration. Only
non-imputed Polymarket market targets with a valid freeze-time probability and
both model predictions are used. Dataset questions are excluded. Methods, both
constituents, and Polymarket use the identical pair-specific test target keys
`(date, source, event_id, horizon)`.

## Evaluation

- Attempt ten SHA-256 event splits, seeds 20260825 through 20260834. Assignment
  uses `(source, event_id)` so dates and horizons for the same event stay together.
- Compute A-to-B and B-to-A whenever both halves are nonempty. Report actual
  available directions out of 20. Do not manufacture splits when events cannot
  be separated. Zero-overlap and unseparable pairs stay visible as availability
  statuses rather than receiving fabricated scores.
- All estimable supports are calculated. Mark a view as small-support if any
  included training or test half has fewer than 50 targets. The UI can explicitly
  restrict to both halves >=50; it must not imply all displayed estimates meet
  that threshold or represent twenty independent experiments.
- Near-BI first retains individual directions with **training** BI gap <=2,
  then averages those directions. Empty views stay empty; no fallback.
- Train diversity coordinates: `1-prediction Pearson r`, adjusted POG,
  `1-high-loss lift`, `-adjusted-loss Pearson r`, and binary TV
  `mean(abs(p_base-p_partner))`. These values are already diversity-oriented.
  Pearson correlation is undefined if either vector is exactly constant,
  regardless of floating-point centering residuals. If any included direction
  has an undefined selected metric, its aggregate coordinate is null rather
  than a partial-fold coordinate paired with an all-fold outcome.
- Six methods: Simple Mean, Log-odds Mean, EC w=0.56, Piecewise Odds,
  Directional CF, and Best Single. Directional CF fixes the selected base as
  anchor and fits its two clipped C/D weights only on training observations.
  Missing training directions fall back to the base. Best Single is the better
  constituent on the whole test fold: hindsight, not deployable and not the
  per-question oracle.
- Raw and adjusted losses, and fold Brier Indices, are weighted by test target
  count. Train metrics and gaps are weighted by train count. Fraction gain is
  `(pooled reference adjusted loss - pooled method loss) / pooled reference loss`.
  Invalid/nonpositive gain denominators yield null. An undefined fold BI must
  not be silently omitted from a reported average.
- Triangles mark point-estimate aggregation BI above the pair's own matched-test
  market BI (difference greater than 1e-12). They are not significance tests and
  do not use the overview line.
- Configuration selection from a full-sample overview is exploratory. Parameter
  cross-fitting does not make that selection prospective or temporally OOS.

## Data contract (schema_version 1)

Lazy-load `data/configuration-pair-aggregation/manifest.json`, then the selected
entry's `file` relative to that directory. Never infer filenames from labels.

Manifest fields: `schema_version`, `generated_at`, `methods` (keyed metadata
objects with `label`), `method_order`, `metrics` (keyed objects with `label` and
`axis`), `metric_order`, `split`, `configurations`, `audit`.

`split` includes `repetitions:10`, `seeds`, `minimum_fold_overlap:1`, and
`near_bi_gap:2`. Each configuration includes `exact_configuration`,
`canonical_model_version`, `model_configuration`, `provider`, `prompt_type`,
`prompt_label`, `information_type`, `information_label`, `file`, and
`eligible_partner_count`.

Method IDs: `simple_mean`, `log_odds_mean`, `ec_w0_56`, `piecewise_odds`,
`cf_directional`, `best_single`.
Metric IDs: `prediction_diversity`, `adjusted_pog`, `high_loss_lift`,
`adjusted_loss_corr`, `total_variation`.

Each shard contains `schema_version`, `base_configuration` (exact string),
`base` (identity metadata), and `partners`. Each partner has `partner`
(identity metadata), `n_common`, `status`, optional `reason`, and `views`.
Statuses: `eligible`, `zero_common_support`, `insufficient_split_support`;
additional invalid-data statuses must be explicit.

`views` = `{all:{combined,a_to_b,b_to_a}, near_bi:{combined,a_to_b,b_to_a}}`.
Each leaf is null or an object containing:

- `fold_count`, `fold_ids`, `train_target_cells`, `test_target_cells`,
  `min_train_rows`, `min_test_rows`, `small_support`;
- `train_diversity` (five metric IDs with number/null values), `train_bi_gap`;
- `base`, `partner`, `market`, each with `raw_brier`, `adjusted_brier`,
  `brier_index`;
- `methods`, keyed by all six IDs, each with `raw_brier`, `adjusted_brier`,
  `brier_index`, `gain_vs_base`, `gain_vs_partner`, `gain_vs_market`,
  `beats_market`.

Undefined numbers serialize as null, never NaN. An unavailable BI comparison
must not produce a true `beats_market` flag. Additional diagnostics are allowed.
Retain a separate derived clean input/audit for independent sampled recomputation,
without publishing raw source files or modifying older experiment payloads.

## Reproduction and artifacts

Run from the repository root after preparing the existing scored panel and event
taxonomy:

```sh
.venv/bin/python -m analysis.configuration_pair_aggregation \
  --processed-root /path/to/forecastbench-processed-forecast-sets
```

The producer records input SHA-256 hashes, checks every configuration's support
and original overview score, and writes:

- `data/derived/configuration_pair_aggregation/clean_panel.csv.gz`: the audited,
  non-imputed input records and matched freeze probabilities;
- `data/derived/configuration_pair_aggregation/fold-results-manifest.json` and
  compressed fold chunks: actual per-direction counts, coordinates, fitted
  weights, scores, and reasons for undefined quantities;
- `data/derived/configuration_pair_aggregation/audit.json`: coverage, provenance,
  and source validation;
- `site/public/data/configuration-pair-aggregation/manifest.json` and 238
  configuration shards: lazy-loaded, public results with every partner's status.

After the first run, `--clean-cache
data/derived/configuration_pair_aggregation/clean_panel.csv.gz` avoids reparsing
the original forecast files. The cache is accepted only if its adjacent audit
matches the cache, scored-panel, taxonomy, and catalog hashes; reconstructed
supports and scores must also match. This reuses the original audited imputation
decisions rather than making new decisions without the source files.

`analysis.audit_configuration_pair_aggregation` implements its own arithmetic,
fold assignment, and aggregation rather than importing producer scoring helpers.
Its report and the pre-existing-public-data hash snapshot are stored under
`data/derived/configuration_pair_aggregation_audit/`.

## Validation

The complete experiment was explicitly authorized after the initial
existing-results lookup. The final run contains all 238 configurations and
28,203 unordered candidate pairs: 9,818 eligible, 18,381 without common targets,
and four with no separable event split. Every configuration has at least one
eligible partner. There are 196,210 unordered fold records (392,420 fixed-base
evaluations). Of the eligible pairs, 9,778 have 20 directions, five have 18, and
35 have 16; 3,616 have at least 50 targets in every included half.

Before the requested immediate GitHub push, the tracked Python tests passed
187 cases with one optional external-snapshot test skipped. The new interaction
tests passed all six desktop/mobile cases. The actual frontend loader parsed
all 238 final-schema shards with their 237 partners; the GitHub Pages-base
production build passed. The full frontend unit run passed 149 cases with one
resource-related timeout, and all five cases in that test file passed on an
isolated rerun without changing assertions. Forty producer/independent fixtures
include constant-vector edge cases and train-only fitting checks.

The longer independent full-artifact audit completed after the user requested
the immediate push. The passed
`data/derived/configuration_pair_aggregation_audit/report.json` records zero
errors across 238 configurations, 239 JSON files, 56,406 directed partner records,
and all 196,210 fold records. Identity, common support, event splits, training
Near-BI masks, schema, and reported gain arithmetic were checked for every pair.
An independent implementation directly recomputed 18 sampled pairs and 356
folds in both base orientations (712 fixed-base evaluations); all matched.
All 1,428 overview model/market score checks matched at tolerance 1e-12, and the
112 pre-existing public JSON files remained byte-identical.

The interrupted broad browser run is not reported as a completed full-suite
pass. GitHub Actions runs the full release suites and the GitHub Pages deployment;
no Aggrena deployment is part of this release.
