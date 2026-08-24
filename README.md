# ForecastBench Event-Type Model Dependence Atlas

An auditable, reproducible analysis of pairwise model dependence in ForecastBench by event type.

**Interactive atlas:** <https://chengpeng9660.github.io/forecastbench-event-type-correlation/>

The project reports three outcome-level diagnostics on the official fixed-effect scoring sample:

- Adjusted Pairwise Oracle Gain (lower indicates higher model dependence).
- Adjusted High-Loss Lift at the 0.25 threshold (higher indicates higher model dependence).
- Adjusted-Loss Pearson Correlation (higher indicates higher model dependence).

The website orients every pairwise view toward model dependence: pale purple
means lower dependence and deep purple means higher dependence. Published
metric values keep their original formulas and scales; only their display
direction is unified.

The repository separates official provenance dimensions (`Dataset`/`Market` and source) from a clearly labeled derived topic taxonomy. Large raw ForecastBench files are not vendored; reproducible commands, source manifests, derived public results, audit reports, and the GitHub Pages explorer are included.

## Released analysis

- 13,661 classified event-date rows and 8,204 unique `(source,event_id)` events.
- Seven analysis-eligible semantic topics, two official origin slices, and nine official source slices.
- 1,046,424 raw scored model-target rows from 263 exact clean-LLM configuration names.
- An outcome-blind version-selection stage reduces these to 306,996 rows from 70 distinct model versions: 68 plain zero-shot representatives, one zero-shot-with-web-search representative, and one configurationless model.
- 2,415 global unordered version pairs and 43,470 pair-slice rows.
- 11,529 pair-slice rows meet the default common-support threshold of 50.
- 21,252 distinct official `(date,source,event_id,horizon)` targets appear in the analytical slices.
- Zero clean-candidate JSON read errors and zero scored rows missing the taxonomy join.

The taxonomy is derived, versioned as `forecastbench-topic-v1.1.0`, and not an official ForecastBench field. All 61 initial multi-topic rows (17 unique events) were manually reviewed. Eleven analysis-eligible rows remain explicitly review-required because their resolution predicates are genuinely cross-domain. Unrecoverable generic-pair templates and unmatched visible questions are excluded from semantic-topic slices but retained in official origin/source slices.

The atlas provides focal-model filters, pair rankings, and downloadable results
for all 70 model versions. A URL-persistent heatmap selector lets readers show
any 2–30 versions in both the event-type and global matrices; without a custom
selection, the 30 highest-coverage models are shown. The downloadable and
archived tables retain the full filtered pair universe.

Prompt, scratchpad, news, web-search, and freeze-value suffixes are not treated
as separate models. The analysis keeps one actual zero-shot forecast series per
version; it does not average configurations or select them using outcomes.
Dates and tokens such as `Preview`, `Exp`, reasoning mode, and model size remain
part of the version identity. The complete 263-to-70 mapping is published in
`data/derived/model_version_mapping.csv`.

The cross-event-type stability experiment follows every one of the 2,415
global model-version pairs across all 21 unordered combinations of the seven
semantic topics. Its primary view asks whether a pair that is dependent in one
topic remains dependent in another among pairs that are near-BI in both. A
complete 50,715-row audit archive retains ineligible and undefined cases
rather than selecting them away.

The global baseline pools targets without an event-type split and includes a
three-metric pairwise heatmap over the same 70-version clean universe. Its
compact browser view displays 30 high-coverage models in release order while
all models remain filterable. The baseline then compares its pair ordering with
each topic. Its primary transfer view removes the selected topic before
computing ranks, avoiding mechanical self-inclusion. The release also tests
each focal model's partner ordering and reports individual-model BI rank as a
separate ability control.

## Interpretation

The three statistics are descriptive diagnostics of realized, difficulty-adjusted losses:

- POG is hindsight-based oracle headroom, not a deployable aggregation rule.
- High-loss lift can be undefined when a model never crosses the severe-loss threshold; such values are published as `null` with a reason.
- Correlation can be undefined for constant losses or inadequate support; it is never silently replaced by zero.

The primary analysis pools targets across dates. It aligns with the earlier experiment's official fixed-effect scoring primitive and metric formulas, but it is not a reproduction of the earlier per-date pair-cell design. Repeated events, topic/source confounding, and the lack of clustered uncertainty mean the release should be used as a descriptive atlas, not as a causal or significance result.

## Reproduce

Python 3.11+ and Node 22 are recommended.

```bash
python -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
cd site && npm ci && cd ..

make analysis \
  FORECASTBENCH_EVENTS=/local/path/resolved_events_merged.csv \
  FORECASTBENCH_PROCESSED_ROOT=/local/path/forecastbench-processed-forecast-sets \
  FORECASTBENCH_FIXED_EFFECTS=/local/path/question_fixed_effects.json \
  BUILD_TIMESTAMP=2026-08-18T18:13:56Z

make test
npm --prefix site run build
npm --prefix site run test:e2e
```

See [`docs/taxonomy.md`](docs/taxonomy.md), [`docs/methodology.md`](docs/methodology.md), [`docs/data-provenance.md`](docs/data-provenance.md), and [`docs/experiment-log.md`](docs/experiment-log.md). Machine-readable audits are in `site/public/data/audit.json` and `data/derived/analysis_audit.json`.

The cross-topic result and its interpretation boundary are summarized in
[`docs/cross-event-type-stability.md`](docs/cross-event-type-stability.md),
with a standalone machine-readable audit in
`data/derived/cross_type_audit.json`.

The pooled global baseline, leave-one-topic-out transfer comparisons, focal-
model partner stability, and individual-model BI control are documented in
[`docs/global-baseline.md`](docs/global-baseline.md).

## Repository layout

- `analysis/`: taxonomy, official-FX scoring, model-version selection, streaming metrics, and static-data export.
- `data/raw_manifest/`: upstream relative filenames, sizes, and SHA-256 hashes; no raw forecasts.
- `data/derived/`: complete and eligible pair tables plus the combined audit.
- `data/derived/cross_type_*`: cross-topic summaries, all-pair transitions, and a standalone audit.
- `data/derived/global_*`: pooled pair metrics, global-to-topic transfer tables, partner profiles, and BI controls.
- `site/`: React/Vite static explorer deployed by GitHub Pages.
- `tests/` and `site/tests/`: data invariants, schema, metric direction, URL state, desktop, and mobile checks.

## License and citation

Analysis and website code are MIT-licensed. Derived ForecastBench CSV/JSON data are CC BY-SA 4.0; see [`LICENSE-DATA.md`](LICENSE-DATA.md). If you use the results, cite this repository and Karger et al., *ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities* (ICLR 2025); machine-readable metadata are in [`CITATION.cff`](CITATION.cff).
