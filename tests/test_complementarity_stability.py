import math

import numpy as np
import pytest

from analysis.complementarity_stability import event_clustered_bi_gap


def test_identical_predictions_have_zero_gap_and_uncertainty():
    prediction = np.array([0.1, 0.2, 0.7, 0.8])
    result = event_clustered_bi_gap(
        prediction,
        prediction,
        np.array([0.0, 0.0, 1.0, 1.0]),
        np.full(4, 0.02),
        np.array([0, 0, 1, 1]),
    )

    assert result == {"gap_bi": 0.0, "se_bi": 0.0, "events": 2}


def test_event_clustered_gap_matches_adjusted_brier_index_difference():
    prediction_a = np.array([0.1, 0.2, 0.6, 0.8, 0.3, 0.7])
    prediction_b = np.array([0.3, 0.4, 0.7, 0.6, 0.2, 0.9])
    outcome = np.array([0.0, 0.0, 1.0, 1.0, 0.0, 1.0])
    offset = np.array([0.01, 0.01, 0.03, 0.03, 0.02, 0.02])
    result = event_clustered_bi_gap(
        prediction_a,
        prediction_b,
        outcome,
        offset,
        np.array([10, 10, 20, 20, 30, 30]),
    )

    adjusted_a = np.mean((prediction_a - outcome) ** 2 + offset)
    adjusted_b = np.mean((prediction_b - outcome) ** 2 + offset)
    expected = 100 * (math.sqrt(adjusted_b) - math.sqrt(adjusted_a))
    assert result["gap_bi"] == pytest.approx(expected)
    assert result["se_bi"] is not None and result["se_bi"] > 0
    assert result["events"] == 3


def test_single_event_leaves_uncertainty_undefined():
    result = event_clustered_bi_gap(
        [0.1, 0.9], [0.2, 0.8], [0.0, 1.0], [0.01, 0.01], [7, 7]
    )
    assert result["gap_bi"] is not None
    assert result["se_bi"] is None
    assert result["events"] == 1


def test_stable_gap_rejects_incompatible_inputs():
    with pytest.raises(ValueError, match="same shape"):
        event_clustered_bi_gap([0.1], [0.2, 0.3], [0.0], [0.0], [1])
    with pytest.raises(ValueError, match="finite"):
        event_clustered_bi_gap([np.nan], [0.2], [0.0], [0.0], [1])
