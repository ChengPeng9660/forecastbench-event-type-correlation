# Model + market aggregation for every exact configuration

The final Markets block compares each exact model configuration combined with
Polymarket. It retains all 238 identities from the first block, including their
prompt and information condition. Activating a configuration in the first block
highlights that same exact configuration in this block; it does not substitute a
different prompt or information condition of the same model version.

Each point is one **model–Polymarket pair**. Polymarket is the fixed base, the
model is the partner, and Polymarket is also the performance reference. This is
separate from the existing model–model partner experiment. Existing results are
not overwritten.

## Evaluation and interpretation

- Use the audited non-imputed input snapshot from the configuration-pair
  experiment. Before loading, verify its SHA-256 and the original scored-panel,
  taxonomy, and full-catalog hashes against the adjacent audit. Reconstruct all
  catalog supports and six model/market scores. The audited producer source hash
  must match the imported configuration-pair calculation module as well.
- Restrict to shared Polymarket market targets with a valid freeze-time market
  probability. Dataset questions are excluded. The exact target key is date,
  source, event ID, and horizon. All methods, the model, and the market use the
  same pair-specific test keys.
- Attempt the same ten event splits, seeds 20260825–20260834. Split by source
  and event ID, keeping an event's dates and horizons together. Both A→B and
  B→A are used; Combined pools the available directions. Internal event-disjoint
  cross-fit does not establish future-time or external generalization.
- X uses training targets: prediction diversity `1 − prediction Pearson r`,
  Adjusted POG, high-loss diversity `1 − high-loss lift`, adjusted-loss diversity
  `− adjusted-loss Pearson r`, or TV `mean(abs(p_market − p_model))`.
- Y is the opposite-fold aggregation's raw Brier or Brier Index. Raw and
  adjusted losses and fold Brier Indices use test-target weighting. X and the
  train BI gap use train-target weighting. An undefined metric or BI in any
  included direction makes that aggregate coordinate null; there is no silent
  partial-fold substitution. Therefore Combined BI need not equal a BI computed
  once from the pooled adjusted loss.
- Six unchanged methods are available: Simple Mean, Log-odds Mean, EC w=0.56,
  Piecewise Odds, Directional CF, and Best Single. Directional CF fits clipped
  upward/downward C/D weights on training observations with **Polymarket as its
  anchor**. An unobserved training direction falls back to the market. Best
  Single chooses the better whole-test-fold constituent in hindsight and is
  explicitly not deployable.
- Near-BI retains each direction only when its **training** model–market BI
  gap is at most two, before aggregation. All eligible imposes no such filter.
  Support below 50 is flagged, not excluded by default. Repeated test cells are
  not independent new events.
- All points retain provider-colored circles. The optional **Highlight market
  wins** checkbox adds a check badge to a point only when it beats its own
  matched-test market on the selected Y metric: higher BI or lower Raw Brier,
  with a `1e-12` tolerance. Ties have no badge. The checkbox defaults off and
  does not filter points or change coordinates. The win-count KPI uses those
  same comparisons and gives every displayed configuration equal weight.
- Neither this block nor the model-performance overview has a shared market
  reference line: different configurations cover different events. Each
  inspector retains its own matched-market scores. Badge/count comparisons
  are point estimates, not significance tests. The published experiment's
  `beats_market` field remains BI-based and unchanged; the UI derives a
  separate Raw-Brier comparison when that Y metric is selected.

Selection from the full-sample first block remains exploratory even though
aggregation parameters and diversity coordinates are cross-fitted.

## Artifacts and schema

The standalone producer is `analysis/model_market_aggregation.py`. It writes:

- `site/public/data/model-market-aggregation/summary.json`: schema version 1,
  scope, fixed-market identity, methods/metrics, split/aggregation definitions,
  238 configuration points, audit counts, and portable hashed provenance.
- `data/derived/model_market_aggregation/fold-results-manifest.json` and its
  compressed fold file: actual per-direction support, diversity, training
  selection, fitted weights, reference scores, and method scores.
- `data/derived/model_market_aggregation/audit.json`: input verification,
  catalog reconstruction differences, counts, and the public summary hash.

Each point has `configuration` with the existing eight exact identity fields,
`n_common`, `unique_event_count`, `status`, `support_sha256`, available dates,
`maximum_fold_count`, `skipped_splits`, and `views`. Unavailable values stay null
and unavailable pairs retain explicit statuses.

`views` is `{all:{combined,a_to_b,b_to_a},near_bi:{combined,a_to_b,b_to_a}}`.
Each leaf is null or the existing `ConfigurationPairView` contract: fold
support, training diversity/gap, `base`, `partner`, `market`, and six `methods`.
Here `base` always equals `market`; `partner` is the model. The `beats_market`
flag uses the view's BI comparison and `gain_vs_base` equals `gain_vs_market`.
Public provenance never contains local absolute paths.

## Reproduction and validation

This artifact was calculated with scoring dependencies and the overview catalog
from commit `7c5eed04e87416a86fd5bdddb5c709ad7732230a`. Later commits add high-loss
diagnostics to those files. Running the producer directly against the newer
checkout is expected to fail the audited source or catalog hash guard. Do not
relax either guard or alter the recorded cache audit. Use this pinned snapshot
procedure instead, starting anywhere inside the repository. It requires the
existing audited cache, its adjacent audit, `data/build/scored_panel.csv`, and
`data/build/event_taxonomy.csv`, plus the repository's Python environment.

