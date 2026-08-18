PYTHON ?= .venv/bin/python
BUILD_DIR ?= data/build
DERIVED_DIR ?= data/derived
SITE_DATA_DIR ?= site/public/data
BUILD_TIMESTAMP ?= 2026-08-19T00:00:00+00:00

.PHONY: help check-inputs taxonomy scoring metrics export analysis test site-build

help:
	@echo "Required variables: FORECASTBENCH_EVENTS, FORECASTBENCH_PROCESSED_ROOT, FORECASTBENCH_FIXED_EFFECTS"
	@echo "Targets: taxonomy scoring metrics export analysis test site-build"

check-inputs:
	@test -f "$(FORECASTBENCH_EVENTS)" || (echo "FORECASTBENCH_EVENTS is missing" && exit 1)
	@test -d "$(FORECASTBENCH_PROCESSED_ROOT)" || (echo "FORECASTBENCH_PROCESSED_ROOT is missing" && exit 1)
	@test -f "$(FORECASTBENCH_FIXED_EFFECTS)" || (echo "FORECASTBENCH_FIXED_EFFECTS is missing" && exit 1)

taxonomy: $(BUILD_DIR)/event_taxonomy.csv

$(BUILD_DIR)/event_taxonomy.csv: analysis/taxonomy.py analysis/taxonomy_config.json $(FORECASTBENCH_EVENTS) | check-inputs
	$(PYTHON) analysis/taxonomy.py \
		--input-csv "$(FORECASTBENCH_EVENTS)" \
		--output-csv "$(BUILD_DIR)/event_taxonomy.csv" \
		--summary-json "$(BUILD_DIR)/taxonomy_summary.json"

scoring: $(BUILD_DIR)/scored_panel.csv

$(BUILD_DIR)/scored_panel.csv: analysis/scoring.py $(FORECASTBENCH_FIXED_EFFECTS) | check-inputs
	$(PYTHON) analysis/scoring.py \
		--processed-root "$(FORECASTBENCH_PROCESSED_ROOT)" \
		--fixed-effects "$(FORECASTBENCH_FIXED_EFFECTS)" \
		--output "$(BUILD_DIR)/scored_panel.csv" \
		--audit-output "$(BUILD_DIR)/scoring_audit.json" \
		--max-file-read-errors 0

metrics: $(BUILD_DIR)/pair_metrics.csv

$(BUILD_DIR)/pair_metrics.csv: analysis/metrics.py $(BUILD_DIR)/event_taxonomy.csv $(BUILD_DIR)/scored_panel.csv
	$(PYTHON) analysis/metrics.py \
		--scored-panel "$(BUILD_DIR)/scored_panel.csv" \
		--taxonomy "$(BUILD_DIR)/event_taxonomy.csv" \
		--output "$(BUILD_DIR)/pair_metrics.csv" \
		--audit-output "$(BUILD_DIR)/metrics_audit.json" \
		--min-overlap 50 \
		--near-bi-gap 2 \
		--high-loss-threshold 0.25 \
		--allow-unclassified \
		--max-unclassified-targets 4

export: $(SITE_DATA_DIR)/manifest.json

$(SITE_DATA_DIR)/manifest.json: analysis/export_site.py $(BUILD_DIR)/pair_metrics.csv $(BUILD_DIR)/taxonomy_summary.json $(BUILD_DIR)/scoring_audit.json $(BUILD_DIR)/metrics_audit.json
	$(PYTHON) analysis/export_site.py \
		--pair-csv "$(BUILD_DIR)/pair_metrics.csv" \
		--taxonomy-csv "$(BUILD_DIR)/event_taxonomy.csv" \
		--taxonomy-summary "$(BUILD_DIR)/taxonomy_summary.json" \
		--scored-panel "$(BUILD_DIR)/scored_panel.csv" \
		--scoring-audit "$(BUILD_DIR)/scoring_audit.json" \
		--metrics-audit "$(BUILD_DIR)/metrics_audit.json" \
		--site-data-dir "$(SITE_DATA_DIR)" \
		--derived-dir "$(DERIVED_DIR)" \
		--analysis-commit "$$(git rev-parse HEAD)" \
		--built-at "$(BUILD_TIMESTAMP)"

analysis: export

test:
	$(PYTHON) -m pytest
	cd site && npm test -- --run

site-build:
	cd site && npm run build
