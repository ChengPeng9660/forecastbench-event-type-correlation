import copy
import numpy as np
from analysis.aggregation_stability import assess_stability, policy_choices, scores, independent_score_error
from analysis.type_selection import fit_router
from analysis.type_selection_calibrated_pooling import fit_pipeline, apply_pipeline


def fixture():
    events = np.arange(60)
    types = np.array(["finance"]*30+["health"]*30)
    y = np.tile([0., 1.], 30)
    # A leads in finance, B in health; overall performance is tied.
    raw = np.column_stack([.1+.8*y, .3+.4*y])
    raw[30:] = raw[30:, ::-1]
    return raw, y, events, types, fit_router(raw, y, events, types, ["A", "B"])


def test_only_crossed_training_types_are_assessed_and_all_must_avoid_reversal():
    raw, y, ev, types, router = fixture()
    assert router["crossing"] and len(router["complementary"]) == 2
    retained = assess_stability(router, raw, y, ev, types)
    assert retained["status"] == "no_reversal"
    assert np.array_equal(policy_choices(router, retained, raw, types), [0]*30+[1]*30)
    changed = raw.copy()
    changed[30:] = changed[30:, ::-1]
    reverse = assess_stability(router, changed, y, ev, types)
    assert reverse["reversed_types"] == ["health"]
    assert reverse["status"] == "reversed"
    # The entire pair falls back, including its non-reversed type.
    assert set(policy_choices(router, reverse, changed, types)) == {router["fallback"]}
    assert {r["policy_selected"] for r in reverse["routes"]} == {router["fallback"]}


def test_missing_test_type_is_unverified_and_ties_are_not_reversals():
    raw, y, ev, types, router = fixture()
    missing = assess_stability(router, raw[:30], y[:30], ev[:30], types[:30])
    assert missing["status"] == "unverified" and missing["missing_types"] == ["health"]
    assert set(policy_choices(router, missing, raw, types)) == {router["fallback"]}
    equal = raw.copy()
    equal[:, 1] = equal[:, 0]
    tied = assess_stability(router, equal, y, ev, types)
    assert tied["status"] == "no_reversal"
    assert {r["test_status"] for r in tied["routes"]} == {"tied"}


def test_test_labels_can_change_grouping_but_never_the_training_overall_choice():
    raw, y, ev, types, router = fixture()
    before = copy.deepcopy(router)
    normal = assess_stability(router, raw, y, ev, types)
    flipped = assess_stability(router, raw, 1-y, ev, types)
    assert normal["status"] == "no_reversal" and flipped["status"] == "reversed"
    assert normal["overall_choice"] == flipped["overall_choice"] == before["fallback"]
    assert router == before


def test_fallback_calibrators_are_fitted_to_overall_roles_and_scored_event_equally():
    raw, y, ev, types, router = fixture()
    # Break symmetry so calibration of the routed stream differs from overall A.
    raw[30:, 0] = .15+.35*y[30:]
    test_raw = raw[:, ::-1]
    stability = assess_stability(router, test_raw, y, ev, types)
    choices = policy_choices(router, stability, raw, types)
    assert stability["status"] == "reversed" and np.all(choices == router["fallback"])
    fit = fit_pipeline(raw, choices, y, ev)
    pred, stages = apply_pipeline(fit, test_raw, choices)
    np.testing.assert_array_equal(pred[:, 0], test_raw[:, router["fallback"]])
    np.testing.assert_allclose(pred[:, 2], test_raw.mean(axis=1), atol=0)
    old_choices = np.array([0]*30+[1]*30)
    old_fit = fit_pipeline(raw, old_choices, y, ev)
    assert not np.allclose(fit["output_coef"][0], old_fit["output_coef"][0])
    # Repeating targets within an event must not increase its Brier weight.
    idx = np.r_[np.arange(60), [0, 0, 1, 1, 1]]
    for matrix in [pred, stages["input"][0], stages["output"][0]]:
        result = scores(matrix[idx], y[idx], ev[idx])
        np.testing.assert_allclose(result["brier"], scores(matrix, y, ev)["brier"], atol=1e-12)
        assert independent_score_error(matrix[idx], y[idx], ev[idx], result) < 1e-12


def test_independent_ece_respects_the_archived_float_bin_boundary():
    pred = np.array([[.8999999999999999], [.9], [.91]])
    y, events = np.array([0., 1., 1.]), np.arange(3)
    result = scores(pred, y, events)
    assert independent_score_error(pred, y, events, result) < 1e-12
