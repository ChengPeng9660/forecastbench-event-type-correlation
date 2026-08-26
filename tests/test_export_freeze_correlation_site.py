from __future__ import annotations

import csv
from pathlib import Path

import pytest

from analysis.export_freeze_correlation_site import build_payload
from analysis.pair_aggregation import dependence_support, event_fold
from analysis.closed_form_aggregation import evaluate_pair


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
        for metric in ("adjusted_pog", "high_loss_lift", "adjusted_loss_corr"):
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
        unchanged = dependence_support(
            changed_market, changed_model, train_keys, 2.0, 0.25
        )
        assert unchanged == expected
