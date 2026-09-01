# Complementarity experiment: uniform weights and wider ability gaps

This package implements the requested sensitivity experiment without modifying
the frozen `specialization_argument_2026-08-31` outputs.

The main result is in `REPORT.md`. The exact protocol is in `PROTOCOL.md`.

## Main files

- `results/primary_summary.csv`: primary split method results for BI-gap limits 3
  and 5, four coverage thresholds, both category dimensions and both eligible /
  crossed-strength cohorts.
- `results/requested_primary_results.csv`: the requested Category-shrunk versus
  single-model results in one compact table.
- `results/primary_intervals.csv`: conditional common-event-cluster intervals.
- `results/direction_summary.csv`: all ten fixed event-split directions.
- `results/pair_results.csv.gz`: 25,580 complete pair-direction-dimension records.
- `results/category_profiles.csv.gz`: 90,364 category profile records.
- `results/audit.json`: input hashes and selection/weighting invariants.
- `results/independent_audit.json`: independent numerical reconstruction on 80
  sampled primary records.

All reported aggregation methods are fitted on training outcomes only. A positive
`type_shrunk_gain_best_bi` means Category-shrunk aggregation beats both single
models on the identical test targets.
