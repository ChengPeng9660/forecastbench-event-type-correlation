from __future__ import annotations

import csv
import gzip
import io
import json
from pathlib import Path

import pytest

from analysis.cross_type import (
    DETAIL_FIELDS,
    HEADLINE_MIN_DEFINED_PAIRS,
    METRICS,
    REPORTING_MIN_DEFINED_PAIRS,
    SAMPLES,
    SUMMARY_FIELDS,
    TOPICS,
    average_ranks,
    dependence_percentiles,
    load_pair_archive,
    run_analysis,
    summary_cell,
)


INPUT_FIELDS = [
    "slice_dimension",
    "slice_id",
    "model_a",
    "model_b",
    "organization_a",
    "organization_b",
    "n_overlap",
    "eligible",
    "near_bi",
    "bi_reason",
    "insufficient_overlap_reason",
    "adjusted_pog",
    "pog_reason",
    "adjusted_high_loss_lift_025",
    "lift_reason",
    "adjusted_loss_pearson_corr",
    "corr_reason",
]


def pair_row(
    topic: str,
    model_a: str,
    model_b: str,
    value: float,
    *,
    eligible: str = "1",
    near_bi: str = "1",
) -> dict[str, str]:
    return {
        "slice_dimension": "topic",
        "slice_id": topic,
        "model_a": model_a,
        "model_b": model_b,
        "organization_a": "TestOrg",
        "organization_b": "TestOrg",
        "n_overlap": "100",
        "eligible": eligible,
        "near_bi": near_bi,
        "bi_reason": "" if near_bi else "bi_not_estimable",
        "insufficient_overlap_reason": "" if eligible == "1" else "n_overlap_10_below_min_50",
        "adjusted_pog": str(value) if eligible == "1" else "",
        "pog_reason": "" if eligible == "1" else "n_overlap_10_below_min_50",
        "adjusted_high_loss_lift_025": str(value + 1) if eligible == "1" else "",
        "lift_reason": "" if eligible == "1" else "n_overlap_10_below_min_50",
        "adjusted_loss_pearson_corr": str(value / 10) if eligible == "1" else "",
        "corr_reason": "" if eligible == "1" else "n_overlap_10_below_min_50",
    }


def write_archive(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=INPUT_FIELDS, lineterminator="\n")
                writer.writeheader()
                writer.writerows(rows)


def complete_fixture(path: Path, n_models: int = 9) -> None:
    models = [f"Model-{index:02d}" for index in range(n_models)]
    rows: list[dict[str, str]] = []
    for topic_index, topic in enumerate(TOPICS):
        pair_index = 0
        for left_index, model_a in enumerate(models):
            for model_b in models[left_index + 1 :]:
                # Topic-specific affine transformations preserve rank stability.
                rows.append(pair_row(topic, model_a, model_b, pair_index * (topic_index + 1) + 0.5))
                pair_index += 1
    write_archive(path, rows)


def test_rank_and_pog_orientation_are_tie_preserving() -> None:
    assert average_ranks([1.0, 1.0, 3.0]) == [1.5, 1.5, 3.0]
    assert dependence_percentiles([1.0, 1.0, 3.0], -1) == pytest.approx([0.75, 0.75, 0.0])


def test_reporting_threshold_suppresses_small_samples() -> None:
    pairs = (("A", "B"), ("A", "C"))
    rows_a = {pair: pair_row(TOPICS[0], *pair, index + 1) for index, pair in enumerate(pairs)}
    rows_b = {pair: pair_row(TOPICS[1], *pair, index + 2) for index, pair in enumerate(pairs)}
    cell = summary_cell(TOPICS[0], TOPICS[1], "adjusted_pog", "near_bi_both", rows_a, rows_b, pairs)
    assert cell["n_defined_pairs"] == 2
    assert cell["spearman"] is None
    assert cell["pearson"] is None
    assert cell["reason"].startswith("defined_pair_count_2_below_reporting_min_30")
    assert cell["interpretation_status"] == "insufficient"
    assert sum(cell["quartile_transition_counts"].values()) == 2


