from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import pytest

from analysis.metrics import (
    Observation,
    PairAccumulator,
    adjusted_pog,
    compute_pair_topic_row,
    finalize_accumulated_pair_row,
    high_loss_lift,
    load_taxonomy,
    official_adjusted_brier,
    pearson_correlation,
    run_analysis,
)
from analysis.scoring import (
    compute_normalization_terms,
    model_is_clean_llm,
    path_is_definitely_non_clean,
    score_forecast_row,
)


def observation(
    event_id: str,
    loss: float,
    *,
    date: str = "2025-01-01",
    source: str = "fred",
    origin: str = "Dataset",
) -> Observation:
    return Observation(date, source, event_id, "30.0", origin, loss)


def test_adjusted_pog_uses_common_event_losses() -> None:
    loss_a = [0.1, 0.4, 0.2, 0.5]
    loss_b = [0.3, 0.2, 0.4, 0.1]
    assert adjusted_pog(loss_a, loss_b) == pytest.approx(0.1)


def test_high_loss_lift_uses_strict_point_25_threshold() -> None:
    lift, rate_a, rate_b, joint, count, reason = high_loss_lift(
        [0.25, 0.3, 0.1], [0.3, 0.4, 0.2]
    )
    assert rate_a == pytest.approx(1 / 3)
    assert rate_b == pytest.approx(2 / 3)
    assert joint == pytest.approx(1 / 3)
    assert count == 1
    assert lift == pytest.approx(1.5)
    assert reason == ""


def test_high_loss_lift_reports_zero_marginal() -> None:
    lift, *_rest, reason = high_loss_lift([0.1, 0.2], [0.3, 0.4])
    assert lift is None
    assert reason == "model_a_marginal_high_loss_rate_zero"


def test_pearson_reports_constant_vector() -> None:
    value, reason = pearson_correlation([1.0, 1.0, 1.0], [0.0, 1.0, 2.0])
    assert value is None
    assert reason == "model_a_adjusted_loss_vector_constant"


def test_official_adjusted_brier_equal_weights_origin_strata() -> None:
    rows = [
        observation("a", 0.1),
        observation("b", 0.1),
        observation("c", 0.9, source="polymarket", origin="Market"),
    ]
    assert official_adjusted_brier(rows) == pytest.approx(0.5)


def test_pair_topic_row_uses_only_identical_common_support() -> None:
    a_rows = {
        row.target_key: row
        for row in [
            observation("1", 0.1),
            observation("2", 0.4),
            observation("3", 0.2),
            observation("a-only", 0.9),
        ]
    }
    b_rows = {
        row.target_key: row
        for row in [
            observation("1", 0.3),
            observation("2", 0.2),
            observation("3", 0.4),
            observation("b-only", 0.9),
        ]
    }
    row = compute_pair_topic_row(
        "finance", "A", "B", a_rows, b_rows, min_overlap=3
    )
    assert row["eligible"] == 1
    assert row["n_overlap"] == 3
    assert row["adjusted_pog"] == pytest.approx(1 / 15)
    assert row["n_dates"] == 1
    assert row["source_list"] == "fred"


def test_pair_topic_row_retains_explicit_insufficient_reason() -> None:
    a = observation("1", 0.1)
    b = observation("1", 0.2)
    row = compute_pair_topic_row(
        "finance", "A", "B", {a.target_key: a}, {b.target_key: b}, min_overlap=50
    )
    assert row["eligible"] == 0
    assert row["insufficient_overlap_reason"] == "n_overlap_1_below_min_50"
    assert row["adjusted_pog"] == ""
    assert row["metric_status"] == "not_estimable"


def test_missing_model_uses_slice_level_reason() -> None:
    a = observation("1", 0.1)
    row = compute_pair_topic_row(
        "finance", "A", "B", {a.target_key: a}, {}, min_overlap=1
    )
    assert row["insufficient_overlap_reason"] == "model_missing_in_slice"


def test_pair_metrics_are_symmetric_under_model_swap() -> None:
    a_rows = {
        row.target_key: row
        for row in [
            observation("1", 0.1),
            observation("2", 0.4),
            observation("3", 0.2),
        ]
    }
    b_rows = {
        row.target_key: row
        for row in [
            observation("1", 0.3),
            observation("2", 0.2),
            observation("3", 0.4),
        ]
    }
    ab = compute_pair_topic_row(
        "finance", "A", "B", a_rows, b_rows, min_overlap=3
    )
    ba = compute_pair_topic_row(
        "finance", "B", "A", b_rows, a_rows, min_overlap=3
    )
    for field in (
        "n_overlap",
        "n_dates",
        "bi_gap_common",
        "near_bi",
        "adjusted_pog",
        "adjusted_high_loss_lift_025",
        "joint_high_loss_rate_025",
        "adjusted_loss_pearson_corr",
    ):
        assert ab[field] == pytest.approx(ba[field])