The commands create a new scratch directory and write reproduced results there;
they leave the published artifacts and current checkout unchanged.

```sh
model_market_repo="$(git rev-parse --show-toplevel)"
model_market_baseline=7c5eed04e87416a86fd5bdddb5c709ad7732230a
mkdir -p "$model_market_repo/work"
model_market_snapshot="$(mktemp -d "$model_market_repo/work/model-market-reproduce.XXXXXX")"
git -C "$model_market_repo" archive "$model_market_baseline" \
  analysis \
  site/public/data/polymarket-aggregation/market-diversity-performance.json \
  | tar -x -C "$model_market_snapshot"
cp "$model_market_repo/analysis/model_market_aggregation.py" \
  "$model_market_snapshot/analysis/model_market_aggregation.py"
cp "$model_market_repo/analysis/audit_model_market_aggregation.py" \
  "$model_market_snapshot/analysis/audit_model_market_aggregation.py"
(
  cd "$model_market_snapshot"
  "$model_market_repo/.venv/bin/python" -m analysis.model_market_aggregation \
    --clean-cache "$model_market_repo/data/derived/configuration_pair_aggregation/clean_panel.csv.gz" \
    --panel "$model_market_repo/data/build/scored_panel.csv" \
    --taxonomy "$model_market_repo/data/build/event_taxonomy.csv" \
    --catalog "$model_market_snapshot/site/public/data/polymarket-aggregation/market-diversity-performance.json" \
    --output-dir "$model_market_snapshot/reproduced/derived" \
    --site-output-dir "$model_market_snapshot/reproduced/public" \
    --repository-root "$model_market_repo" \
    --baseline-commit "$model_market_baseline"
)
```

The imported calculation module must still match its recorded source SHA-256
`520b8d58ac5abe77c3722ec79e775a4bcb703102195ee09f0985a1cb78c88d8e`, and the
snapshot catalog must match
`a061383c84cac9e5647319d4c7886309c94f7a409f20b839fcbf7b8a1535db67`.
The cache, scored panel, and taxonomy must also pass their recorded hash checks.
The producer writes dependency hashes and the pinned baseline commit into its
provenance. A reproduction gets a new generation timestamp and scratch-relative
output paths, so its complete summary-file hash need not equal the published
one even when all numeric results and fold records agree.

Run the independent exhaustive audit against the reproduced artifacts in the
same shell, using the same baseline catalog and real audited cache:

```sh
(
  cd "$model_market_snapshot"
  "$model_market_repo/.venv/bin/python" -m analysis.audit_model_market_aggregation \
    --summary "$model_market_snapshot/reproduced/public/summary.json" \
    --clean "$model_market_repo/data/derived/configuration_pair_aggregation/clean_panel.csv.gz" \
    --catalog "$model_market_snapshot/site/public/data/polymarket-aggregation/market-diversity-performance.json" \
    --derived "$model_market_snapshot/reproduced/derived" \
    --output "$model_market_snapshot/reproduced/audit-report.json"
)
```

To audit the published artifact without recalculating it, use the same snapshot
and replace only the audit command's `--summary` and `--derived` arguments with
`"$model_market_repo/site/public/data/model-market-aggregation/summary.json"`
and `"$model_market_repo/data/derived/model_market_aggregation"`, respectively.
Keep `--catalog` pointed at the pinned snapshot and write `--output` to scratch.
Unit tests can also be run from the current repository:

```sh
.venv/bin/python -m pytest \
  tests/test_model_market_aggregation.py \
  tests/test_model_market_aggregation_independent.py
```

The generated sample has 238 eligible configurations, all with 20 available
directions, giving 4,760 fold records over 47,557 configuration–target rows.
There are 137 configurations with at least 50 targets in every included half;
97 have at least one training Near-BI direction. Model/market catalog score
reconstruction differs by at most `1.42e-14` from the published full-sample
catalog. Unit fixtures independently compute market-anchored CF predictions and
check held-out outcome mutation, event grouping across dates/horizons, exact
identity, undefined coordinates, matching market comparisons, archive integrity,
and rejection of changed cached inputs or producer source.

The saved independent report is
`data/derived/model_market_aggregation_audit/report.json`. It passed with zero
errors after directly recomputing all 238 configurations, all 4,760 folds, all
six methods and five training metrics, all/near-BI directional and combined
views, and all archived market-anchor weights. It also checked 1,428 full-sample
catalog score scalars, exact identities, common support, event separation,
train-only Near-BI selection, weighting, null preservation, matched-market
comparisons, and archive checksums. The producer and independent unit suites
passed 9 and 13 tests, respectively.

This is an independent arithmetic audit of the previously cleaned cache. It
does **not** reread the original provider JSON files or original freeze
snapshots and therefore does not independently re-establish their extraction
or imputation decisions. The cached-input hashes tie those decisions to the
earlier audit. Repeated event splits remain internal validation; configurations
that received freeze probabilities are market-informed, and Best Single remains
a hindsight reference.
