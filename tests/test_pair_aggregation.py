from __future__ import annotations

import math

import pytest

from analysis.pair_aggregation import pair_group, predictions, summarize


def test_aggregation_formulas_are_symmetric() -> None:
    forward = predictions(0.8, 0.3, ec_weight=0.56, piecewise_threshold=5.0)
    reverse = predictions(0.3, 0.8, ec_weight=0.56, piecewise_threshold=5.0)
    assert forward == pytest.approx(reverse)
    assert forward["simple_mean"] == pytest.approx(0.55)
    expected_log_odds = 1 / (1 + math.exp(-0.5 * (math.log(4) + math.log(3 / 7))))
    assert forward["log_odds_mean"] == pytest.approx(expected_log_odds)


def test_piecewise_odds_uses_threshold_five() -> None:
    result = predictions(0.9, 0.9, ec_weight=0.56, piecewise_threshold=5.0)
    summed = 2 * math.log(9)
    expected_logit = summed - math.log(5) / 2
    assert result["piecewise_odds"] == pytest.approx(1 / (1 + math.exp(-expected_logit)))


def test_pair_group_labels() -> None:
    assert pair_group("GPT-A", "GPT-B") == "gpt_gpt"
    assert pair_group("Claude-A", "Claude-B") == "claude_claude"
    assert pair_group("GPT-A", "Claude-B") == "gpt_claude"


def test_summary_weights_pair_gain_by_common_support() -> None:
    points = [
        {
            "pair_group": "gpt_claude",
            "near_bi": True,
            "n_overlap": 100,
            "gain_fraction_vs_best_single": {
                "ec_w0_56": 0.10,
                "simple_mean": 0.0,
                "log_odds_mean": 0.0,
                "piecewise_odds": 0.0,
                "best_single": 0.0,
                "past_only_best_single": 0.0,
            },
        },
        {
            "pair_group": "gpt_claude",
            "near_bi": True,
            "n_overlap": 300,
            "gain_fraction_vs_best_single": {
                "ec_w0_56": -0.10,
                "simple_mean": 0.0,
                "log_odds_mean": 0.0,
                "piecewise_odds": 0.0,
                "best_single": 0.0,
                "past_only_best_single": 0.0,
            },
        },
    ]
    row = next(
        item
        for item in summarize(points)
        if item["pair_group"] == "gpt_claude"
        and item["sample"] == "near_bi"
        and item["method"] == "ec_w0_56"
    )
    assert row["macro_mean_gain_fraction"] == pytest.approx(0.0)
    assert row["support_weighted_gain_fraction"] == pytest.approx(-0.05)
