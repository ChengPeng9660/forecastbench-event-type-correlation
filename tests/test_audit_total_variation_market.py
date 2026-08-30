from copy import deepcopy

import pytest

from analysis.audit_total_variation_market import LABEL, differences, tv_contract


def performance_payload():
    return {
        "metrics": {
            "total_variation": {"label": LABEL, "range": [0.0, 1.0]},
            "prediction_diversity": {}, "adjusted_pog": {},
            "high_loss_diversity": {}, "adjusted_loss_diversity": {},
        },
        "points": [{"diversity": {"total_variation": 0.0}},
                   {"diversity": {"total_variation": 1.0}}],
    }


def test_old_values_and_raw_hashes_are_not_exempted():
    before = {"gain": 0.2, "enabled": False, "panel_sha256": "same"}
    after = {**before, "total_variation": 0.0}
    assert differences(before, after) == []
    for field, value in (("gain", 0.3), ("enabled", 0), ("panel_sha256", "changed")):
        assert differences(before, {**after, field: value})
    assert differences(before, {**after, "unexpected": 1})
    assert differences(before, {"gain": 0.2})
    assert differences({"points": [1]}, {"points": [1, 2]})


def test_only_derived_hashes_and_time_changes_are_allowed():
    assert differences({"generated_at": "old", "summary_sha256": "old"},
                       {"generated_at": "new", "summary_sha256": "new"}) == []
    assert differences({}, {"diversity_metrics": {"total_variation": {}}}) == []
    assert differences({}, {"diversity_metrics": {"other": {}}})


def test_every_applicable_point_requires_valid_tv_including_zero():
    payload = performance_payload()
    report = tv_contract(payload, "market-diversity-performance.json")
    assert report["passed"]
    assert report["numeric_values"] == 2
    assert report["minimum"] == 0.0
    assert report["maximum"] == 1.0
    for invalid in (None, True, "0.5", float("nan"), -0.01, 1.01):
        broken = deepcopy(payload)
        broken["points"][0]["diversity"]["total_variation"] = invalid
        assert not tv_contract(broken, "market-diversity-performance.json")["passed"]
    del payload["points"][0]["diversity"]["total_variation"]
    assert not tv_contract(payload, "market-diversity-performance.json")["passed"]


@pytest.mark.parametrize("field,value", [("label", "Total Variation (TV)"), ("range", [-1, 1])])
def test_metadata_requires_canonical_label_and_bernoulli_range(field, value):
    payload = performance_payload()
    payload["metrics"]["total_variation"][field] = value
    assert not tv_contract(payload, "market-diversity-performance.json")["passed"]


def test_raw_tv_and_complementarity_share_orientation_for_single_and_averaged_metrics():
    payload = {"diversity_metrics": {"total_variation": {"label": LABEL, "range": [0.0, 1.0]}},
               "points": [{"metrics": {"adjusted_pog": {"raw": 0.1},
                                       "total_variation": {"raw": 0.2, "complementarity": 0.2}}}]}
    assert tv_contract(payload, "freeze-baseline.json")["passed"]
    tv = payload["points"][0]["metrics"]["total_variation"]
    tv["reason"] = ""
    assert tv_contract(payload, "freeze-baseline.json")["passed"]
    tv["complementarity"] = -0.2
    assert not tv_contract(payload, "freeze-baseline.json")["passed"]
    tv["complementarity"] = 0.2
    tv["reason"] = "missing"
    assert not tv_contract(payload, "freeze-baseline.json")["passed"]


def test_each_direction_requires_tv_even_when_combined_value_exists():
    payload = {"evaluation": {"diversity_metrics": {
        "total_variation": {"label": LABEL, "range": [0.0, 1.0]}}},
        "points": [{"combined": {"train_diversity": {"total_variation": 0.2}},
                    "directions": {"a_to_b": {"train_diversity": {}}}}]}
    report = tv_contract(payload, "without-freeze-base.json")
    assert not report["passed"]
    assert "a_to_b" in report["errors"][0]
