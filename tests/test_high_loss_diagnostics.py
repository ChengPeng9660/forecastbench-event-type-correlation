import copy
import math

import pytest

from analysis.closed_form_aggregation import aggregate_pairs, evaluate_pair
from analysis.export_site import as_float
from analysis.high_loss_diagnostics import details_from_metric_row, fold_diagnostics, high_loss_details, oriented_diagnostics
from analysis.metrics import high_loss_lift
from analysis.pair_aggregation import DIVERSITY_METRICS, METHODS, aggregate_cross_fit_records
from analysis.refresh_high_loss_diagnostics import update_coordinate, verify_preserved


def test_zero_joint_and_zero_marginal_are_distinct_and_extreme_lift_is_not_clipped():
    a, b = [.6, .1], [.1, .6]
    assert high_loss_lift(a,b)[0] == 0
    assert high_loss_details(a,b)["joint_high_count"] == 0
    assert high_loss_lift([.25,.1],b)[0] is None
    rare = [.6] + [.1]*69
    assert high_loss_lift(rare,rare)[0] == pytest.approx(70)
    detail=high_loss_details(rare,rare)
    assert (detail["high_count_a"],detail["high_count_b"],detail["joint_high_count"]) == (1,1,1)
    assert detail["expected_joint_count"] == pytest.approx(1/70)


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_invalid_losses_and_threshold_are_rejected(bad):
    with pytest.raises(ValueError,match="finite"):
        high_loss_lift([bad],[.1])
    with pytest.raises(ValueError,match="finite"):
        high_loss_lift([.1],[.1],bad)


def test_numeric_raw_zero_is_preserved_by_site_number_parser():
    assert as_float(0) == as_float(0.0) == as_float("0") == 0
    assert as_float(None) is None


def test_fold_coverage_never_pools_ratios_or_treats_missing_as_zero():
    details=[high_loss_details([.8,.2],[.8,.2]),high_loss_details([.1]*3,[.8]*3)]
    result=fold_diagnostics([-1.,None],[2,3],reasons=["",details[1]["reason"]],details=details)
    assert result["included_fold_count"] == 2
    assert result["defined_fold_count"] == 1
    assert result["undefined_fold_count"] == 1
    assert result["valid_train_target_cells"] == 2
    assert result["train_target_cells"] == 5
    assert result["high_count_a"] == 1
    assert result["high_count_b"] == 4
    reverse=oriented_diagnostics(result,True)
    assert reverse["high_count_a"] == 4
    assert reverse["joint_high_count"] == result["joint_high_count"]
    assert reverse["reason_counts"] == {"model_b_marginal_high_loss_rate_zero": 1}
    assert oriented_diagnostics(details[1],True)["reason"] == "model_b_marginal_high_loss_rate_zero"


def test_partial_legacy_diagnostics_are_explicitly_unavailable():
    result=fold_diagnostics([None],[3],details=[{"count_diagnostics_available":False}])
    assert result["count_diagnostics_available"] is False
    assert result["undefined_fold_count"] == 1
    assert "high_count_a" not in result
    details=details_from_metric_row({"n_overlap":3,"lift_reason":"model_a_marginal_high_loss_rate_zero"},reverse=True)
    assert details["reason"] == "model_b_marginal_high_loss_rate_zero"


def test_pair_crossfit_does_not_attach_partial_lift_to_full_fold_scores():
    records=[]
    for i,n in enumerate((10,20)):
        metrics={metric:{"raw":.2,"complementarity":.2,"reason":""} for metric in DIVERSITY_METRICS}
        metrics["high_loss_lift"]={"raw":None if i==0 else 0.,"complementarity":None if i==0 else 1.,"reason":"zero_margin" if i==0 else ""}
        records.append({"metrics":metrics,"n_train":n,"n_test":30-n,"train_bi_gap":1.,"train_near_bi":True,
                        "fold_id":str(i),"best_single_side":"model_a",
                        "adjusted_brier":{method:.2 for method in ("model_a","model_b",*METHODS)},
                        "brier_index":{method:55. for method in ("model_a","model_b",*METHODS)},
                        "gain_fraction_vs_best_single":{method:.1 for method in METHODS},
                        "past_only_diagnostic":{"cold_start_rows":0,"model_a_choice_dates":0,"model_b_choice_dates":0}})
    base={key:"fixture" for key in ("model_a","model_b","family_a","family_b","pair_group","n_dates","date_min","date_max")}
    result=aggregate_cross_fit_records(base,records,"eligible")
    assert result["metrics"]["high_loss_lift"]["raw"] is None
    assert result["metrics"]["high_loss_lift"]["complementarity"] is None
    assert result["metrics"]["total_variation"]["raw"] == pytest.approx(.2)
    assert result["brier_index"]["simple_mean"] == 55.
    assert result["cross_fit"]["test_target_rows"] == 30


def test_closed_form_partial_lift_is_null_and_other_aggregate_fields_unchanged():
    a,b={},{}
    for i in range(40):
        key=("2026-01-01","polymarket",str(i),"")
        row={"date":key[0],"source":key[1],"event_id":key[2],"horizon":"","prediction":".2",
             "outcome":str(i%2),"origin_type":"Market","question_fixed_effect":"0","normalization_term":"0"}
        a[key]=row
        b[key]={**row,"prediction":".7"}
    records=[r for r in evaluate_pair("fixed_focal_without_freeze","GPT-A","Claude-B",a,b,[20260825],1,.56,5.) if r["method"]=="simple_mean"]
    baseline=aggregate_pairs(records)[0]
    modified=copy.deepcopy(records)
    modified[0]["train_high_loss_lift_complementarity"]=None
    modified[0]["train_high_loss_lift_reason"]="fixture_zero_margin"
    result=aggregate_pairs(modified)[0]
    assert result["train_high_loss_lift_complementarity"] is None
    for key in baseline:
        if key not in {"train_high_loss_lift_complementarity","high_loss_diagnostics"}:
            assert result[key] == baseline[key]


def test_refresh_is_high_loss_only_and_rejects_unrelated_score_changes():
    before={"train_diversity":{"high_loss_lift":1.,"total_variation":.2},"brier_index":80.}
    after=copy.deepcopy(before)
    records=[{"value":1.,"n_train":10},{"value":None,"n_train":20}]
    update_coordinate(after,after["train_diversity"],"high_loss_lift",records)
    assert after["train_diversity"]["high_loss_lift"] is None
    assert verify_preserved(before,after)==2
    after["brier_index"] += 1e-12
    with pytest.raises(ValueError,match="non-high-loss"):
        verify_preserved(before,after)
