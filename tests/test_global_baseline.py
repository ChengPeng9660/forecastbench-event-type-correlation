from __future__ import annotations

import math
from pathlib import Path

import pytest

from analysis.export_site import stable_model_id
from analysis.global_baseline import (
    build_partner_summary,
    bool_value,
    comparison_statistics,
    finalize_leave_topic_out_pairs,
    is_excluded_llm_crowd,
    metric_value,
    model_id,
    subtract_pair_accumulator,
    write_partner_profile_shards,
)
from analysis.metrics import Observation, PairAccumulator, finalize_accumulated_pair_row


def obs(event: str, loss: float, origin: str = "Dataset") -> Observation:
    return Observation("2025-01-01", "test", event, "30.0", origin, loss)


def accumulator(rows_a: list[Observation], rows_b: list[Observation]) -> PairAccumulator:
    value = PairAccumulator()
    value.update("2025-01-01", rows_a, rows_b, .25)
    return value


def finalize(value: PairAccumulator | None, n: int) -> dict[str, object]:
    return finalize_accumulated_pair_row(
        slice_dimension="test", slice_id="test", model_a="A", model_b="B",
        n_model_a_targets=n, n_model_b_targets=n, accumulator=value,
        organization_a="", organization_b="", min_overlap=1, near_bi_gap=2,
    )


def test_subtract_pair_accumulator_matches_direct_kept_vectors() -> None:
    kept_a = [obs("d1", .1), obs("m1", .4, "Market"), obs("d2", .2)]
    kept_b = [obs("d1", .3), obs("m1", .2, "Market"), obs("d2", .5)]
    removed_a = [obs("d3", .7), obs("m2", .6, "Market")]
    removed_b = [obs("d3", .4), obs("m2", .8, "Market")]
    total = accumulator(kept_a + removed_a, kept_b + removed_b)
    removed = accumulator(removed_a, removed_b)
    subtracted = finalize(subtract_pair_accumulator(total, removed), len(kept_a))
    direct = finalize(accumulator(kept_a, kept_b), len(kept_a))
    for field in (
        "n_overlap", "model_a_common_bi", "model_b_common_bi", "bi_gap_common",
        "near_bi", "adjusted_pog", "adjusted_high_loss_lift_025",
        "high_loss_rate_a_025", "high_loss_rate_b_025", "joint_high_loss_rate_025",
        "joint_high_loss_count_025", "adjusted_loss_pearson_corr",
    ):
        assert subtracted[field] == pytest.approx(direct[field])


def test_leave_topic_out_support_is_global_minus_topic() -> None:
    models = ("A", "B", "C")
    global_ab = accumulator(
        [obs("1", .1), obs("2", .2), obs("3", .3)],
        [obs("1", .2), obs("2", .3), obs("3", .4)],
    )
    topic_ab = accumulator([obs("2", .2)], [obs("2", .3)])
    rows, audit = finalize_leave_topic_out_pairs(
        scope="official_full", topic="finance_economics",
        accumulators={
            ("official_full", "A", "B"): global_ab,
            ("finance_economics", "A", "B"): topic_ab,
        },
        target_counts={
            ("official_full", "A"): 3, ("official_full", "B"): 3,
            ("finance_economics", "A"): 1, ("finance_economics", "B"): 1,
        },
        organizations={}, models=models, min_overlap=1, near_bi_gap=2,
    )
    assert rows[("A", "B")]["n_overlap"] == 2
    assert rows[("A", "B")]["n_model_a_targets"] == 2
    assert rows[("A", "B")]["n_model_b_targets"] == 2
    assert rows[("A", "C")]["insufficient_overlap_reason"] == "model_missing_in_slice"
    assert audit["n_pairs"] == math.comb(3, 2)
    assert len(audit["sha256"]) == 64


def test_clean_universe_contract_and_crowd_filter() -> None:
    assert math.comb(263, 2) == 34_453
    assert is_excluded_llm_crowd(
        "LLM Crowd (gpt-4o, claude-3.5-sonnet, gemini-1.5-pro) median with news"
    )
    assert not is_excluded_llm_crowd("GPT-4o (news)")


def test_tie_aware_comparison_and_reporting_suppression() -> None:
    keys = ["a", "b", "c", "d"]
    small = comparison_statistics(keys, [1, 1, 2, 3], [10, 10, 20, 30], 1, 5)
    assert small["spearman"] is None
    assert small["dependent_top_jaccard"] is None
    assert small["reason"] == "defined_count_4_below_reporting_min_5"
    reportable = comparison_statistics(keys, [1, 1, 2, 3], [10, 10, 20, 30], 1, 4)
    assert reportable["spearman"] == pytest.approx(1)
    assert reportable["interpretation_status"] == "limited"
    assert reportable["dependent_top_jaccard"] == pytest.approx(1)
    assert sum(reportable["quartile_transition_counts"].values()) == 4


def test_model_ids_match_site_export_contract() -> None:
    name = "Claude-3.5-Sonnet (news)"
    assert model_id(name) == stable_model_id(name)
    assert model_id(name).startswith("m-")
    assert len(model_id(name)) == 14


def test_zero_metric_is_defined_not_missing() -> None:
    assert metric_value({"adjusted_pog": 0.0}, "adjusted_pog") == 0.0
    assert bool_value(0) is False
    assert bool_value(1) is True


def test_partner_summary_suppresses_fewer_than_30_focal_models() -> None:
    row = {
        "global_scope": "official_full", "comparison_mode": "leave_topic_out",
        "topic_id": "climate_weather", "metric_id": "adjusted_pog",
        "sample_id": "near_bi_both", "spearman": .5, "n_defined_partners": 20,
        "dependent_top_jaccard": .2, "complementary_top_jaccard": .3,
        "interpretation_status": "limited",
    }
    result = build_partner_summary([row], 263)
    target = next(
        value for value in result
        if all(value[key] == row[key] for key in (
            "global_scope", "comparison_mode", "topic_id", "metric_id", "sample_id"
        ))
    )
    assert target["n_reportable_focal_models"] == 1
    assert target["median_spearman"] is None
    assert target["mean_complementary_top_jaccard"] is None
    assert target["interpretation_status"] == "insufficient"


def test_partner_shards_remove_stale_and_match_index(tmp_path: Path) -> None:
    directory = tmp_path / "partner-profiles"
    directory.mkdir()
    (directory / "stale.json").write_text("{}", encoding="utf-8")
    models = ("A", "B")
    rows = [
        {
            "focal_model_id": model_id(model), "focal_model_name": model,
            "global_scope": "official_full", "comparison_mode": "leave_topic_out",
            "topic_id": "climate_weather", "metric_id": "adjusted_pog",
            "sample_id": "near_bi_both", "n_defined_partners": 1,
            "spearman": None, "pearson": None, "reason": "small",
            "interpretation_status": "insufficient",
        }
        for model in models
    ]
    index, records = write_partner_profile_shards(directory, rows, models)
    assert set(index) == {model_id(model) for model in models}
    assert {path.name for path in directory.glob("*.json")} == set(index.values())
    assert len(records) == 2
    assert not (directory / "stale.json").exists()
