from __future__ import annotations

import csv
from pathlib import Path

import pytest

from analysis.export_freeze_correlation_site import (
    DIVERSITY_METRICS,
    aggregation_scores,
    build_payload,
    build_without_freeze_base_payload,
)
from analysis.pair_aggregation import dependence_support, event_fold
from analysis.closed_form_aggregation import aggregate_pairs, evaluate_pair
from analysis.freeze_exposed_market_aggregation import add_model_reference_fields


def test_freeze_correlation_site_payload_matches_released_experiment() -> None:
    summary = Path("data/derived/freeze_exposed_market_aggregation/summary.json")
    pairs = Path(
        "data/derived/freeze_exposed_market_aggregation/pair_method_results.csv"
    )
    if not summary.exists() or not pairs.exists():
        pytest.skip("freeze-exposed experiment artifact not generated")
    payload = build_payload(summary, pairs)
    assert payload["audit"]["model_count"] == 27
    assert payload["audit"]["configuration_count"] == 39
    assert payload["audit"]["prompt_counts"] == {
        "zero_shot": 27,
        "scratchpad": 12,
    }
    assert payload["audit"]["model_event_cells"] == 13614
    assert payload["audit"]["all_configs_explicitly_with_freeze"]
    assert payload["audit"]["all_configs_exclude_news"]
    assert payload["audit"]["excluded_news_augmented_candidate_configurations"] == 9
    assert all(
        "with freeze values" in point["exact_configuration"].lower()
        for point in payload["points"]
    )
    assert all(
        "news" not in point["exact_configuration"].lower()
        for point in payload["points"]
    )
    assert {point["prompt_type"] for point in payload["points"]} == {
        "zero_shot",
        "scratchpad",
    }
    assert [row["method"] for row in payload["aggregation"]["summary_all"]] == [
        "ec_w0_56",
        "simple_mean",
        "log_odds_mean",
        "piecewise_odds",
        "cf_directional",
        "best_single",
    ]
    directional = next(
        row
        for row in payload["aggregation"]["summary_all"]
        if row["method"] == "cf_directional"
    )
    assert directional["pair_count"] == 39
    assert directional["test_target_cells"] == 136140
    assert directional["support_weighted_brier_index"] == pytest.approx(
        75.50871279772113
    )
    assert directional["support_weighted_gain_vs_market"] == pytest.approx(
        -0.00860617172400239
    )
    assert directional["positive_vs_market_pairs"] == 13
    assert all(
        set(point["aggregation"])
        == {
            "ec_w0_56",
            "simple_mean",
            "log_odds_mean",
            "piecewise_odds",
            "cf_directional",
            "best_single",
        }
        for point in payload["points"]
    )
    assert payload["points"] == sorted(
        payload["points"],
        key=lambda row: (
            -row["prediction_pearson"],
            row["model"].casefold(),
            row["model"],
            row["prompt_type"],
        ),
    )


def test_released_market_payload_preserves_both_cross_fit_directions() -> None:
    root = Path("data/derived/freeze_exposed_market_aggregation")
    summary = root / "summary.json"
    pairs = root / "pair_method_results.csv"
    folds = root / "fold_method_results.csv.gz"
    if not all(path.exists() for path in (summary, pairs, folds)):
        pytest.skip("freeze-exposed experiment artifact not generated")
    payload = build_payload(summary, pairs, folds)
    assert payload["aggregation"]["fold_views"] == {
        "combined": "ten A→B and ten B→A evaluations pooled",
        "a_to_b": "A-train diversity and B-test aggregation outcome",
        "b_to_a": "B-train diversity and A-test aggregation outcome",
    }
    for point in payload["points"]:
        assert set(point["directions"]) == {"a_to_b", "b_to_a"}
        a_to_b = point["directions"]["a_to_b"]
        b_to_a = point["directions"]["b_to_a"]
        assert a_to_b["base_name"] == b_to_a["base_name"] == "Polymarket Freeze"
        assert a_to_b["partner_name"] == b_to_a["partner_name"] == point["exact_configuration"]
        assert a_to_b["test_target_cells"] + b_to_a["test_target_cells"] == point["aggregation"]["cf_directional"]["test_target_cells"]


