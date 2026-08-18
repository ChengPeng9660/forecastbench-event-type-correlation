# Data provenance

This repository does not redistribute the multi-gigabyte raw ForecastBench forecast archive. The analysis accepts local paths to:

1. processed ForecastBench forecast sets;
2. the official question fixed-effect JSON snapshot;
3. resolved event metadata used to derive topic labels.

The published derived artifacts include input hashes, row counts, excluded-target counts, model/configuration identities, date coverage, and metric eligibility reasons. Local absolute filesystem paths are excluded from public artifacts.

## Upstream attribution and licensing

ForecastBench is produced by the Forecasting Research Institute. Its dataset repository identifies the data license as CC BY-SA 4.0 and links the benchmark implementation at <https://github.com/forecastingresearch/forecastbench>. Derived CSV/JSON artifacts in this repository are distributed under CC BY-SA 4.0; analysis and website source code are MIT-licensed. See `LICENSE-DATA.md`.
