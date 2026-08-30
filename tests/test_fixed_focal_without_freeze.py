from __future__ import annotations

import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

import pytest

from analysis.closed_form_aggregation import write_csv
from analysis.fixed_focal_without_freeze import run_experiment

SITE_PAYLOAD = Path(
    "site/public/data/pair-aggregation/fixed-focal-without-freeze.json"
)
FOLD_RESULTS = Path(
    "data/derived/fixed_focal_without_freeze/fold_method_results.csv.gz"
)


def test_released_payload_is_complete_ordered_and_without_freeze() -> None:
    payload = json.loads(SITE_PAYLOAD.read_text(encoding="utf-8"))
    audit = payload["audit"]
    assert audit["model_count"] == 43
    assert audit["unordered_pair_count"] == 337
    assert audit["ordered_pair_count"] == 674
    assert audit["fold_directions_per_ordered_pair"] == 20
    assert audit["all_models_exclude_freeze_values"] is True
    assert audit["with_freeze_model_count"] == 0
    assert audit["near_bi_ordered_pair_count"] == 284
    assert payload["evaluation"]["diversity_metrics"]["total_variation"]["label"] == "Total variation (TV)"

    points = payload["points"]
    ordered = {(point["base_model"], point["partner_model"]) for point in points}
    assert len(ordered) == 674
    for base, partner in ordered:
        assert base != partner
        assert (partner, base) in ordered
    assert all(
        "with freeze values" not in configuration.casefold()
        for configurations in audit["model_configurations"].values()
        for configuration in configurations
    )


def test_fold_export_never_swaps_the_fixed_focal_anchor() -> None:
    counts: Counter[tuple[str, str, str, str]] = Counter()
    with gzip.open(FOLD_RESULTS, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            assert row["experiment"] == "fixed_focal_without_freeze"
            assert row["anchor"] == row["model_a"]
            assert row["partner"] == row["model_b"]
            assert row["pair_id"] == f'{row["model_a"]} -> {row["model_b"]}'
            assert 0 <= float(row["train_total_variation_complementarity"]) <= 1
            counts[(row["model_a"], row["model_b"], row["method"], row["train_fold"])] += 1

    assert len(counts) == 674 * 8 * 2
    assert set(counts.values()) == {10}


def test_combined_views_reconstruct_two_direction_support_and_gain() -> None:
    payload = json.loads(SITE_PAYLOAD.read_text(encoding="utf-8"))
    methods = tuple(payload["evaluation"]["methods"])
    for point in payload["points"]:
        assert point["combined"]["base_name"] == point["base_model"]
        assert point["combined"]["partner_name"] == point["partner_model"]
        for direction in ("a_to_b", "b_to_a"):
            assert point["directions"][direction]["base_name"] == point["base_model"]
            assert point["directions"][direction]["partner_name"] == point["partner_model"]
        combined_tv = point["combined"]["train_diversity"]["total_variation"]
        assert 0 <= combined_tv <= 1
        assert combined_tv == pytest.approx(
            sum(view["train_diversity"]["total_variation"] * view["train_target_cells"]
                for view in point["directions"].values())
            / point["combined"]["train_target_cells"],
            abs=1e-12,
        )
        for method in methods:
            combined = point["combined"]["aggregation"][method]
            first = point["directions"]["a_to_b"]["aggregation"][method]
            second = point["directions"]["b_to_a"]["aggregation"][method]
            assert first["test_target_cells"] + second["test_target_cells"] == combined["test_target_cells"]
            assert isinstance(combined["brier_index"], float)
            assert isinstance(combined["gain_vs_base"], float)


def test_every_focal_model_varies_only_its_partner() -> None:
    payload = json.loads(SITE_PAYLOAD.read_text(encoding="utf-8"))
    by_base: dict[str, list[dict[str, object]]] = defaultdict(list)
    for point in payload["points"]:
        by_base[point["base_model"]].append(point)
    assert len(by_base) == 43
    assert all(len({row["base_model"] for row in rows}) == 1 for rows in by_base.values())
    assert all(len({row["partner_model"] for row in rows}) == len(rows) for rows in by_base.values())
    assert len(by_base["GPT-5-2025-08-07"]) == 16


def test_total_variation_reaches_ordered_views_correlations_and_csv(tmp_path: Path) -> None:
    panel_path = tmp_path / "panel.csv"
    panel_rows = []
    differences = []
    for index in range(48):
        first_prediction = 0.35 + 0.01 * (index % 9)
        second_prediction = 0.45 + 0.02 * (index % 7)
        differences.append(abs(first_prediction - second_prediction))
        for model, prediction in (("GPT-Test", first_prediction), ("Claude-Test", second_prediction)):
            panel_rows.append({
                "date": "2026-01-01",
                "source": "test",
                "event_id": f"event-{index}",
                "horizon": "30",
                "model_name": model,
                "model_configuration": "zero shot",
                "prediction": prediction,
                "outcome": index % 2,
                "origin_type": "Market" if index % 5 == 0 else "Dataset",
                "question_fixed_effect": 0,
                "normalization_term": 0,
            })
    write_csv(panel_path, panel_rows)
    pair_path = tmp_path / "pairs.json"
    pair_path.write_text(json.dumps({
        "cross_fit": {"eligible_points": [{"model_a": "GPT-Test", "model_b": "Claude-Test"}]},
    }), encoding="utf-8")

    _, fold_rows, pair_rows, payload = run_experiment(
        panel_path,
        pair_path,
        split_repetitions=10,
        minimum_fold_overlap=1,
    )

    assert payload["evaluation"]["diversity_metrics"]["total_variation"]["label"] == "Total variation (TV)"
    assert {row["metric"] for row in payload["evaluation"]["focal_correlation_summary"]} == {
        "adjusted_pog", "high_loss_lift", "adjusted_loss_corr", "total_variation",
    }
    assert len(payload["points"]) == 2
    for point in payload["points"]:
        combined = point["combined"]
        first = point["directions"]["a_to_b"]
        second = point["directions"]["b_to_a"]
        assert combined["train_diversity"]["total_variation"] == pytest.approx(
            sum(differences) / len(differences)
        )
        assert combined["train_diversity"]["total_variation"] == pytest.approx(
            sum(view["train_diversity"]["total_variation"] * view["train_target_cells"]
                for view in (first, second)) / combined["train_target_cells"]
        )
        assert combined["train_target_cells"] == 48 * 10
    assert all(0 <= row["train_total_variation_complementarity"] <= 1 for row in fold_rows)
    assert all(0 <= row["train_total_variation_complementarity"] <= 1 for row in pair_rows)

    export_path = tmp_path / "fold-results.csv.gz"
    write_csv(export_path, fold_rows)
    with gzip.open(export_path, "rt", encoding="utf-8", newline="") as handle:
        exported = list(csv.DictReader(handle))
    assert len(exported) == len(fold_rows)
    assert [float(row["train_total_variation_complementarity"]) for row in exported] == [
        row["train_total_variation_complementarity"] for row in fold_rows
    ]
