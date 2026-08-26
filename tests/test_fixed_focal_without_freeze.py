from __future__ import annotations

import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

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
