# Reproduction

Use the bundled scientific Python environment or another environment with
NumPy and pandas.

```bash
python code/fine_event_taxonomy.py --source /path/to/event_taxonomy.csv
python code/prepare_all_configurations.py
python code/run_all_configurations.py
python code/diagnostics.py
python code/independent_audit.py
python code/test_results.py
python code/build_manifest.py
```

The preparation script records every source-file path and SHA-256 digest in
`data/raw_file_manifest.csv`. The experiment is deterministic. Its five split
seeds are written in `results/audit.json`. The taxonomy step maps the prior
audited semantic labels into seven displayed event domains without reading
outcomes or forecasts. `apply_fine_event_taxonomy.py` and
`relabel_seven_domain_results.py` document the membership-preserving migration
used for this frozen release; a clean rerun obtains the same labels directly
from `prepare_all_configurations.py`.
