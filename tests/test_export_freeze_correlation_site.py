from __future__ import annotations

from pathlib import Path

import pytest

from analysis.export_freeze_correlation_site import build_payload


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
