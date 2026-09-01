# Reproduce the within-topic POG experiment

From the website repository, using a Python environment with NumPy and pandas:

```bash
python analysis/within_topic_complementarity.py \
  --source-study /absolute/path/to/outputs/complementarity_all_configurations_2026-09-01 \
  --output /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01 \
  --site-destination site/public/data/within-topic-complementarity

python analysis/audit_within_topic_complementarity.py \
  --source-study /absolute/path/to/outputs/complementarity_all_configurations_2026-09-01 \
  --experiment /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01 \
  --sample 256

python analysis/validate_within_topic_complementarity.py \
  --experiment /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01

python analysis/within_topic_complementarity.py \
  --source-study /absolute/path/to/outputs/complementarity_all_configurations_2026-09-01 \
  --output /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01 \
  --site-destination site/public/data/within-topic-complementarity \
  --reuse
```

The final reuse step exports only after both the main and implementation-independent audits pass. Check `artifact_manifest.json` and the public `manifest.json` for file hashes.
