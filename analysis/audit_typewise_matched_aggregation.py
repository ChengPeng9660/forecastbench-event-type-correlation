"""Independent reconstruction checks for event-type matched aggregation."""
from __future__ import annotations

import math

import numpy as np


RIDGE = 0.005
METHOD_VERSION = "type_normalized_ll_ridge_v1"
PROTOCOL_VERSION = "20260909-normalized-ridge"


def _weights(events):
    unique, inverse, counts = np.unique(events, return_inverse=True, return_counts=True)
    return 1.0 / (len(unique) * counts[inverse])


def _logit(probability):
    p = np.clip(probability, 1e-6, 1 - 1e-6)
    return np.log(p) - np.log1p(-p)


def _logistic(value):
    return np.exp(value - np.logaddexp(0, value))


def reconstruct(selected, other, types, fit):
    """Recreate the three test predictions without importing the main module."""
    zs, zo = _logit(selected), _logit(other)
    global_lambda = fit["global_log_weight"]
    fallback_lambda = fit["fallback_log_weight"]
    mapping = fit["type_log_weights"]
    type_lambda = np.array([mapping.get(str(group), fallback_lambda) for group in types])
    return np.column_stack([
        selected,
        _logistic(zs + global_lambda * (zo - zs)),
        _logistic(zs + type_lambda * (zo - zs)),
    ])


def independent_scores(predictions, outcomes, events):
    """Compute event-equal Brier and scalar, target-weighted ten-bin ECE."""
    event_loss = [((predictions[events == event] - outcomes[events == event, None]) ** 2).mean(axis=0)
                  for event in np.unique(events)]
    brier = np.mean(event_loss, axis=0)
    ece = []
    for column in predictions.T:
        bins = np.array([min(9, math.floor(10 * float(value))) for value in column])
        value = 0.0
        for group in range(10):
            inside = bins == group
            if inside.any():
                value += inside.mean() * abs(column[inside].mean() - outcomes[inside].mean())
        ece.append(value)
    return np.asarray(brier), np.asarray(ece)


def independent_check(train_s, train_o, train_y, train_events, train_types,
                      test_s, test_o, test_y, test_events, test_types,
                      fit, predictions, duplicate, masks, results):
    """Audit the type-normalized ridge contract independently of its solver."""
    assert fit["method_version"] == METHOD_VERSION
    assert fit["protocol_version"] == PROTOCOL_VERSION
    supported = {str(group) for group in np.unique(train_types)
                 if group and len(np.unique(train_events[train_types == group])) >= 30}
    assert set(fit["supported_types"]) == supported
    assert set(fit["type_betas"]) == set(fit["type_log_weights"]) == supported
    assert fit["fallback_source"] == "global"
    assert abs(fit["fallback_log_weight"] - fit["global_log_weight"]) < 1e-12
    assert abs(fit["fallback_beta"] - 4 * fit["global_log_weight"]) < 1e-12
    rebuilt = reconstruct(test_s, test_o, test_types, fit)
    duplicate_rebuilt = reconstruct(test_s, test_s, test_types, fit)
    error = max(float(np.max(np.abs(rebuilt - predictions))),
                float(np.max(np.abs(duplicate_rebuilt - duplicate))))

    weights = _weights(train_events)
    z = _logit(train_s)
    x = (_logit(train_o) - z) / 4
    groups = [(group, train_types == group, beta)
              for group, beta in fit["type_betas"].items()]
    max_gradient = 0.0
    objective = 0.0
    for group, inside, beta in groups:
        assert abs(beta - 4 * fit["type_log_weights"][group]) < 1e-12
        group_weights = _weights(train_events[inside])
        linear = z[inside] + beta * x[inside]
        q = _logistic(linear)
        gradient = float(group_weights @ (x[inside] * (q - train_y[inside])) + RIDGE * beta)
        objective += float(group_weights @ (np.logaddexp(0, linear) - train_y[inside] * linear)
                           + .5 * RIDGE * beta**2)
        max_gradient = max(max_gradient, abs(gradient))
    error = max(error, abs(objective - fit["objective"]))

    global_beta = 4 * fit["global_log_weight"]
    global_q = _logistic(z + global_beta * x)
    global_gradient = float(weights @ (x * (global_q - train_y)) + RIDGE * global_beta)
    max_gradient = max(max_gradient, abs(global_gradient))

    for scope, mask in masks.items():
        expected = results[scope]
        if expected is None:
            assert not mask.any()
            continue
        brier, ece = independent_scores(rebuilt[mask], test_y[mask], test_events[mask])
        duplicate_brier, _ = independent_scores(duplicate_rebuilt[mask], test_y[mask], test_events[mask])
        error = max(error,
                    float(np.max(np.abs(brier - expected["brier"]))),
                    float(np.max(np.abs(ece - expected["ece"]))),
                    float(np.max(np.abs(duplicate_brier - expected["duplicate_brier"]))))
    return error, max_gradient
