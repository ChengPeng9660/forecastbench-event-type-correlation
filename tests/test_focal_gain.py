"""The archived focal export must retain the same-support predictive TV."""

import csv

import pytest

from analysis.focal_gain import build_payload


@pytest.mark.parametrize("lift_value", [.5, ""])
def test_focal_gain_appends_tv_without_changing_aggregation(tmp_path, lift_value):
    panel = tmp_path / "panel.csv"
    fields = ["date", "source", "event_id", "horizon", "model_name",
              "prediction", "outcome", "origin_type", "question_fixed_effect",
              "normalization_term"]
    with panel.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for i, (first, second) in enumerate(((.2, .3), (.3, .5), (.4, .7))):
            for model, prediction in (("GPT-Focal", first), ("Claude-Partner", second)):
                writer.writerow(dict(zip(fields, ["2025-01-01", "polymarket", str(i),
                    "7", model, prediction, i % 2, "Market", 0, 0])))
    pairs = tmp_path / "pairs.csv"
    row = {"global_scope": "official_full", "eligible": "1", "model_a": "GPT-Focal",
           "model_b": "Claude-Partner", "n_overlap": 3, "near_bi": "1",
           "bi_gap_common": 1.0, "adjusted_pog": .02,
           "adjusted_high_loss_lift_025": lift_value, "adjusted_loss_pearson_corr": .6,
           "total_variation": .2}
    with pairs.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)

    payload = build_payload(panel, pairs, "GPT-Focal", .56)
    point = payload["points"][0]
    assert point["n_overlap"] == 3
    assert point["metrics"]["total_variation"] == {"raw": .2, "complementarity": .2}
    assert point["metrics"]["adjusted_pog"]["raw"] == .02
    if lift_value == "":
        assert point["metrics"]["high_loss_lift"]["raw"] is None
        assert point["metrics"]["high_loss_lift"]["complementarity"] is None
    assert point["focal_adjusted_brier"] == pytest.approx((.2**2 + .7**2 + .4**2) / 3)
    assert point["gain_fraction"] == pytest.approx(
        (point["focal_adjusted_brier"] - point["aggregate_adjusted_brier"])
        / point["focal_adjusted_brier"]
    )
