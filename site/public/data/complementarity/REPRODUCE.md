# Reproduce

From this package directory, using Python with NumPy and pandas:

```bash
python code/run_experiment.py
python code/independent_audit.py
pytest -q code/test_results.py
```

To regenerate summaries without repeating pair evaluation:

```bash
python code/run_experiment.py --reuse
```

The runner reads the sibling frozen package
`../specialization_argument_2026-08-31`. Its panel and artifact-manifest hashes
are recorded in `results/audit.json`.
