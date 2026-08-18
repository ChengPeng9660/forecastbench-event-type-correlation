# ForecastBench Event-Type Model Dependence Atlas

An auditable, reproducible analysis of pairwise model dependence in ForecastBench by event type.

The project reports three outcome-level diagnostics on the official fixed-effect scoring sample:

- Adjusted Pairwise Oracle Gain (higher indicates more complementary realized losses).
- Adjusted High-Loss Lift at the 0.25 threshold (lower indicates fewer shared severe losses).
- Adjusted-Loss Pearson Correlation (lower indicates less redundant loss patterns).

The repository separates official provenance dimensions (`Dataset`/`Market` and source) from a clearly labeled derived topic taxonomy. Large raw ForecastBench files are not vendored; reproducible commands, source manifests, derived public results, audit reports, and the GitHub Pages explorer are included.

> Status: build in progress. Final sample counts, methodology, reproduction commands, and the published explorer URL will be added after validation.

