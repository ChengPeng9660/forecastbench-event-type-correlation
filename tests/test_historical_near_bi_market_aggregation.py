from __future__ import annotations

import json
from pathlib import Path

import pytest

from analysis.historical_near_bi_market_aggregation import (
    forward_time_records,
    summarize_methods,
)


def _row(prediction: float, outcome: float, resolution_date: str) -> dict[str, str]:
    return {
        "prediction": str(prediction),
        "outcome": str(outcome),
        "origin_type": "Market",
        "question_fixed_effect": "0",
        "normalization_term": "0",
        "resolution_date": resolution_date,
    }


def test_forward_time_history_requires_strictly_prior_resolution() -> None:
    resolved = ("2025-01-01", "polymarket", "resolved", "")
    unresolved = ("2025-01-05", "polymarket", "not-yet-resolved", "")
    current = ("2025-02-01", "polymarket", "current", "")
    market = {
        resolved: _row(0.5, 1, "2025-01-15"),
        unresolved: _row(0.5, 0, "2025-03-01"),
        current: _row(0.5, 1, "2025-04-01"),
    }
    model = {
        resolved: _row(0.5, 1, "2025-01-15"),
        unresolved: _row(0.9, 0, "2025-03-01"),
        current: _row(0.8, 1, "2025-04-01"),
    }
    records = forward_time_records(
        ["Model (zero shot with freeze values)"],
        {"Model (zero shot with freeze values)": model},
        market,
        {"Model (zero shot with freeze values)": "Model"},
        minimum_history=1,
        ec_weight=0.56,
        piecewise_threshold=5.0,
    )
    current_records = [row for row in records if row["forecast_date"] == "2025-02-01"]
    assert len(current_records) == 6
    assert {row["history_target_count"] for row in current_records} == {1}
    assert {row["history_bi_gap"] for row in current_records} == {0}
    assert {row["history_resolution_date_max"] for row in current_records} == {
        "2025-01-15"
    }


def test_summary_reports_weighted_and_pooled_gain_separately() -> None:
    records = [
        {
            "method": "piecewise_odds",
            "history_bi_gap": 1.0,
            "current_target_count": 1,
            "canonical_model_version": "A",
            "brier_index": 80.0,
            "adjusted_brier": 0.04,
            "market_adjusted_brier": 0.05,
            "model_adjusted_brier": 0.06,
            "gain_vs_market": 0.2,
            "gain_vs_model": 1 / 3,
        },
        {
            "method": "piecewise_odds",
            "history_bi_gap": 1.0,
            "current_target_count": 3,
            "canonical_model_version": "B",
            "brier_index": 60.0,
            "adjusted_brier": 0.16,
            "market_adjusted_brier": 0.15,
            "model_adjusted_brier": 0.14,
            "gain_vs_market": -1 / 15,
            "gain_vs_model": -1 / 7,
        },
    ]
    summary = summarize_methods(records, (2.0,))[0]
    assert summary["support_weighted_gain_vs_market"] == pytest.approx(0)
    assert summary["pooled_gain_vs_market"] == pytest.approx(-0.04)
    assert summary["selected_model_dates"] == 2


def test_released_historical_near_bi_artifact_is_leakage_safe() -> None:
    path = Path("data/derived/historical_near_bi_market_aggregation/summary.json")
    if not path.exists():
        pytest.skip("historical Near-BI experiment artifact not generated")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["design"]["minimum_history"] == 50
    assert payload["design"]["primary_near_bi_gap"] == 2.0
    assert payload["audit"]["selected_near_bi_model_dates"] > 0
    assert payload["provenance"]["resolution_audit"]["resolution_rule"].startswith(
        "history requires resolution_date <"
    )
