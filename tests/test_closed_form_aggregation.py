from __future__ import annotations

import json
from pathlib import Path

import pytest

from analysis.closed_form_aggregation import (
    aggregate_pairs,
    correlation,
    evaluate_pair,
    forecast_diagnostics,
    residualize,
    score_methods,
    write_csv,
)
from analysis.pair_aggregation import event_fold


def row(prediction: float, outcome: int, event_id: str) -> dict[str, str]:
    return {
        "date": "2026-01-01",
        "source": "test",
        "event_id": event_id,
        "horizon": "30",
        "prediction": str(prediction),
        "outcome": str(outcome),
        "origin_type": "Dataset",
        "question_fixed_effect": "0",
        "normalization_term": "0",
    }


def test_closed_form_weight_recovers_useful_partner_direction() -> None:
    keys = [
        ("2026-01-01", "test", "one", "30"),
        ("2026-01-01", "test", "two", "30"),
    ]
    anchor = {
        keys[0]: row(0.6, 1, "one"),
        keys[1]: row(0.4, 0, "two"),
    }
    partner = {
        keys[0]: row(0.8, 1, "one"),
        keys[1]: row(0.2, 0, "two"),
    }
    diagnostics = forecast_diagnostics(anchor, partner, keys)

    assert diagnostics["alignment_c"] == pytest.approx(0.08)
    assert diagnostics["disagreement_d"] == pytest.approx(0.04)
    assert diagnostics["alpha_raw"] == pytest.approx(2.0)
    assert diagnostics["alpha_clipped"] == pytest.approx(1.0)
    assert diagnostics["upward_alpha_clipped"] == pytest.approx(1.0)
    assert diagnostics["downward_alpha_clipped"] == pytest.approx(1.0)


def test_closed_form_weight_rejects_harmful_diversity() -> None:
    keys = [
        ("2026-01-01", "test", "one", "30"),
        ("2026-01-01", "test", "two", "30"),
    ]
    anchor = {
        keys[0]: row(0.8, 1, "one"),
        keys[1]: row(0.2, 0, "two"),
    }
    partner = {
        keys[0]: row(0.5, 1, "one"),
        keys[1]: row(0.5, 0, "two"),
    }
    diagnostics = forecast_diagnostics(anchor, partner, keys)

    assert diagnostics["disagreement_d"] > 0
    assert diagnostics["alignment_c"] < 0
    assert diagnostics["alpha_clipped"] == 0
    assert diagnostics["alpha_lcb_1se"] == 0


def test_score_methods_uses_train_weight_and_test_outcomes_only_for_scoring() -> None:
    keys = [
        ("2026-01-01", "test", "one", "30"),
        ("2026-01-01", "test", "two", "30"),
    ]
    anchor = {
        keys[0]: row(0.7, 1, "one"),
        keys[1]: row(0.3, 0, "two"),
    }
    partner = {
        keys[0]: row(0.4, 1, "one"),
        keys[1]: row(0.6, 0, "two"),
    }
    train = forecast_diagnostics(anchor, partner, keys)
    test = forecast_diagnostics(anchor, partner, keys)
    scores = score_methods(anchor, partner, keys, train, test, 0.56, 5.0)

    assert scores["cf_linear"]["adjusted_brier"] == pytest.approx(
        scores["anchor"]["adjusted_brier"]
    )
    assert scores["cf_linear"]["gain_vs_anchor"] == pytest.approx(0)
    assert scores["cf_directional"]["gain_vs_anchor"] == pytest.approx(0)
    assert scores["oracle_linear"]["gain_vs_best_single"] >= 0
    assert scores["oracle_directional"]["gain_vs_best_single"] >= 0


def test_total_variation_uses_named_training_fold_and_survives_pair_aggregation() -> None:
    seed = 20260825
    anchor, partner = {}, {}
    for index in range(48):
        event_id = f"tv-{index}"
        key = ("2026-01-01", "test", event_id, "30")
        anchor[key] = row(0.4, index % 2, event_id)
        partner[key] = row(0.5 if event_fold("test", event_id, seed) == "A" else 0.8,
                           index % 2, event_id)
    records = evaluate_pair(
        "fixed_focal_without_freeze", "GPT-Test", "Claude-Test",
        anchor, partner, [seed], 1, 0.56, 5.0,
    )
    for record in records:
        assert record["train_total_variation_complementarity"] == pytest.approx(
            0.1 if record["train_fold"] == "A" else 0.4
        )

    changed_partner = {
        key: {**value, "prediction": "0.99"}
        if event_fold(key[1], key[2], seed) == "B" else value
        for key, value in partner.items()
    }
    changed = evaluate_pair(
        "fixed_focal_without_freeze", "GPT-Test", "Claude-Test",
        anchor, changed_partner, [seed], 1, 0.56, 5.0,
    )
    assert all(record["train_total_variation_complementarity"] == pytest.approx(0.1)
               for record in changed if record["train_fold"] == "A")
    assert all(record["train_total_variation_complementarity"] == pytest.approx(0.59)
               for record in changed if record["train_fold"] == "B")
    expected = sum(abs(float(anchor[key]["prediction"]) - float(partner[key]["prediction"]))
                   for key in anchor) / len(anchor)
    assert all(pair["train_total_variation_complementarity"] == pytest.approx(expected)
               for pair in aggregate_pairs(records))


def test_correlation_ignores_undefined_metric_values() -> None:
    assert correlation([0.0, None, 1.0, 2.0], [0.0, 5.0, 1.0, 2.0]) == pytest.approx(1.0)


def test_residualize_removes_linear_control_component() -> None:
    controls = [0.0, 1.0, 2.0, 3.0]
    values = [1.0, 3.0, 5.0, 7.0]
    assert residualize(values, controls) == pytest.approx([0.0, 0.0, 0.0, 0.0])


def test_released_closed_form_artifact_preserves_baselines_and_oos_signs() -> None:
    path = Path("data/derived/closed_form_aggregation/summary.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["audit"]["polymarket_model_pairs"] == 28
    assert payload["audit"]["model_model_pairs"] == 337
    assert payload["release_reproduction_audit"]["maximum_absolute_error"] == 0

    summaries = {
        (row["experiment"], row["sample"], row["method"]): row
        for row in payload["method_summary"]
    }
    assert summaries[("polymarket_model", "all", "cf_directional")][
        "support_weighted_gain_vs_best_single"
    ] < 0
    assert summaries[("model_model", "all", "cf_directional")][
        "support_weighted_gain_vs_best_single"
    ] > 0.04


def test_gzip_detail_export_is_byte_deterministic(tmp_path: Path) -> None:
    path = tmp_path / "rows.csv.gz"
    rows = [{"pair": "A x B", "gain": 0.04}]
    write_csv(path, rows)
    first = path.read_bytes()
    write_csv(path, rows)
    assert path.read_bytes() == first
