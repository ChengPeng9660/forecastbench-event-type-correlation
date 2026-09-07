import json
from pathlib import Path

import numpy as np
import pytest

from analysis.type_selection import (
    apply_router, brier, fit_router, predictions_for, scope_scores, summarize,
)

ROOT = Path(__file__).resolve().parents[1]


def training():
    # Reciprocal specialists with equal Overall ability, plus a sparse type.
    y = np.r_[np.zeros(30), np.ones(30), 0.0]
    p = np.column_stack([np.full(61, .1), np.full(61, .9)])
    groups = np.array(["politics"] * 30 + ["finance"] * 30 + ["sports"])
    return p, y, np.arange(61), groups


def test_event_weighting_does_not_overweight_events_with_more_targets():
    p = np.array([[0., 1.], [0., 1.], [0., 1.], [1., 0.]])
    # One event has three targets, another has one: both receive half the weight.
    assert brier(p, np.zeros(4), np.array([0, 0, 0, 1])).tolist() == [.5, .5]


def test_reciprocal_routes_and_unseen_sparse_fallback():
    fit = fit_router(*training(), ["A", "B"])
    assert fit["crossing"]
    assert set(fit["complementary"]) == {"politics", "finance"}
    test_p = np.array([[.2, .8]] * 5)
    pred, fallback, selected = apply_router(fit, test_p, np.array(["politics", "finance", "sports", "new", ""]))
    np.testing.assert_allclose(pred, [.2, .8, .2, .2, .2])
    assert fallback.tolist() == [False, False, True, True, True]
    assert selected.tolist() == [0, 1, 0, 0, 0]


def test_test_outcomes_cannot_change_routes_or_complementary_membership():
    fit = fit_router(*training(), ["A", "B"])
    pred, fallback, choices = predictions_for(fit, np.array([[.2, .8], [.9, .1]]), np.array(["politics", "finance"]))
    before = json.dumps(fit, sort_keys=True)
    a = scope_scores(pred, np.zeros(2), np.arange(2), np.ones(2, bool), fallback, choices)
    b = scope_scores(pred, np.ones(2), np.arange(2), np.ones(2, bool), fallback, choices)
    assert a["scores"]["brier"] != b["scores"]["brier"]
    assert json.dumps(fit, sort_keys=True) == before
    np.testing.assert_array_equal(pred[:, 0], [.2, .1])


def test_overall_tie_uses_stable_configuration_identity():
    p, y, ev, groups = training()
    fit = fit_router(p[:60], y[:60], ev[:60], groups[:60], ["Zeta", "Alpha"])
    assert fit["fallback"] == 1
    pred, fallback, _ = apply_router(fit, np.array([[.2, .9]]), np.array(["unknown"]))
    assert pred[0] == .9 and fallback[0]


def test_supported_category_tie_uses_overall_winner():
    p, y, ev, groups = training()
    p = np.r_[p, np.full((30, 2), .4)]
    y, ev, groups = np.r_[y, np.zeros(30)], np.arange(91), np.r_[groups, ["health"] * 30]
    fit = fit_router(p, y, ev, groups, ["A", "B"])
    route = next(r for r in fit["routes"] if r["type"] == "health")
    assert route["fallback"] and route["selected"] == fit["fallback"]
    assert not route["complementary"]


def test_nested_scope_reweights_events_and_empty_scope_is_null():
    fit = fit_router(*training(), ["A", "B"])
    types = np.array(["politics", "politics", "finance", "unknown"])
    pred, fallback, choice = predictions_for(fit, np.array([[.2, .8]] * 4), types)
    events, outcomes = np.array([0, 0, 1, 2]), np.array([0., 0., 1., 1.])
    subset = np.isin(types, fit["complementary"])
    sub = scope_scores(pred, outcomes, events, subset, fallback, choice)
    all_events = scope_scores(pred, outcomes, events, np.ones(4, bool), fallback, choice)
    assert sub["events"] == 2 and all_events["events"] == 3
    assert sub["event_fraction"] == 2 / 3 and sub["fallback_fraction"] == 0
    assert all_events["fallback_fraction"] == pytest.approx(1 / 3)
    assert sub["scores"]["brier"][0] == pytest.approx(.04)
    assert all_events["scores"]["brier"][0] == pytest.approx(.24)
    empty = scope_scores(pred, outcomes, events, np.zeros(4, bool), fallback, choice)
    assert empty["scores"]["bi"] == [None] * 8
    assert summarize([])["all"]["defined_pairs"] == 0


def test_published_pair_membership_and_frozen_numerical_audit():
    data = json.loads((ROOT / "site/public/data/type-selection/study.json").read_text())
    old = json.loads((ROOT / "site/public/data/complementarity/study.json").read_text())
    expected = {r["id"] for r in old["pairs"] if r["dimension"] == "topic" and r["crossing"]}
    assert {r["id"] for r in data["pairs"]} == expected
    assert data["audit"]["status"] == data["audit"]["independent"]["status"] == "PASS"
    assert data["audit"]["max_frozen_score_error"] < 1e-9
    assert data["audit"]["independent"]["sampled_primary_pairs"] >= 100
    assert len(data["summaries"]) == 240
    for row in data["pairs"]:
        sub, full = row["scopes"]["complementary"], row["scopes"]["all"]
        assert 0 <= sub["events"] <= full["events"]
        assert 0 <= sub["targets"] <= full["targets"]
        assert full["event_fraction"] == 1
        assert any(r["complementary"] and r["selected"] == 0 for r in row["routes"])
        assert any(r["complementary"] and r["selected"] == 1 for r in row["routes"])
        for scope in [sub, full]:
            if scope["events"]:
                np.testing.assert_allclose(scope["scores"]["bi"], 100 * (1 - np.sqrt(scope["scores"]["brier"])), atol=1e-10)
