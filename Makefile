PYTHON ?= .venv/bin/python
BUILD_DIR ?= data/build
DERIVED_DIR ?= data/derived
SITE_DATA_DIR ?= site/public/data
BUILD_TIMESTAMP ?= 2026-08-19T00:00:00+00:00
EXCLUSION_REFERENCE_PANEL ?=
MODEL_VERSION_STAMP := $(BUILD_DIR)/.model_versions.stamp

.PHONY: help check-inputs taxonomy scoring model-versions metrics export cross-type global-baseline polymarket-aggregation freeze-exposed-market-aggregation historical-near-bi-market-aggregation analysis test site-build

help:
	@echo "Required variables: FORECASTBENCH_EVENTS, FORECASTBENCH_PROCESSED_ROOT, FORECASTBENCH_FIXED_EFFECTS"
	@echo "Targets: taxonomy scoring model-versions metrics export cross-type global-baseline polymarket-aggregation freeze-exposed-market-aggregation historical-near-bi-market-aggregation analysis test site-build"

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

model-versions: $(MODEL_VERSION_STAMP)

$(MODEL_VERSION_STAMP): analysis/model_versions.py $(BUILD_DIR)/scored_panel.csv
	$(PYTHON) analysis/model_versions.py \
		--input "$(BUILD_DIR)/scored_panel.csv" \
		--output "$(BUILD_DIR)/scored_panel_model_versions.csv" \
		--mapping-output "$(BUILD_DIR)/model_version_mapping.csv" \
		--audit-output "$(BUILD_DIR)/model_version_audit.json"
	@touch "$(MODEL_VERSION_STAMP)"

metrics: $(BUILD_DIR)/pair_metrics.csv

$(BUILD_DIR)/pair_metrics.csv: analysis/metrics.py $(BUILD_DIR)/event_taxonomy.csv $(MODEL_VERSION_STAMP)
	$(PYTHON) analysis/metrics.py \
		--scored-panel "$(BUILD_DIR)/scored_panel_model_versions.csv" \
		--taxonomy "$(BUILD_DIR)/event_taxonomy.csv" \
		--output "$(BUILD_DIR)/pair_metrics.csv" \
		--audit-output "$(BUILD_DIR)/metrics_audit.json" \
		--min-overlap 50 \
		--near-bi-gap 2 \
		--high-loss-threshold 0.25 \
		--allow-unclassified \
		--max-unclassified-targets 4

export: $(SITE_DATA_DIR)/manifest.json

$(SITE_DATA_DIR)/manifest.json: analysis/export_site.py $(BUILD_DIR)/pair_metrics.csv $(BUILD_DIR)/taxonomy_summary.json $(BUILD_DIR)/scoring_audit.json $(MODEL_VERSION_STAMP) $(BUILD_DIR)/metrics_audit.json
	$(PYTHON) analysis/export_site.py \
		--pair-csv "$(BUILD_DIR)/pair_metrics.csv" \
		--taxonomy-csv "$(BUILD_DIR)/event_taxonomy.csv" \
		--taxonomy-summary "$(BUILD_DIR)/taxonomy_summary.json" \
		--scored-panel "$(BUILD_DIR)/scored_panel_model_versions.csv" \
		--scoring-audit "$(BUILD_DIR)/scoring_audit.json" \
		--model-version-audit "$(BUILD_DIR)/model_version_audit.json" \
		--model-version-mapping "$(BUILD_DIR)/model_version_mapping.csv" \
		--metrics-audit "$(BUILD_DIR)/metrics_audit.json" \
		--site-data-dir "$(SITE_DATA_DIR)" \
		--derived-dir "$(DERIVED_DIR)" \
		--analysis-commit "$$(git rev-parse HEAD)" \
		--built-at "$(BUILD_TIMESTAMP)"

cross-type: $(DERIVED_DIR)/cross_type_audit.json

