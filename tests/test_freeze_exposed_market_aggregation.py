from __future__ import annotations

import json
from pathlib import Path

import pytest

from analysis.freeze_exposed_market_aggregation import (
    ExactConfiguration,
    exclude_imputed_polymarket_rows,
    is_freeze_exposed_configuration,
    select_primary_configurations,
    similarity_diagnostics,
    summarize_similarity_rows,
)


def test_explicit_freeze_configuration_detection() -> None:
    assert is_freeze_exposed_configuration("zero shot with freeze values")
    assert is_freeze_exposed_configuration("scratchpad with news with freeze values")
    assert not is_freeze_exposed_configuration("zero shot")
    assert not is_freeze_exposed_configuration("zero shot with web search")


def test_primary_selection_prefers_zero_shot_freeze_without_outcomes() -> None:
    configurations = {
        "Model (scratchpad with freeze values)": ExactConfiguration(
            "Model (scratchpad with freeze values)",
            "Model",
            "Org",
            "scratchpad with freeze values",
            rows={("d", "s", "e", "h"): {}},
            dates={"d"},
        ),
        "Model (zero shot with freeze values)": ExactConfiguration(
            "Model (zero shot with freeze values)",
            "Model",
            "Org",
            "zero shot with freeze values",
            rows={("d", "s", "e", "h"): {}},
            dates={"d"},
        ),
    }
    selected, audit = select_primary_configurations(configurations)
    assert selected == {"Model": "Model (zero shot with freeze values)"}
    assert sum(row["selected"] for row in audit) == 1


def test_similarity_diagnostics_detects_exact_copy() -> None:
    keys = [("2026-01-01", "polymarket", "event", "")]
    market = {keys[0]: {"prediction": "0.7"}}
    model = {keys[0]: {"prediction": "0.7"}}
    result = similarity_diagnostics(market, model, keys)
    assert result["exact_copy_share"] == pytest.approx(1)
    assert result["mean_absolute_difference"] == pytest.approx(0)
    assert result["total_variation"] == pytest.approx(0)


def test_similarity_total_variation_is_original_probability_distance_on_requested_support() -> None:
    keys = [("2026-01-01", "polymarket", str(index), "") for index in range(3)]
    market = {key: {"prediction": str(value)} for key, value in zip(keys, (0.0, 0.5, 1.0))}
    model = {key: {"prediction": str(value)} for key, value in zip(keys, (1.0, 0.25, 0.0))}
    result = similarity_diagnostics(market, model, keys[:2])
    assert result["total_variation"] == pytest.approx(0.625)
    assert result["total_variation"] == result["mean_absolute_difference"]
    aggregate = summarize_similarity_rows([result], "test")
    assert aggregate["macro_total_variation"] == pytest.approx(0.625)
    assert aggregate["support_weighted_total_variation"] == pytest.approx(0.625)


def test_imputed_filter_keeps_real_duplicate_and_drops_imputed_only(tmp_path: Path) -> None:
    date_dir = tmp_path / "2026-01-01"
    date_dir.mkdir()
    (date_dir / "genuine.json").write_text(
        json.dumps(
            {
                "forecasts": [
                    {"source": "polymarket", "id": "keep", "imputed": False},
                    {"source": "polymarket", "id": "drop", "imputed": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    (date_dir / "duplicate.json").write_text(
        json.dumps(
            {
                "forecasts": [
                    {"source": "polymarket", "id": "keep", "imputed": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    keep = ("2026-01-01", "polymarket", "keep", "")
    drop = ("2026-01-01", "polymarket", "drop", "")
    panel = {
        "Model": {
            keep: {"source_file": "duplicate.json;genuine.json"},
            drop: {"source_file": "genuine.json"},
        }
    }
    filtered, audit = exclude_imputed_polymarket_rows(panel, tmp_path)
    assert set(filtered["Model"]) == {keep}
    assert audit["excluded_imputed_rows"] == 1
    assert audit["retained_non_imputed_rows"] == 1


def test_released_freeze_exposed_artifact_is_oos_and_explicit() -> None:
    path = Path("data/derived/freeze_exposed_market_aggregation/summary.json")
    if not path.exists():
        pytest.skip("experiment artifact not generated")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["audit"]["all_selected_configs_explicitly_with_freeze"]
    assert payload["audit"]["fold_records_per_pair_method"] == 20
    assert payload["audit"]["primary_eligible_model_versions"] > 0
    assert payload["audit"]["matched_model_versions"] > 0
    assert payload["design"]["imputation_policy"].startswith("exclude Polymarket")
    methods = {
        (row["sample"], row["method"]): row for row in payload["method_summary"]
    }
    assert ("canonical_primary", "simple_mean") in methods
    assert ("canonical_primary_train_near_bi_folds", "simple_mean") in methods
    assert ("matched_no_freeze", "simple_mean") in methods
    assert ("matched_with_freeze", "simple_mean") in methods