def test_without_freeze_fixed_base_payload_is_exact_same_version_and_directional() -> None:
    root = Path("data/derived/freeze_exposed_market_aggregation")
    summary = root / "summary.json"
    pairs = root / "without_freeze_base_pair_method_results.csv"
    folds = root / "without_freeze_base_fold_method_results.csv.gz"
    if not all(path.exists() for path in (summary, pairs, folds)):
        pytest.skip("without-freeze fixed-base experiment artifact not generated")
    payload = build_without_freeze_base_payload(summary, pairs, folds)
    assert payload["audit"]["configuration_count"] == 36
    assert payload["audit"]["model_count"] == 26
    assert payload["audit"]["prompt_counts"] == {"zero_shot": 26, "scratchpad": 10}
    assert payload["audit"]["all_bases_fixed_without_freeze"]
    assert payload["audit"]["all_partners_explicit_with_freeze"]
    assert len(payload["audit"]["excluded_configurations"]) == 3
    for point in payload["points"]:
        assert point["base_configuration"].endswith("(without freeze values)")
        assert point["partner_configuration"].endswith("with freeze values)")
        assert point["combined"]["base_name"] == point["base_configuration"]
        assert set(point["directions"]) == {"a_to_b", "b_to_a"}
        assert sum(
            point["directions"][direction]["test_target_cells"]
            for direction in ("a_to_b", "b_to_a")
        ) == point["combined"]["test_target_cells"]
        for view in (point["combined"], *point["directions"].values()):
            assert view["base_name"].endswith("(without freeze values)")
            assert view["partner_name"] == point["partner_configuration"]


def test_freeze_correlation_export_locks_market_anchor_exact_prompts_and_train_fields() -> None:
    summary = Path("data/derived/freeze_exposed_market_aggregation/summary.json")
    pairs = Path(
        "data/derived/freeze_exposed_market_aggregation/pair_method_results.csv"
    )
    if not summary.exists() or not pairs.exists():
        pytest.skip("freeze-exposed experiment artifact not generated")
    payload = build_payload(summary, pairs)
    with pairs.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    anchors = {
        row["model_b"]: row
        for row in rows
        if row["method"] == "anchor"
    }

    exact_configurations = [point["exact_configuration"] for point in payload["points"]]
    assert len(exact_configurations) == len(set(exact_configurations)) == 39
    assert payload["aggregation"]["market_baseline"] == (
        "ForecastBench freeze_datetime_value"
    )
    assert payload["aggregation"]["near_bi"] == {
        "threshold_bi_points": 2.0,
        "definition": "mean train-fold BI gap at most 2.0 points",
        "pair_count": 29,
    }

    source_fields = {
        "total_variation": "train_total_variation_complementarity",
        "adjusted_pog": "train_adjusted_pog_complementarity",
        "high_loss_lift": "train_high_loss_lift_complementarity",
        "adjusted_loss_corr": "train_adjusted_loss_corr_complementarity",
    }
    for point in payload["points"]:
        source = anchors[point["exact_configuration"]]
        assert source["experiment"] == "polymarket_model"
        assert source["model_a"] == "Polymarket Freeze"
        assert source["model_b"] == point["exact_configuration"]
        assert "with freeze values" in point["exact_configuration"].casefold()
        assert "news" not in point["exact_configuration"].casefold()
        assert int(source["test_target_cells"]) == point["n_common"] * 10
        for metric, field in source_fields.items():
            expected = float(source[field]) if source[field] else None
            if expected is None:
                assert point["train_diversity"][metric] is None
            else:
                assert point["train_diversity"][metric] == pytest.approx(expected)
        assert point["train_bi_gap"] == pytest.approx(float(source["train_bi_gap"]))
        assert point["train_near_bi_share"] == pytest.approx(
            float(source["train_near_bi_share"])
        )
        assert point["near_bi"] is (point["train_bi_gap"] <= 2.0)


