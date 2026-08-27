from __future__ import annotations

from analysis.upper_left_model_pair_aggregation import (
    FIXED_UPPER_LEFT_CONFIGURATIONS,
    METHODS,
    _percentile,
)


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
