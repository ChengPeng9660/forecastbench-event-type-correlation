# Reproduction

Use the bundled scientific Python environment or another environment with
NumPy and pandas.

```bash
python code/prepare_all_configurations.py
python code/run_all_configurations.py
python code/diagnostics.py
python code/independent_audit.py
```

The preparation script records every source-file path and SHA-256 digest in
`data/raw_file_manifest.csv`. The experiment is deterministic. Its five split
seeds are written in `results/audit.json`.
