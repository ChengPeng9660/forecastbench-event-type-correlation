from __future__ import annotations

import pytest

import analysis.upper_left_model_pair_aggregation as upper_left
from analysis.upper_left_model_pair_aggregation import (
    FIXED_UPPER_LEFT_CONFIGURATIONS,
    METHODS,
    _percentile,
)
from analysis.pair_aggregation import event_fold


def test_fixed_upper_left_list_preserves_exact_configurations() -> None:
    assert len(FIXED_UPPER_LEFT_CONFIGURATIONS) == 18
    assert len(set(FIXED_UPPER_LEFT_CONFIGURATIONS)) == 18
    assert all("freeze values" in name for name in FIXED_UPPER_LEFT_CONFIGURATIONS)
    assert any("scratchpad" in name for name in FIXED_UPPER_LEFT_CONFIGURATIONS)
    assert any("zero shot" in name for name in FIXED_UPPER_LEFT_CONFIGURATIONS)
def test_only_requested_closed_form_baselines_are_exposed() -> None:
    assert METHODS == (
        "simple_mean",
        "log_odds_mean",
        "ec_w0_56",
        "piecewise_odds",
    )


def test_percentile_interpolates_deterministically() -> None:
    assert _percentile([0.0, 1.0, 2.0, 3.0], 0.25) == 0.75
    assert _percentile([7.0], 0.25) == 7.0


def test_upper_left_tv_uses_train_pair_keys_and_exports_csv_without_changing_selection(monkeypatch) -> None:
    seed = 20260825
    names = ["GPT-Test (zero shot with freeze values)", "Claude-Test (scratchpad with freeze values)"]
    keys = [("2026-01-01", "polymarket", f"event-{index}", "") for index in range(12)]

    def row(probability: float, outcome: int) -> dict[str, str]:
        return {
            "date": "2026-01-01",
            "prediction": str(probability), "outcome": str(outcome), "origin_type": "Market",
            "question_fixed_effect": "0", "normalization_term": "0",
        }

    panel = {
        names[0]: {key: row(index / 11, index % 2) for index, key in enumerate(keys)},
        names[1]: {key: row(0.25 if event_fold(key[1], key[2], seed) == "A" else 1.0, index % 2) for index, key in enumerate(keys)},
    }
    market = {key: row(0.4, index % 2) for index, key in enumerate(keys)}
    metadata = {name: {
        "model_configuration": name.split(" (")[1][:-1],
        "canonical_model_version": name.split(" (")[0], "provider": "test",
    } for name in names}
    monkeypatch.setattr(upper_left, "_select_train_upper_left", lambda *_: (names, {}, []))
    payload, fold_rows, pair_rows = upper_left.crossfit_block(panel, metadata, market, [seed], 1, 0.56, 5.0)
    assert payload["eligible_pairs"] == 1
    assert len(fold_rows) == 2 * len(METHODS)
    for record in fold_rows:
        train_keys = [key for key in keys if event_fold(key[1], key[2], seed) == record["train_fold"]]
        expected_tv = sum(
            abs(float(panel[names[0]][key]["prediction"]) - float(panel[names[1]][key]["prediction"]))
            for key in train_keys
        ) / len(train_keys)
        assert record["train_diversity"]["total_variation"] == pytest.approx(expected_tv)
    flattened = upper_left._csv_rows(fold_rows, "train_diversity")
    assert all("diversity_total_variation" in record for record in flattened)
    for record in pair_rows:
        selected = [r for r in fold_rows if r["method"] == record["method"]]
        assert record["mean_train_diversity"]["total_variation"] == pytest.approx(
            sum(r["train_diversity"]["total_variation"] for r in selected) / len(selected)
        )
