"""Ensure that additive-TV regression checks do not hide old-value changes."""

import pytest

from analysis.audit_total_variation_core import differences, without_tv


def test_only_new_tv_metrics_are_removed_before_comparison():
    old = {"metrics": {"adjusted_pog": .03}, "bi": 75.0,
           "rows": [{"metric_id": "adjusted_pog", "rho": .4}]}
    new = {"metrics": {"adjusted_pog": .03, "total_variation": 0.0}, "bi": 75.0,
           "rows": [{"metric_id": "adjusted_pog", "rho": .4},
                    {"metric_id": "total_variation", "rho": -.1}]}
    assert not differences(without_tv(old), without_tv(new))
    new["bi"] = 74.0
    assert differences(without_tv(old), without_tv(new))


def test_packed_matrix_tv_columns_do_not_reindex_existing_metrics():
    old = {"fields": ["n_overlap", "adjusted_pog"], "pairs": [[50, .03]]}
    new = {"fields": ["n_overlap", "adjusted_pog", "total_variation", "tv_reason"],
           "pairs": [[50, .03, 0.0, None]]}
    assert without_tv(new) == old
    new["pairs"][0][1] = .04
    assert differences(old, without_tv(new))


@pytest.mark.parametrize("before,after", [(0, False), (True, 1), (1.0, float("nan")),
                                          ({"support": 50}, {}), ([1, 2], [1])])
def test_audit_rejects_type_missing_and_numeric_changes(before, after):
    assert differences(before, after)
