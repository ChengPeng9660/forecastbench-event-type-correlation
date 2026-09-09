import copy

import numpy as np
import pytest

from analysis.typewise_matched_aggregation import (
    apply_typewise, fit_typewise_weights, method_predictions, score_scope,
)
from analysis.audit_typewise_matched_aggregation import independent_check
from analysis.type_selection_no_calibration import fit_weights


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


def test_sparse_and_unseen_types_use_global_even_when_sparse_signal_differs():
    y = np.tile([0.0, 1.0], 30)
    selected = np.full(60, .5)
    other = .2 + .6 * y
    types = np.array(["finance"] * 40 + ["health"] * 20)
    other[types == "health"] = 1 - other[types == "health"]
    fit = fit_typewise_weights(selected, other, y, np.arange(60), types, router(("finance",)))
    assert fit["fallback_source"] == "global"
    assert fit["fallback_log_weight"] == fit["global_log_weight"]
    sparse = types == "health"
    sparse_fit = fit_weights(selected[sparse], other[sparse], y[sparse], np.arange(60)[sparse])
    assert abs(sparse_fit["log_weight"] - fit["fallback_log_weight"]) > .1
    test_s = np.array([.4, .4])
    test_o = np.array([.8, .8])
    result = apply_typewise(test_s, test_o, np.array(["health", "sports"]), fit)
    assert result[0] == pytest.approx(result[1])
    global_prediction = method_predictions(test_s, test_o, np.array(["health", "sports"]), fit)[:, 1]
    np.testing.assert_array_equal(result, global_prediction)


def test_all_supported_training_types_use_global_for_unseen_fallback():
    y = np.tile([0.0, 1.0], 40)
    selected = np.full(80, .5)
    other = .2 + .6 * y
    types = np.array(["finance"] * 40 + ["health"] * 40)
    fit = fit_typewise_weights(selected, other, y, np.arange(80), types, router())
    assert fit["fallback_source"] == "global"
    assert fit["fallback_log_weight"] == pytest.approx(fit["global_log_weight"])


def test_type_fit_is_independent_of_unrelated_training_type_mass():
    selected = np.full(80, .5)
    y = np.tile([0.0, 1.0], 40)
    other = .2 + .6 * y
    types = np.array(["finance"] * 40 + ["health"] * 40)
    other[40:] = 1 - other[40:]
    fit = fit_typewise_weights(selected, other, y, np.arange(80), types, router())
    # Add independent events to the other type while retaining finance's data.
    indices = np.r_[np.arange(40), np.tile(np.arange(40, 80), 5)]
    expanded = fit_typewise_weights(selected[indices], other[indices], y[indices],
                                   np.arange(len(indices)), types[indices], router())
    assert expanded["type_log_weights"]["finance"] == fit["type_log_weights"]["finance"]
    assert abs(expanded["global_log_weight"] - fit["global_log_weight"]) > .1
    finance = types == "finance"
    independently_normalized = fit_weights(selected[finance], other[finance], y[finance],
                                          np.arange(80)[finance])
    assert fit["type_log_weights"]["finance"] == independently_normalized["log_weight"]


def test_support_boundary_and_empty_type_global_fallback():
    types = np.array(["finance"] * 30 + ["health"] * 29 + [""] * 40)
    y = np.arange(len(types)) % 2
    selected = np.full(len(types), .5)
    other = .2 + .6 * y
    routes = {"routes": [{"type": "finance", "train_events": 30},
                         {"type": "health", "train_events": 29}]}
    fit = fit_typewise_weights(selected, other, y, np.arange(len(types)), types, routes)
    assert fit["supported_types"] == ["finance"]
    assert set(fit["type_log_weights"]) == {"finance"}
    prediction = method_predictions(selected, other, types, fit)
    np.testing.assert_array_equal(prediction[types != "finance", 2], prediction[types != "finance", 1])


def test_independent_audit_uses_type_normalization_and_global_fallback():
    types = np.array(["finance"] * 40 + ["health"] * 70 + [""] * 10)
    y = np.arange(len(types)) % 2
    selected = np.full(len(types), .5)
    other = .2 + .6 * y
    other[types == "health"] = 1 - other[types == "health"]
    events = np.arange(len(types))
    fit = fit_typewise_weights(selected, other, y, events, types, router())
    prediction = method_predictions(selected, other, types, fit)
    duplicate = method_predictions(selected, selected, types, fit)
    masks = {"all": np.ones(len(types), dtype=bool), "complementary": types != ""}
    scores = {key: score_scope(prediction[mask], duplicate[mask], y[mask], events[mask])
              for key, mask in masks.items()}
    error, gradient = independent_check(selected, other, y, events, types,
                                        selected, other, y, events, types,
                                        fit, prediction, duplicate, masks, scores)
    assert error < 1e-12
    assert gradient < 1e-9
    # Relabeling a legacy pooled fallback must not pass the new contract.
    legacy = copy.deepcopy(fit)
    legacy["fallback_source"] = "pooled"
    with pytest.raises(AssertionError):
        independent_check(selected, other, y, events, types,
                          selected, other, y, events, types,
                          legacy, prediction, duplicate, masks, scores)


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
