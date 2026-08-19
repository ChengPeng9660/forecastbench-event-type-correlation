# ForecastBench Event-Type Model Dependence Atlas

An auditable, reproducible analysis of pairwise model dependence in ForecastBench by event type.

**Interactive atlas:** <https://chengpeng9660.github.io/forecastbench-event-type-correlation/>

The project reports three outcome-level diagnostics on the official fixed-effect scoring sample:

- Adjusted Pairwise Oracle Gain (higher indicates more complementary realized losses).
- Adjusted High-Loss Lift at the 0.25 threshold (lower indicates fewer shared severe losses).
- Adjusted-Loss Pearson Correlation (lower indicates less redundant loss patterns).

The repository separates official provenance dimensions (`Dataset`/`Market` and source) from a clearly labeled derived topic taxonomy. Large raw ForecastBench files are not vendored; reproducible commands, source manifests, derived public results, audit reports, and the GitHub Pages explorer are included.

## Released analysis

- 13,661 classified event-date rows and 8,204 unique `(source,event_id)` events.
- Seven analysis-eligible semantic topics, two official origin slices, and nine official source slices.
- 1,050,945 scored model-target rows from 266 exact clean-LLM model names.
- 35,245 global unordered model pairs and 634,410 pair-slice rows.
- 156,315 pair-slice rows meet the default common-support threshold of 50.
- 21,252 distinct official `(date,source,event_id,horizon)` targets appear in the analytical slices.
- Zero clean-candidate JSON read errors and zero scored rows missing the taxonomy join.

The taxonomy is derived, versioned as `forecastbench-topic-v1.1.0`, and not an official ForecastBench field. All 61 initial multi-topic rows (17 unique events) were manually reviewed. Eleven analysis-eligible rows remain explicitly review-required because their resolution predicates are genuinely cross-domain. Unrecoverable generic-pair templates and unmatched visible questions are excluded from semantic-topic slices but retained in official origin/source slices.

The atlas provides model filters, pair rankings, and downloadable results for
all 266 exact model names. The heatmap is limited to 30 models at once for
browser performance; the downloadable and archived tables retain the full
filtered pair universe.

The cross-event-type stability experiment follows every one of the 35,245
global exact-model pairs across all 21 unordered combinations of the seven
semantic topics. Its primary view asks whether a pair that is dependent in one
topic remains dependent in another among pairs that are near-BI in both. A
complete 740,145-row audit archive retains ineligible and undefined cases
rather than selecting them away.

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

## Repository layout

- `analysis/`: taxonomy, official-FX scoring, streaming metrics, and static-data export.
- `data/raw_manifest/`: upstream relative filenames, sizes, and SHA-256 hashes; no raw forecasts.
- `data/derived/`: complete and eligible pair tables plus the combined audit.
- `data/derived/cross_type_*`: cross-topic summaries, all-pair transitions, and a standalone audit.
- `site/`: React/Vite static explorer deployed by GitHub Pages.
- `tests/` and `site/tests/`: data invariants, schema, metric direction, URL state, desktop, and mobile checks.

## License and citation

Analysis and website code are MIT-licensed. Derived ForecastBench CSV/JSON data are CC BY-SA 4.0; see [`LICENSE-DATA.md`](LICENSE-DATA.md). If you use the results, cite this repository and Karger et al., *ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities* (ICLR 2025); machine-readable metadata are in [`CITATION.cff`](CITATION.cff).
