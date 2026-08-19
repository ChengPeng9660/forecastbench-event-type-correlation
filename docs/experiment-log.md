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
- Generated 1,046,424 scored rows from 263 exact model names across 18 dates.
  Of 1,063 JSON files considered, 184 filename-identifiable non-clean files
  were excluded before read and two additional payload-identified non-clean
  files were excluded after read. All remaining clean-candidate reads had zero
  errors; no file-read exception was tolerated.
- Computed 620,154 rows: 34,453 global unordered model pairs crossed with seven
  topic, two origin, and nine source slices. Of these, 152,610 meet common
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

## 2026-08-19 — Cross-event-type pair stability release

- Added a prespecified cross-topic experiment over all 21 unordered pairs of
  the seven semantic topics and all 34,453 exact-model pairs.
- Published 723,513 auditable pair-topic-pair rows and 126 summary cells: 21
  topic pairs crossed with three metrics and near-BI-both / eligible-both
  samples.
- Required `n_overlap >= 50` and a finite metric in both topics; the primary
  sample additionally requires near-BI in both topic-specific common supports.
- Used tie-aware Spearman correlation as primary, raw Pearson as secondary,
  and dependence-oriented quartile persistence/flip diagnostics.
- Suppressed coefficients below 30 defined pairs, labeled 30--99 limited, and
  reserved headline descriptive status for at least 100 pairs. The released
  cells comprise 99 headline, 19 limited, and eight insufficient results.
- Near-BI median Spearman stability was 0.337 for POG, 0.279 for high-loss
  lift, and 0.240 for adjusted-loss correlation. Finance × Sports and Climate
  × Finance were among the most stable comparisons; Health × Technology was
  approximately uncorrelated or reversed.
- Added an English 7×7 interactive stability explorer, both sample views, cell
  diagnostics, and summary/full-detail downloads to the existing GitHub Pages
  site.
- Kept the release descriptive: no iid p-values, significance stars, causal
  topic claim, OOS claim, or deployable aggregation-gain claim is made.
