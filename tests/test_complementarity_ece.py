from __future__ import annotations

import pytest

from analysis.complementarity_ece import expected_calibration_error


def test_prophet_arena_ten_bin_ece_matches_count_weighted_formula():
    probabilities = [0.05, 0.09, 0.10, 0.19, 0.30, 1.0]
    outcomes = [0, 1, 1, 0, 1, 1]

    # Bin contributions are (2/6)*|.07-.5|, (2/6)*|.145-.5|,
    # (1/6)*|.30-1|, and (1/6)*|1-1|.
    assert expected_calibration_error(probabilities, outcomes) == pytest.approx(
        0.37833333333333335
    )


def test_exact_decimal_boundary_enters_the_bin_to_its_right():
    separated = expected_calibration_error([0.299999999, 0.3], [0, 1])
    together = expected_calibration_error([0.3, 0.3], [0, 1])

    assert separated == pytest.approx(0.4999999995)
    assert together == pytest.approx(0.2)


def test_empty_ece_is_undefined_and_invalid_inputs_are_rejected():
    assert expected_calibration_error([], []) is None
    with pytest.raises(ValueError, match=r"\[0, 1\]"):
        expected_calibration_error([1.01], [1])
    with pytest.raises(ValueError, match="binary"):
        expected_calibration_error([0.5], [0.5])
