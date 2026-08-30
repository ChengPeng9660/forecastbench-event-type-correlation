from __future__ import annotations

import math
from pathlib import Path

import pytest

from analysis.pair_aggregation import (
    build_cross_fit,
    dependence_support,
    event_fold,
    pair_group,
    predictions,
    read_panel,
    summarize,
)


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
    assert pair_group("GPT-A", "Qwen-B") == "gpt_qwen"
    assert pair_group("Claude-A", "DeepSeek-B") == "claude_deepseek"
    assert pair_group("Gemini-A", "Kimi-B") == "gemini_kimi"
    assert pair_group("GPT-A", "Gemini-B") == "gpt_gemini"
    assert pair_group("Claude-A", "Kimi-B") == "claude_kimi"
    assert pair_group("Qwen-A", "DeepSeek-B") == "qwen_deepseek"


def test_event_fold_is_deterministic_and_keeps_the_event_together() -> None:
    first = event_fold("Metaculus", "event-17", 20260825)
    assert first in {"A", "B"}
    assert event_fold("metaculus", "event-17", 20260825) == first
    assert event_fold("Metaculus", "event-17", 20260825) == first


def tv_panels() -> tuple[dict, dict]:
    first, second = {}, {}
    for index in range(48):
        event_id = f"tv-event-{index}"
        partner_prediction = 0.41 if event_fold("test", event_id, 20260825) == "A" else 0.9
        dates = ("2026-01-01", "2026-02-01") if index % 5 == 0 else ("2026-01-01",)
        for date in dates:
            key = (date, "test", event_id, "30")
            shared = {
                "date": date,
                "source": "test",
                "event_id": event_id,
                "horizon": "30",
                "outcome": "1",
                "origin_type": "Market" if index % 4 == 0 else "Dataset",
                "question_fixed_effect": "0",
                "normalization_term": "0.02",
            }
            first[key] = {**shared, "prediction": "0.4"}
            second[key] = {**shared, "prediction": str(partner_prediction)}
    return first, second


def test_total_variation_is_symmetric_outcome_blind_and_target_weighted() -> None:
    first, second = tv_panels()
    common = sorted(first)
    expected = sum(
        abs(float(first[key]["prediction"]) - float(second[key]["prediction"]))
        for key in common
    ) / len(common)
    forward = dependence_support(first, second, common, 2.0, 0.25)["metrics"]["total_variation"]
    reverse = dependence_support(second, first, common, 2.0, 0.25)["metrics"]["total_variation"]
    changed_first = {key: {**row, "outcome": "0"} for key, row in first.items()}
    changed_second = {key: {**row, "outcome": "0"} for key, row in second.items()}
    changed = dependence_support(changed_first, changed_second, common, 2.0, 0.25)["metrics"]["total_variation"]

    assert forward == {"raw": pytest.approx(expected), "complementarity": pytest.approx(expected), "reason": ""}
    assert reverse == forward
    assert changed == forward
    assert 0 <= forward["raw"] <= 1


def test_cross_fit_total_variation_uses_training_support_and_existing_near_bi_filter() -> None:
    first, second = tv_panels()
    common = sorted(first)
    seeds = list(range(20260825, 20260835))
    base = {
        "model_a": "GPT-Test",
        "model_b": "Claude-Test",
        "family_a": "GPT",
        "family_b": "Claude",
        "pair_group": "gpt_claude",
        "n_dates": 2,
        "date_min": "2026-01-01",
        "date_max": "2026-02-01",
    }
    payload = build_cross_fit(
        {"GPT-Test": first, "Claude-Test": second},
        [{"model_a": "GPT-Test", "model_b": "Claude-Test"}],
        [base],
        ec_weight=0.56,
        piecewise_threshold=5.0,
        split_seeds=seeds,
        minimum_fold_overlap=1,
        near_bi_gap=2.0,
        high_loss_threshold=0.25,
    )

    assert payload["audit"]["pair_fold_records"] == 20
    assert 0 < payload["audit"]["near_bi_fold_records"] < 20
    for view, source in (
        ("combined", payload),
        ("a_to_b", payload["directional_points"]["a_to_b"]),
        ("b_to_a", payload["directional_points"]["b_to_a"]),
    ):
        for sample in ("eligible", "near_bi"):
            included = []
            for seed in seeds:
                for train_fold in ("A", "B"):
                    if view == "a_to_b" and train_fold != "A":
                        continue
                    if view == "b_to_a" and train_fold != "B":
                        continue
                    train_keys = [key for key in common if event_fold(key[1], key[2], seed) == train_fold]
                    dependence = dependence_support(first, second, train_keys, 2.0, 0.25)
                    if sample == "near_bi" and not dependence["near_bi"]:
                        continue
                    included.append(train_keys)
            points = source[f"{sample}_points"]
            if not included:
                assert points == []
                continue
            point = points[0]
            train_total = sum(len(keys) for keys in included)
            expected = sum(
                abs(float(first[key]["prediction"]) - float(second[key]["prediction"]))
                for keys in included for key in keys
            ) / train_total
            assert point["metrics"]["total_variation"] == {
                "raw": pytest.approx(expected),
                "complementarity": pytest.approx(expected),
            }
            assert point["cross_fit"]["included_fold_count"] == len(included)
            assert point["cross_fit"]["train_target_rows"] == train_total
            assert point["n_overlap"] == sum(len(common) - len(keys) for keys in included)


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


def test_gpt4o_alias_history_is_stitched_into_pinned_snapshot(tmp_path: Path) -> None:
    panel_path = tmp_path / "panel.csv"
    panel_path.write_text(
        "date,source,event_id,horizon,model_name,prediction,outcome,origin_type,question_fixed_effect,normalization_term\n"
        "2024-07-21,Test,early,30,GPT-4o,0.6,1,Dataset,0,0\n"
        "2025-03-30,Test,later,30,GPT-4o-2024-05-13,0.7,1,Dataset,0,0\n"
        "2025-03-30,Test,claude,30,Claude-Test,0.4,1,Dataset,0,0\n",
        encoding="utf-8",
    )

    panel, audit = read_panel(panel_path)

    assert "GPT-4o" not in panel
    assert set(panel["GPT-4o-2024-05-13"]) == {
        ("2024-07-21", "Test", "early", "30"),
        ("2025-03-30", "Test", "later", "30"),
    }
    assert audit == {
        "aliases": {"GPT-4o": "GPT-4o-2024-05-13"},
        "remapped_rows": {"GPT-4o": 1},
        "target_collisions": 0,
    }