def test_run_analysis_writes_deterministic_complete_universe(tmp_path: Path) -> None:
    archive = tmp_path / "pairs.csv.gz"
    complete_fixture(archive)
    outputs = []
    for run in ("one", "two"):
        root = tmp_path / run
        outputs.append(
            run_analysis(
                pair_metrics=archive,
                derived_dir=root / "derived",
                site_data_dir=root / "site-data",
                built_at="2026-08-19T00:00:00Z",
                analysis_commit="abc123",
            )
        )

    result = outputs[0]
    audit = result["audit"]
    assert audit["n_unordered_topic_pairs"] == 21
    assert audit["input"]["n_exact_models"] == 9
    assert audit["input"]["n_pair_universe"] == 36
    assert audit["n_detail_rows"] == 21 * 36
    assert audit["n_summary_rows"] == 21 * len(SAMPLES) * len(METRICS)
    assert result["summary"]["metric_ids"] == [
        "adjusted_pog",
        "high_loss_lift",
        "adjusted_loss_corr",
    ]
    assert result["summary"]["thresholds"] == {
        "reporting_min_defined_pairs": REPORTING_MIN_DEFINED_PAIRS,
        "headline_min_defined_pairs": HEADLINE_MIN_DEFINED_PAIRS,
        "quartile": 0.25,
    }
    first = result["summary"]["cells"][0]
    assert first["n_defined_pairs"] == 36
    assert first["spearman"] == pytest.approx(1.0)
    assert first["interpretation_status"] == "limited"
    assert sum(first["quartile_transition_counts"].values()) == 36

    detail_one = tmp_path / "one/derived/cross_type_pair_details.csv.gz"
    detail_two = tmp_path / "two/derived/cross_type_pair_details.csv.gz"
    assert detail_one.read_bytes() == detail_two.read_bytes()
    with gzip.open(detail_one, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        assert reader.fieldnames == DETAIL_FIELDS
        assert sum(1 for _ in reader) == 21 * 36
    with (tmp_path / "one/derived/cross_type_summary.csv").open(encoding="utf-8") as handle:
        assert csv.DictReader(handle).fieldnames == SUMMARY_FIELDS

    manifest = json.loads((tmp_path / "one/site-data/cross-type/manifest.json").read_text())
    assert manifest["pair_details_gzip"] == "cross-type/pair-details.csv.gz"
    assert manifest["topics"][0]["label_en"]
    assert manifest["samples"][0]["primary"] is True
    assert manifest["files"]["pair_details_gzip"]["path"] == "pair-details.csv.gz"
    assert len(manifest["files"]["pair_details_gzip"]["sha256"]) == 64


def test_missing_pair_and_undefined_near_bi_are_preserved(tmp_path: Path) -> None:
    archive = tmp_path / "partial.csv.gz"
    row = pair_row(TOPICS[0], "A", "B", 0.2, near_bi="")
    write_archive(archive, [row])
    topic_rows, all_pairs, organizations, _ = load_pair_archive(archive)
    assert all_pairs == (("A", "B"),)
    result = run_analysis(
        pair_metrics=archive,
        derived_dir=tmp_path / "derived",
        site_data_dir=tmp_path / "site",
        built_at="2026-08-19T00:00:00Z",
        analysis_commit="abc123",
    )
    assert result["audit"]["n_detail_rows"] == 21
    with gzip.open(tmp_path / "derived/cross_type_pair_details.csv.gz", "rt", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    first = rows[0]
    assert first["topic_a_near_bi"] == ""
    assert first["topic_b_row_present"] == "0"
    assert first["topic_b_insufficient_overlap_reason"] == "pair_missing_from_topic"
    assert first["adjusted_pog_topic_b_reason"] == "pair_missing_from_topic"


def test_plain_csv_input_uses_the_same_contract(tmp_path: Path) -> None:
    archive = tmp_path / "pairs.csv"
    with archive.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=INPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerow(pair_row(TOPICS[0], "A", "B", 0.2))
    topic_rows, all_pairs, _, audit = load_pair_archive(archive)
    assert all_pairs == (("A", "B"),)
    assert topic_rows[TOPICS[0]][("A", "B")]["adjusted_pog"] == "0.2"
    assert audit["input_rows"] == 1
