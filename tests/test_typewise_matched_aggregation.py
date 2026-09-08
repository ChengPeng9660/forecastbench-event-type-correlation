import copy

import numpy as np
import pytest

from analysis.typewise_matched_aggregation import (
    apply_typewise, fit_typewise_weights, method_predictions, score_scope,
)


def router(supported=("finance", "health")):
    routes = []
    for group in ["finance", "health"]:
        routes.append({"type": group, "train_events": 40 if group in supported else 10})
    return {"routes": routes}


def test_opposite_type_signals_beat_one_global_coefficient():
    y = np.tile([0.0, 1.0], 80)
    types = np.array(["finance"] * 80 + ["health"] * 80)
    events = np.arange(len(y))
    selected = np.full(len(y), .5)
    informative = .1 + .8 * y
    other = informative.copy()
    other[types == "health"] = 1 - informative[types == "health"]
    fit = fit_typewise_weights(selected, other, y, events, types, router())
    predictions = method_predictions(selected, other, types, fit)
    brier = ((predictions - y[:, None]) ** 2).mean(axis=0)
    assert fit["type_betas"]["finance"] > 0
    assert fit["type_betas"]["health"] < 0
    assert brier[2] < brier[1] - .1


def test_sparse_and_unseen_types_share_pooled_fallback():
    y = np.tile([0.0, 1.0], 30)
    selected = np.full(60, .5)
    other = .2 + .6 * y
    types = np.array(["finance"] * 40 + ["health"] * 20)
    fit = fit_typewise_weights(selected, other, y, np.arange(60), types, router(("finance",)))
    assert fit["fallback_source"] == "pooled"
    test_s = np.array([.4, .4])
    test_o = np.array([.8, .8])
    result = apply_typewise(test_s, test_o, np.array(["health", "sports"]), fit)
    assert result[0] == pytest.approx(result[1])


def test_all_supported_training_types_use_global_for_unseen_fallback():
    y = np.tile([0.0, 1.0], 40)
    selected = np.full(80, .5)
    other = .2 + .6 * y
    types = np.array(["finance"] * 40 + ["health"] * 40)
    fit = fit_typewise_weights(selected, other, y, np.arange(80), types, router())
    assert fit["fallback_source"] == "global"
    assert fit["fallback_log_weight"] == pytest.approx(fit["global_log_weight"])


def test_duplicate_reproduces_selected_probability_up_to_documented_clipping():
    selected = np.array([0.0, .2, .8, 1.0])
    types = np.array(["finance", "health", "finance", "sports"])
    fit = {
        "global_log_weight": .2,
        "type_log_weights": {"finance": -.3, "health": .7},
        "fallback_log_weight": .1,
    }
    result = method_predictions(selected, selected, types, fit)
    np.testing.assert_allclose(result[:, 0], selected)
    expected = np.broadcast_to(np.clip(selected, 1e-6, 1 - 1e-6)[:, None], (4, 2))
    np.testing.assert_allclose(result[:, 1:], expected, atol=1e-12)


def test_event_weighting_is_invariant_to_repeated_targets_within_event():
    selected = np.array([.2, .8, .3, .9])
    other = np.array([.9, .2, .6, .1])
    y = np.array([1.0, 0.0, 0.0, 1.0])
    events = np.array([0, 0, 0, 1])
    types = np.array(["finance"] * 4)
    fit = fit_typewise_weights(selected, other, y, events, types, router(("finance",)))
    repeated = np.repeat(np.arange(4), [2, 2, 2, 1])
    fit_repeated = fit_typewise_weights(selected[repeated], other[repeated], y[repeated],
                                        events[repeated], types[repeated], router(("finance",)))
    assert fit_repeated["global_log_weight"] == pytest.approx(fit["global_log_weight"])
    assert fit_repeated["type_log_weights"]["finance"] == pytest.approx(fit["type_log_weights"]["finance"])


def test_test_outcomes_cannot_change_predictions_and_scores_match_definitions():
    selected = np.array([.2, .8, .4, .7])
    other = np.array([.7, .3, .6, .2])
    types = np.array(["finance", "health", "sports", "finance"])
    fit = {
        "global_log_weight": .2,
        "type_log_weights": {"finance": .4, "health": -.1},
        "fallback_log_weight": .05,
    }
    before = copy.deepcopy(fit)
    predictions = method_predictions(selected, other, types, fit)
    flipped_y = 1 - np.array([0.0, 1.0, 1.0, 0.0])
    np.testing.assert_array_equal(predictions, method_predictions(selected, other, types, fit))
    assert fit == before
    result = score_scope(predictions, method_predictions(selected, selected, types, fit),
                         flipped_y, np.array([0, 0, 0, 1]))
    first_event = ((predictions[np.array([0, 1, 2])] - flipped_y[:3, None]) ** 2).mean(axis=0)
    second_event = ((predictions[[3]] - flipped_y[[3], None]) ** 2).mean(axis=0)
    manual = np.mean([first_event, second_event], axis=0)
    np.testing.assert_allclose(result["brier"], manual, atol=1e-12)