def _synthetic_row(
    *, prediction: float, outcome: int, event_id: str
) -> dict[str, str]:
    return {
        "date": "2026-01-01",
        "source": "polymarket",
        "event_id": event_id,
        "horizon": "",
        "prediction": str(prediction),
        "outcome": str(outcome),
        "origin_type": "Market",
        "question_fixed_effect": "0",
        "normalization_term": "0",
    }


def test_freeze_market_fold_diversity_uses_only_the_training_keys() -> None:
    seed = 20260825
    keys = [
        ("2026-01-01", "polymarket", f"event-{index:02d}", "")
        for index in range(40)
    ]
    market = {
        key: _synthetic_row(
            prediction=0.15 + 0.7 * ((index * 7) % 11) / 10,
            outcome=index % 2,
            event_id=key[2],
        )
        for index, key in enumerate(keys)
    }
    model = {
        key: _synthetic_row(
            prediction=0.10 + 0.8 * ((index * 3 + 2) % 11) / 10,
            outcome=index % 2,
            event_id=key[2],
        )
        for index, key in enumerate(keys)
    }
    split = {
        fold: [
            key for key in keys
            if event_fold(key[1], key[2], seed) == fold
        ]
        for fold in ("A", "B")
    }
    records = evaluate_pair(
        "polymarket_model",
        "Polymarket Freeze",
        "GPT-Test (zero shot with freeze values)",
        market,
        model,
        [seed],
        minimum_fold_overlap=1,
        ec_weight=0.56,
        piecewise_threshold=5.0,
    )
    anchor_records = [record for record in records if record["method"] == "anchor"]
    assert {(record["train_fold"], record["test_fold"]) for record in anchor_records} == {
        ("A", "B"),
        ("B", "A"),
    }

    for record in anchor_records:
        train_keys = split[record["train_fold"]]
        test_keys = split[record["test_fold"]]
        assert set(train_keys).isdisjoint(test_keys)
        expected = dependence_support(market, model, train_keys, 2.0, 0.25)
        assert record["train_bi_gap"] == pytest.approx(expected["bi_gap"])
        for metric in DIVERSITY_METRICS:
            observed = record[f"train_{metric}_complementarity"]
            expected_value = expected["metrics"][metric]["complementarity"]
            if expected_value is None:
                assert observed is None
            else:
                assert observed == pytest.approx(expected_value)

        changed_market = {key: dict(row) for key, row in market.items()}
        changed_model = {key: dict(row) for key, row in model.items()}
        for key in test_keys:
            changed_market[key]["outcome"] = str(1 - int(changed_market[key]["outcome"]))
            changed_model[key]["outcome"] = str(1 - int(changed_model[key]["outcome"]))
            changed_market[key]["prediction"] = "0"
            changed_model[key]["prediction"] = "1"
        unchanged = dependence_support(
            changed_market, changed_model, train_keys, 2.0, 0.25
        )
        assert unchanged == expected

    # The same generic exporter feeds both with-freeze market pairs and the
    # same-version without-freeze-base combined/directional views.
    for train_fold in (None, "A", "B"):
        selected = [row for row in records if train_fold is None or row["train_fold"] == train_fold]
        pairs = add_model_reference_fields(aggregate_pairs(selected))
        index = {(row["model_b"], row["method"]): row for row in pairs}
        exported = aggregation_scores(
            index,
            "GPT-Test (zero shot with freeze values)",
            base_name="fixed base",
            partner_name="GPT-Test (zero shot with freeze values)",
        )
        relevant_keys = keys if train_fold is None else split[train_fold]
        expected_tv = sum(
            abs(float(market[key]["prediction"]) - float(model[key]["prediction"]))
            for key in relevant_keys
        ) / len(relevant_keys)
        assert exported["train_diversity"]["total_variation"] == pytest.approx(expected_tv)
    assert DIVERSITY_METRICS["total_variation"]["range"] == [0.0, 1.0]
    assert DIVERSITY_METRICS["total_variation"]["label"] == "Total variation (TV)"
