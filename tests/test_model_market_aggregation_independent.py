"""Adversarial producer checks against independent model/market probability arrays."""
from copy import deepcopy

import pytest

from analysis.audit_configuration_pair_aggregation import (
    IDENTITY_FIELDS, METHODS, METRICS, SEEDS, adjusted_losses, brier_index,
    compare_expected, event_half, event_mean, mean, reference_folds, reference_views,
)
from analysis.audit_model_market_aggregation import audit_payload
from analysis.configuration_pair_aggregation import build_views, prepare_panel
from analysis.model_market_aggregation import MARKET_BASE, evaluate_model_market


NAME = "Audit-model (zero shot with freeze values)"


def key(index, date="2025-01-01", horizon=""):
    return date, "polymarket", str(index), horizon


def row(probability, outcome=0, offset=0.02):
    return {"prediction": str(probability), "outcome": str(outcome), "origin_type": "Market",
            "question_fixed_effect": "0", "normalization_term": str(offset)}


def panels(count=24):
    market = {key(i): row((i % 7 + 1) / 10, i % 2) for i in range(count)}
    model = {key(i): row(0.8 - (i % 5) / 10, i % 2) for i in range(count)}
    return model, market


def produced(model, market, seeds=SEEDS):
    return evaluate_model_market(NAME, prepare_panel(model), prepare_panel(market), split_seeds=seeds)


@pytest.mark.parametrize("case", ["ordinary", "missing_market", "endpoints", "negative_adjusted_loss",
                                 "two_events", "one_event", "near_identical", "recurring_horizons"])
def test_all_scores_and_views_match_independent_arrays(case):
    model, market = panels()
    if case == "missing_market":
        market.pop(key(0))
    elif case == "endpoints":
        for i, k in enumerate(market):
            market[k]["prediction"] = str(i % 2)
            model[k]["prediction"] = str(1 - i % 2)
    elif case == "negative_adjusted_loss":
        market = {key(i): row(0, 0, -0.01 if event_half(key(i), SEEDS[0]) == "A" else 0.04) for i in range(24)}
        model = deepcopy(market)
    elif case == "two_events":
        model, market = panels(2)
    elif case == "one_event":
        market = {key("same-event", f"2025-01-{i+1:02}"): row(0.3, i % 2) for i in range(12)}
        model = deepcopy(market)
    elif case == "near_identical":
        model = {k: {**r, "prediction": str(float(r["prediction"]) + 1e-15)} for k, r in market.items()}
    elif case == "recurring_horizons":
        for panel in (model, market):
            panel[key(1, "2025-02-01", "30")] = deepcopy(panel[key(1)])
            panel[key(1, "2025-03-01", "90")] = deepcopy(panel[key(1)])
    actual = produced(model, market)
    expected = reference_folds(market, model, market)
    assert actual["first_configuration"] == MARKET_BASE
    assert actual["second_configuration"] == NAME
    assert actual["n_common"] == len(set(model) & set(market))
    assert len(actual["folds"]) == len(expected)
    assert compare_expected(reference_views(expected), build_views(actual)) == []
    for left, right in zip(expected, actual["folds"]):
        assert compare_expected(left["base"], right["market"]) == []
        assert compare_expected(left["partner"], right["second"]) == []
        assert compare_expected(left["methods"]["cf_directional"], right["cf_first"]) == []
        assert (right["weights_first"]["upward_alpha"], right["weights_first"]["downward_alpha"]) == pytest.approx(left["weights"])


def test_market_anchor_controls_unobserved_training_direction():
    model, market = panels(30)
    for i, k in enumerate(model):
        is_train_a = event_half(k, SEEDS[0]) == "A"
        market[k] = row(0.2 if is_train_a else 0.8, i % 2)
        model[k] = row(0.6 if is_train_a else 0.4, i % 2)
    fold = produced(model, market, [SEEDS[0]])["folds"][0]
    assert fold["train_fold"] == "A"
    assert fold["weights_first"]["downward_alpha"] == 0
    # No downward train examples: the deployed fallback must be market .8,
    # while anchoring at the model would incorrectly fall back to model .4.
    assert fold["cf_first"] == fold["market"]
    assert fold["cf_second"] == fold["second"]
    assert fold["cf_first"]["raw_brier"] != fold["cf_second"]["raw_brier"]


