from __future__ import annotations

import csv
from pathlib import Path

import pytest

from analysis.pair_aggregation import METHODS
from analysis.polymarket_aggregation import (
    BASELINE_NAME,
    add_reference_gains,
    build_freeze_panel,
    read_freeze_snapshots,
)


def _model_row(
    *,
    date: str,
    event_id: str,
    horizon: str,
    model_name: str,
    prediction: str,
) -> dict[str, str]:
    return {
        "date": date,
        "source": "Polymarket",
        "event_id": event_id,
        "horizon": horizon,
        "model_name": model_name,
        "prediction": prediction,
        "outcome": "1",
        "origin_type": "Market",
        "question_fixed_effect": "0",
        "normalization_term": "0",
    }


def _write_taxonomy(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "date",
        "source",
        "event_id",
        "market_prob",
        "freeze_datetime",
        "question_text",
        "url",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def test_freeze_panel_uses_market_prob_on_exact_date_source_event_join(tmp_path: Path) -> None:
    taxonomy_path = tmp_path / "event_taxonomy.csv"
    _write_taxonomy(
        taxonomy_path,
        [
            {
                "date": "2025-01-10",
                "source": "Polymarket",
                "event_id": "market-1",
                "market_prob": "0.27",
                "freeze_datetime": "2025-01-01T00:00:00+00:00",
                "question_text": "First round",
                "url": "https://example.test/market-1-first",
            },
            {
                "date": "2025-01-20",
                "source": "polymarket",
                "event_id": "market-1",
                "market_prob": "0.61",
                "freeze_datetime": "2025-01-10T00:00:00+00:00",
                "question_text": "Recurring round",
                "url": "https://example.test/market-1-second",
            },
            {
                "date": "2025-01-10",
                "source": "Kalshi",
                "event_id": "market-1",
                "market_prob": "0.99",
                "freeze_datetime": "2025-01-01T00:00:00+00:00",
                "question_text": "Wrong source",
                "url": "https://example.test/wrong-source",
            },
        ],
    )
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)

    first_key = ("2025-01-10", "Polymarket", "market-1", "7")
    same_snapshot_other_horizon = ("2025-01-10", "Polymarket", "market-1", "30")
    recurring_round_key = ("2025-01-20", "Polymarket", "market-1", "7")
    model_panel = {
        "GPT-Test": {
            first_key: _model_row(
                date=first_key[0],
                event_id=first_key[2],
                horizon=first_key[3],
                model_name="GPT-Test",
                prediction="0.80",
            ),
            recurring_round_key: _model_row(
                date=recurring_round_key[0],
                event_id=recurring_round_key[2],
                horizon=recurring_round_key[3],
                model_name="GPT-Test",
                prediction="0.70",
            ),
        },
        "Claude-Test": {
            same_snapshot_other_horizon: _model_row(
                date=same_snapshot_other_horizon[0],
                event_id=same_snapshot_other_horizon[2],
                horizon=same_snapshot_other_horizon[3],
                model_name="Claude-Test",
                prediction="0.75",
            ),
        },
    }

    freeze_panel, match_audit = build_freeze_panel(model_panel, snapshots)

    assert snapshot_audit["polymarket_snapshot_rows"] == 2
    assert set(snapshots) == {
        ("2025-01-10", "polymarket", "market-1"),
        ("2025-01-20", "polymarket", "market-1"),
    }
    assert freeze_panel[first_key]["prediction"] == "0.27"
    assert freeze_panel[same_snapshot_other_horizon]["prediction"] == "0.27"
    assert freeze_panel[recurring_round_key]["prediction"] == "0.61"
    assert all(row["model_name"] == BASELINE_NAME for row in freeze_panel.values())
    assert match_audit["matched_freeze_values"] == 3
    assert match_audit["missing_freeze_values"] == 0


def test_freeze_panel_does_not_fall_back_to_same_event_on_another_date() -> None:
    key = ("2025-01-10", "Polymarket", "market-1", "7")
    model_panel = {
        "GPT-Test": {
            key: _model_row(
                date=key[0],
                event_id=key[2],
                horizon=key[3],
                model_name="GPT-Test",
                prediction="0.80",
            )
        }
    }
    wrong_date_snapshot = {
        ("2025-01-09", "polymarket", "market-1"): {
            "market_prob": "0.27",
            "freeze_datetime": "2024-12-31T00:00:00+00:00",
        }
    }

    with pytest.raises(ValueError, match="missing freeze snapshots"):
        build_freeze_panel(model_panel, wrong_date_snapshot)


def test_reference_gains_use_polymarket_and_model_denominators() -> None:
    method_briers = {
        "ec_w0_56": 0.15,
        "simple_mean": 0.18,
        "log_odds_mean": 0.16,
        "piecewise_odds": 0.14,
        "best_single": 0.10,
        "past_only_best_single": 0.13,
    }
    point = {
        "adjusted_brier": {
            "model_a": 0.10,
            "model_b": 0.25,
            **method_briers,
        }
    }

    result = add_reference_gains(point)

    for method in METHODS:
        assert result["gain_fraction_vs_polymarket"][method] == pytest.approx(
            (0.10 - method_briers[method]) / 0.10
        )
        assert result["gain_fraction_vs_model"][method] == pytest.approx(
            (0.25 - method_briers[method]) / 0.25
        )