def test_streaming_sufficient_statistics_match_direct_metrics() -> None:
    rows_a = [
        observation("1", 0.1),
        observation("2", 0.4),
        observation("3", 0.2),
    ]
    rows_b = [
        observation("1", 0.3),
        observation("2", 0.2),
        observation("3", 0.4),
    ]
    direct = compute_pair_topic_row(
        "finance",
        "A",
        "B",
        {row.target_key: row for row in rows_a},
        {row.target_key: row for row in rows_b},
        min_overlap=3,
    )
    accumulator = PairAccumulator()
    accumulator.update("2025-01-01", rows_a, rows_b, 0.25)
    streamed = finalize_accumulated_pair_row(
        slice_dimension="topic",
        slice_id="finance",
        model_a="A",
        model_b="B",
        n_model_a_targets=3,
        n_model_b_targets=3,
        accumulator=accumulator,
        organization_a="",
        organization_b="",
        min_overlap=3,
        near_bi_gap=2.0,
    )
    for field in (
        "bi_gap_common",
        "adjusted_pog",
        "adjusted_high_loss_lift_025",
        "high_loss_rate_a_025",
        "high_loss_rate_b_025",
        "joint_high_loss_rate_025",
        "adjusted_loss_pearson_corr",
    ):
        assert streamed[field] == pytest.approx(direct[field])