def test_test_data_cannot_change_training_x_weights_or_near_bi():
    model, market = panels()
    before = produced(model, market, [SEEDS[0]])["folds"][0]
    for panel in (model, market):
        for k in panel:
            if event_half(k, SEEDS[0]) == "B":
                panel[k]["prediction"] = "0.99"
                panel[k]["outcome"] = "0"
    after = produced(model, market, [SEEDS[0]])["folds"][0]
    for field in ("train_diversity", "train_bi_gap", "train_near_bi", "weights_first", "train_cf_statistics"):
        assert after[field] == before[field]
    assert after["market"]["raw_brier"] != before["market"]["raw_brier"]


def test_near_bi_is_selected_on_each_direction_before_pooling():
    model, market = panels()
    for k in market:
        market[k] = row(0.4, 0, 0)
        model[k] = row(0.4 if event_half(k, SEEDS[0]) == "A" else 0.9, 0, 0)
    result = produced(model, market, [SEEDS[0]])
    views = build_views(result)
    assert views["near_bi"]["combined"]["fold_count"] == 1
    assert views["near_bi"]["a_to_b"]["train_bi_gap"] == 0
    assert views["near_bi"]["b_to_a"] is None
    assert compare_expected(reference_views(reference_folds(market, model, market, seeds=[SEEDS[0]])), views) == []


def test_partial_undefined_x_and_zero_gain_denominators_remain_null():
    model, market = panels(5)
    result = build_views(produced(model, market, [SEEDS[0]]))["all"]["combined"]
    assert 0 < result["train_diversity_target_cells"]["prediction_diversity"] < result["train_target_cells"]
    assert result["train_diversity"]["prediction_diversity"] is None
    market = {key(i): row(0, 0, 0) for i in range(24)}
    output = build_views(produced(deepcopy(market), market))["all"]["combined"]
    assert output["methods"]["simple_mean"]["gain_vs_market"] is None
    assert output["methods"]["simple_mean"]["beats_market"] is False


def test_artifact_auditor_detects_reversed_anchor_bad_x_and_dropped_configuration():
    model, market = panels()
    identity = dict(zip(IDENTITY_FIELDS, (NAME, "Audit-model", "zero shot with freeze values", "Audit",
                                         "zero_shot", "Zero shot", "freeze_values", "Freeze values")))
    def score(panel):
        keys = sorted(panel)
        raw = event_mean(keys, [(float(panel[key]["prediction"])-float(panel[key]["outcome"]))**2 for key in keys])
        adjusted = event_mean(keys, adjusted_losses(panel, keys))
        return {"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": brier_index(raw)}
    catalog = {"points": [{**identity, "n_common": len(model), "model": score(model), "matched_market": score(market)}]}
    result = produced(model, market)
    point = {"configuration": identity, **{k: v for k, v in result.items() if k not in ("folds", "first_configuration", "second_configuration")},
             "views": build_views(result)}
    payload = {"schema_version": 2, "method_order": list(METHODS), "metric_order": list(METRICS),
               "methods": dict.fromkeys(METHODS, {}), "metrics": dict.fromkeys(METRICS, {}),
               "split": {"repetitions": 10, "seeds": list(SEEDS), "minimum_fold_overlap": 1, "near_bi_gap": 2}, "points": [point]}
    assert audit_payload(payload, {NAME: model}, market, catalog, expected_configuration_count=1)["passed"]
    bad = deepcopy(payload)
    bad["points"][0]["views"]["all"]["combined"]["base"] = deepcopy(point["views"]["all"]["combined"]["partner"])
    assert not audit_payload(bad, {NAME: model}, market, catalog, expected_configuration_count=1)["passed"]
    bad = deepcopy(payload)
    bad["points"][0]["views"]["all"]["combined"]["train_diversity"]["total_variation"] += 0.1
    assert not audit_payload(bad, {NAME: model}, market, catalog, expected_configuration_count=1)["passed"]
    bad = deepcopy(payload)
    bad["points"] = []
    assert not audit_payload(bad, {NAME: model}, market, catalog, expected_configuration_count=1)["passed"]
