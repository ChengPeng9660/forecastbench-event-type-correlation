"""Independent TV checks, including the topic/global sufficient statistics."""

from dataclasses import replace

import pytest

from analysis.cross_type import as_float
from analysis.global_baseline import pair_matrix_values, subtract_pair_accumulator
from analysis.metrics import (
    Observation,
    PairAccumulator,
    compute_pair_topic_row,
    finalize_accumulated_pair_row,
    total_variation,
)


def observations(probabilities, losses=None):
    losses = losses or [0.1 + i / 100 for i in range(len(probabilities))]
    return [
        Observation("2025-01-01", "polymarket", str(i), "", "Market", loss, probability)
        for i, (probability, loss) in enumerate(zip(probabilities, losses))
    ]


def finish(accumulator):
    return finalize_accumulated_pair_row(
        slice_dimension="global", slice_id="official_full", model_a="A", model_b="B",
        n_model_a_targets=accumulator.n_overlap, n_model_b_targets=accumulator.n_overlap,
        accumulator=accumulator, organization_a="", organization_b="",
        min_overlap=1, near_bi_gap=2,
    )


@pytest.mark.parametrize(
    "first,second,expected",
    [([0, 0.5, 1], [0, 0.5, 1], 0), ([0, 1], [1, 0], 1),
     ([0.2, 0.4, 0.6, 0.8], [0.3, 0.5, 0.7, 0.9], 0.1),
     ([0.1, 0.9], [0.9, 0.1], 0.8)],
)
def test_tv_is_mean_per_target_bernoulli_distance(first, second, expected):
    # Identical marginal histograms in the final case must not produce TV=0.
    assert total_variation(first, second) == pytest.approx(expected)
    assert total_variation(second, first) == pytest.approx(expected)


@pytest.mark.parametrize("first,second", [([], []), ([0.1], []), ([0.1], [0.1, 0.2])])
def test_tv_rejects_empty_or_unaligned_vectors(first, second):
    with pytest.raises(ValueError, match="equal non-empty"):
        total_variation(first, second)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -0.01, 1.01])
def test_tv_rejects_invalid_probabilities(value):
    with pytest.raises(ValueError, match="finite probabilities"):
        total_variation([0.2], [value])


def test_topic_tv_matches_streaming_and_ignores_losses():
    left = observations([0.2, 0.4, 0.6, 0.8])
    right = observations([0.3, 0.5, 0.7, 0.9])
    direct = compute_pair_topic_row(
        "finance_economics", "A", "B",
        {row.target_key: row for row in left}, {row.target_key: row for row in right},
        min_overlap=1,
    )
    accumulator = PairAccumulator()
    accumulator.update("2025-01-01", left, right, 0.25)
    assert direct["total_variation"] == pytest.approx(0.1)
    assert finish(accumulator)["total_variation"] == pytest.approx(direct["total_variation"])
    changed = PairAccumulator()
    changed.update(
        "2025-01-01", [replace(row, adjusted_brier=0.8) for row in left],
        [replace(row, adjusted_brier=0.03) for row in right], 0.25,
    )
    assert finish(changed)["total_variation"] == pytest.approx(direct["total_variation"])


def test_global_leave_topic_out_tv_matches_exact_remaining_support():
    left = observations([0.2, 0.3, 0.4, 0.5])
    right = observations([0.2, 0.4, 0.7, 0.9])
    total, removed, kept = PairAccumulator(), PairAccumulator(), PairAccumulator()
    total.update("2025-01-01", left, right, 0.25)
    removed.update("2025-01-01", left[:2], right[:2], 0.25)
    kept.update("2025-01-01", left[2:], right[2:], 0.25)
    subtracted = finish(subtract_pair_accumulator(total, removed))
    assert subtracted["total_variation"] == pytest.approx(finish(kept)["total_variation"])
    assert subtracted["total_variation"] == pytest.approx(0.35)
    assert pair_matrix_values(subtracted)[14:] == [subtracted["total_variation"], None]


def test_missing_probabilities_are_not_imputed_or_silently_dropped():
    left = observations([0.2, None, 0.4])
    right = observations([0.2, 0.4, 0.7])
    accumulator = PairAccumulator()
    accumulator.update("2025-01-01", left, right, 0.25)
    row = finish(accumulator)
    assert row["n_overlap"] == 3
    assert row["total_variation"] == ""
    assert row["tv_reason"] == "missing_prediction_probabilities"
    assert row["adjusted_pog"] != ""


def test_numeric_zero_is_not_a_missing_tv():
    assert as_float(0.0) == 0.0
    assert as_float("0.0") == 0.0
    assert as_float(None) is None
    assert as_float("") is None


def test_leave_topic_out_roundoff_does_not_exceed_unit_interval():
    left, right = observations([0, 0, 0]), observations([0.6, 0.6, 1])
    total, removed = PairAccumulator(), PairAccumulator()
    total.update("2025-01-01", left, right, 0.25)
    removed.update("2025-01-01", left[:2], right[:2], 0.25)
    assert finish(subtract_pair_accumulator(total, removed))["total_variation"] == 1.0
