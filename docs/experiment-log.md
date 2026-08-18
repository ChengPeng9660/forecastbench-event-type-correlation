# Experiment log

## 2026-08-19 — Project initialization

- Created a standalone repository for the event-type dependence analysis.
- Locked the primary sample to ForecastBench targets with official question fixed effects.
- Locked the model universe to clean LLM configurations, excluding ForecastBench baselines, external submissions, ensembles, crowd aggregates, public medians, and superforecaster rows.
- Locked pair eligibility to shared scored targets and explicit minimum-overlap reporting.
- Declared the semantic topic taxonomy as derived; official `Dataset`/`Market` and source labels remain separate.
- Planned GitHub Pages as a static, backend-free research explorer.

## 2026-08-19 — Taxonomy review and release build

- Audited 13,661 unique `(date,source,event_id)` rows, 8,204 unique
  `(source,event_id)` events, and the official 10,205 Dataset / 3,456 Market
  provenance split.
- Marked 5,040 generic-pair template rows semantically unrecoverable and
  excluded them from topic slices while preserving origin/source analyses.
- Reviewed all 61 initial multi-topic rows as 17 unique events. Added exact
  event-level decisions plus the stratified error-audit fixes for sports-title,
  equity-price, cryptography, defense-policy, energy-trade, and entity-word
  ambiguities. Eleven eligible rows remain review-required by design.
- Generated 1,050,945 scored rows from 266 exact model names across 18 dates.
  All 1,063 clean-candidate JSON files were readable; 181 filename-identifiable
  non-clean files were excluded before read and no file-read exception was
  tolerated.
- Computed 634,410 rows: 35,245 global unordered model pairs crossed with seven
  topic, two origin, and nine source slices. Of these, 156,315 meet common
  support `n >= 50`.
- Verified zero scored-row taxonomy misses, 21,252 analytical official targets,
  2,857 unique source-events, explicit null reasons, finite POG/lift, and
  correlation bounds.
- Replaced the web fixture with 18 real slice files, removed stale fixture
  JSON, wrote deterministic gzip archives, and recorded file hashes in the
  public audit.
- Validation: 52 Python tests; 9 Vitest tests on the real 85 MB static bundle;
  production Vite build; 5 Playwright desktop/mobile tests passed with one
  intentionally inapplicable desktop assertion skipped.
- Release remains descriptive. Review-excluded sensitivity and clustered or
  block-bootstrap uncertainty are recorded as future robustness work rather
  than claimed as completed.