def test_taxonomy_conflicting_duplicate_key_fails(tmp_path: Path) -> None:
    taxonomy = tmp_path / "taxonomy.csv"
    taxonomy.write_text(
        "date,source,event_id,topic_id,origin_type,official_source,"
        "topic_analysis_eligible,review_required\n"
        "2025-01-01,fred,e1,finance,Dataset,FRED,true,false\n"
        "2025-01-01,fred,e1,politics,Dataset,FRED,true,false\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="conflicting taxonomy rows"):
        load_taxonomy(taxonomy)


def test_scoring_preserves_official_key_and_adjustment() -> None:
    key = ("2025-01-01", "fred", "e1", 30.0)
    fixed_effects = {key: 0.2}
    normalizations = compute_normalization_terms(fixed_effects)
    row, reason = score_forecast_row(
        {
            "forecast": 0.8,
            "resolved": True,
            "resolved_to": 1,
            "forecast_due_date": "2025-01-01T00:00:00Z",
            "resolution_date": "2025-01-31T00:00:00Z",
            "source": "fred",
            "id": "e1",
        },
        fixed_effects,
        normalizations,
    )
    assert reason is None
    assert row is not None
    assert row["date"] == "2025-01-01"
    assert row["horizon"] == 30.0
    assert row["origin_type"] == "Dataset"
    # With a one-question stratum, subtracting and adding FE cancels.
    assert row["adjusted_brier"] == pytest.approx(0.04)


@pytest.mark.parametrize(
    ("payload", "filename"),
    [
        ({"model": "Always 0"}, "x.json"),
        ({"model": "GPT ensemble"}, "x.json"),
        ({"model": "GPT-4"}, "2025.external.run.json"),
        ({"model": "Public Median"}, "x.json"),
    ],
)
def test_clean_llm_filter_matches_audited_exclusions(
    payload: dict[str, str], filename: str
) -> None:
    assert not model_is_clean_llm(payload, Path(filename))


@pytest.mark.parametrize(
    "filename",
    [
        "2025-10-26.external.Anonymous.1.json",
        "2025-10-26.ForecastBench.naive.json",
        "2025-10-26.OpenAI.superforecaster_with_news.json",
    ],
)
def test_filename_filter_skips_known_non_clean_payloads_before_read(filename: str) -> None:
    assert path_is_definitely_non_clean(Path(filename))


def test_run_analysis_writes_all_pair_topic_rows_and_audit(tmp_path: Path) -> None:
    taxonomy = tmp_path / "taxonomy.csv"
    taxonomy.write_text(
        "date,source,event_id,topic_id,origin_type,official_source,"
        "topic_analysis_eligible,review_required\n"
        "2025-01-01,fred,e1,finance,Dataset,FRED,true,false\n"
        "2025-01-01,fred,e2,finance,Dataset,FRED,true,false\n"
        "2025-01-01,fred,e3,finance,Dataset,FRED,true,true\n",
        encoding="utf-8",
    )
    panel = tmp_path / "panel.csv"
    fields = [
        "date",
        "source",
        "event_id",
        "horizon",
        "origin_type",
        "model_name",
        "model_organization",
        "adjusted_brier",
    ]
    with panel.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for model, org, losses in (
            ("Exact Model A", "Org A", [0.1, 0.4, 0.2]),
            ("Exact Model B", "Org B", [0.3, 0.2, 0.4]),
        ):
            for index, loss in enumerate(losses, start=1):
                writer.writerow(
                    {
                        "date": "2025-01-01",
                        "source": "fred",
                        "event_id": f"e{index}",
                        "horizon": "30.0",
                        "origin_type": "Dataset",
                        "model_name": model,
                        "model_organization": org,
                        "adjusted_brier": loss,
                    }
                )
    output = tmp_path / "pairs.csv"
    audit_path = tmp_path / "audit.json"
    audit = run_analysis(
        panel, taxonomy, output, audit_path, min_overlap=3
    )
    rows = list(csv.DictReader(output.open(encoding="utf-8", newline="")))
    assert len(rows) == 3
    assert {(row["slice_dimension"], row["slice_id"]) for row in rows} == {
        ("topic", "finance"),
        ("origin_type", "Dataset"),
        ("official_source", "FRED"),
    }
    topic_row = next(row for row in rows if row["slice_dimension"] == "topic")
    assert topic_row["topic_id"] == "finance"
    assert topic_row["model_a"] == "Exact Model A"
    assert topic_row["model_b"] == "Exact Model B"
    assert topic_row["eligible"] == "1"
    assert audit["pair_topic_rows"] == 1
    assert audit["pair_slice_rows"] == 3
    assert audit["taxonomy_counters"]["eligible_review_required_rows"] == 1
    assert json.loads(audit_path.read_text(encoding="utf-8"))["n_topics"] == 1


def test_ineligible_semantic_row_is_kept_only_in_official_slices(
    tmp_path: Path,
) -> None:
    taxonomy = tmp_path / "taxonomy.csv"
    taxonomy.write_text(
        "date,source,event_id,topic_id,origin_type,official_source,"
        "topic_analysis_eligible,review_required\n"
        "2025-01-01,fred,e1,other,Dataset,FRED,false,true\n",
        encoding="utf-8",
    )
    panel = tmp_path / "panel.csv"
    panel.write_text(
        "date,source,event_id,horizon,origin_type,model_name,"
        "model_organization,adjusted_brier\n"
        "2025-01-01,fred,e1,30.0,Dataset,A,Org A,0.1\n"
        "2025-01-01,fred,e1,30.0,Dataset,B,Org B,0.2\n",
        encoding="utf-8",
    )
    output = tmp_path / "pairs.csv"
    audit = run_analysis(panel, taxonomy, output, min_overlap=1)
    rows = list(csv.DictReader(output.open(encoding="utf-8", newline="")))
    assert {(row["slice_dimension"], row["slice_id"]) for row in rows} == {
        ("origin_type", "Dataset"),
        ("official_source", "FRED"),
    }
    assert audit["n_topics"] == 0
    assert audit["taxonomy_counters"]["topic_analysis_ineligible_rows"] == 1
    assert audit["taxonomy_counters"]["review_required_rows"] == 1


def test_allow_unclassified_is_bounded_by_unique_target_count(
    tmp_path: Path,
) -> None:
    taxonomy = tmp_path / "taxonomy.csv"
    taxonomy.write_text(
        "date,source,event_id,topic_id,origin_type,official_source,"
        "topic_analysis_eligible,review_required\n",
        encoding="utf-8",
    )
    panel = tmp_path / "panel.csv"
    panel.write_text(
        "date,source,event_id,horizon,origin_type,model_name,"
        "model_organization,adjusted_brier\n"
        "2025-01-01,fred,missing,30.0,Dataset,A,Org A,0.1\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="release limit is 0"):
        run_analysis(
            panel,
            taxonomy,
            tmp_path / "pairs.csv",
            allow_unclassified=True,
            max_unclassified_targets=0,
        )