$(DERIVED_DIR)/cross_type_audit.json: analysis/cross_type.py $(BUILD_DIR)/pair_metrics.csv
	$(PYTHON) analysis/cross_type.py \
		--pair-metrics "$(BUILD_DIR)/pair_metrics.csv" \
		--derived-dir "$(DERIVED_DIR)" \
		--site-data-dir "$(SITE_DATA_DIR)" \
		--analysis-commit "$$(git rev-parse HEAD)" \
		--built-at "$(BUILD_TIMESTAMP)"

global-baseline: $(DERIVED_DIR)/global_baseline_audit.json

$(DERIVED_DIR)/global_baseline_audit.json: analysis/global_baseline.py $(MODEL_VERSION_STAMP) $(BUILD_DIR)/event_taxonomy.csv $(BUILD_DIR)/pair_metrics.csv
	$(PYTHON) analysis/global_baseline.py \
		--scored-panel "$(BUILD_DIR)/scored_panel_model_versions.csv" \
		--taxonomy "$(BUILD_DIR)/event_taxonomy.csv" \
		--pair-metrics "$(BUILD_DIR)/pair_metrics.csv" \
		--derived-dir "$(DERIVED_DIR)" \
		--site-data-dir "$(SITE_DATA_DIR)" \
		--analysis-commit "$$(git rev-parse HEAD)" \
		--built-at "$(BUILD_TIMESTAMP)" \
		$(if $(strip $(EXCLUSION_REFERENCE_PANEL)),--exclusion-reference-panel "$(EXCLUSION_REFERENCE_PANEL)",)

polymarket-aggregation: $(SITE_DATA_DIR)/polymarket-aggregation/freeze-baseline.json

$(SITE_DATA_DIR)/polymarket-aggregation/freeze-baseline.json: analysis/polymarket_aggregation.py $(MODEL_VERSION_STAMP) $(BUILD_DIR)/event_taxonomy.csv
	$(PYTHON) -m analysis.polymarket_aggregation \
		--panel "$(BUILD_DIR)/scored_panel_model_versions.csv" \
		--taxonomy "$(BUILD_DIR)/event_taxonomy.csv" \
		--output "$(SITE_DATA_DIR)/polymarket-aggregation/freeze-baseline.json"

freeze-exposed-market-aggregation: $(DERIVED_DIR)/freeze_exposed_market_aggregation/summary.json

$(DERIVED_DIR)/freeze_exposed_market_aggregation/summary.json: analysis/freeze_exposed_market_aggregation.py $(BUILD_DIR)/scored_panel.csv $(MODEL_VERSION_STAMP) $(BUILD_DIR)/event_taxonomy.csv | check-inputs
	$(PYTHON) -m analysis.freeze_exposed_market_aggregation \
		--raw-panel "$(BUILD_DIR)/scored_panel.csv" \
		--canonical-panel "$(BUILD_DIR)/scored_panel_model_versions.csv" \
		--taxonomy "$(BUILD_DIR)/event_taxonomy.csv" \
		--processed-root "$(FORECASTBENCH_PROCESSED_ROOT)" \
		--output-dir "$(DERIVED_DIR)/freeze_exposed_market_aggregation"

historical-near-bi-market-aggregation: $(DERIVED_DIR)/historical_near_bi_market_aggregation/summary.json

$(DERIVED_DIR)/historical_near_bi_market_aggregation/summary.json: analysis/historical_near_bi_market_aggregation.py analysis/freeze_exposed_market_aggregation.py $(BUILD_DIR)/scored_panel.csv $(BUILD_DIR)/event_taxonomy.csv | check-inputs
	$(PYTHON) -m analysis.historical_near_bi_market_aggregation \
		--raw-panel "$(BUILD_DIR)/scored_panel.csv" \
		--taxonomy "$(BUILD_DIR)/event_taxonomy.csv" \
		--processed-root "$(FORECASTBENCH_PROCESSED_ROOT)" \
		--output-dir "$(DERIVED_DIR)/historical_near_bi_market_aggregation"

analysis: export cross-type global-baseline polymarket-aggregation

test:
	$(PYTHON) -m pytest
	cd site && npm test -- --run

site-build:
	cd site && npm run build
