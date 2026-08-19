"""Audit cross-event-type stability of ForecastBench pair dependence."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import itertools
import json
import math
import shutil
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

TOPICS = (
    "climate_weather", "entertainment_culture", "finance_economics",
    "health_science", "politics_conflict", "sports", "technology_ai",
)
SAMPLES = ("near_bi_both", "eligible_both")
REPORTING_MIN_DEFINED_PAIRS = 30
HEADLINE_MIN_DEFINED_PAIRS = 100
QUARTILE = 0.25
SCHEMA_VERSION = "1.0.0"
TOPIC_LABELS = {
    "climate_weather": "Climate & Weather",
    "entertainment_culture": "Entertainment & Culture",
    "finance_economics": "Finance & Economics",
    "health_science": "Health & Science",
    "politics_conflict": "Politics & Conflict",
    "sports": "Sports",
    "technology_ai": "Technology & AI",
}
METRICS: dict[str, dict[str, str | int]] = {
    "adjusted_pog": {
        "column": "adjusted_pog", "reason": "pog_reason", "direction": -1,
        "label": "Adjusted POG",
    },
    "high_loss_lift": {
        "column": "adjusted_high_loss_lift_025", "reason": "lift_reason", "direction": 1,
        "label": "High-loss lift",
    },
    "adjusted_loss_corr": {
        "column": "adjusted_loss_pearson_corr", "reason": "corr_reason", "direction": 1,
        "label": "Adjusted-loss correlation",
    },
}
SAMPLE_LABELS = {
    "near_bi_both": "Near-BI in both",
    "eligible_both": "All eligible in both",
}
REQUIRED_COLUMNS = {
    "slice_dimension", "slice_id", "model_a", "model_b", "organization_a",
    "organization_b", "n_overlap", "eligible", "near_bi", "bi_reason",
    "insufficient_overlap_reason",
    *(str(spec["column"]) for spec in METRICS.values()),
    *(str(spec["reason"]) for spec in METRICS.values()),
}
SUMMARY_FIELDS = [
    "topic_a", "topic_b", "metric_id", "sample_id", "n_pair_universe",
    "n_sample_pairs", "n_defined_pairs", "spearman", "pearson",
    "dependent_top_jaccard", "complementary_top_jaccard",
    "dependency_persistence_a_to_b", "dependency_persistence_b_to_a",
    "complementarity_persistence_a_to_b", "complementarity_persistence_b_to_a",
    "dependency_to_complementarity_a_to_b", "dependency_to_complementarity_b_to_a",
    "quartile_transition_counts", "reason", "interpretation_status",
]
DETAIL_FIELDS = [
    "topic_a", "topic_b", "model_a", "model_b", "organization_a", "organization_b",
    *[
        field for side in ("topic_a", "topic_b") for field in (
            f"{side}_row_present", f"{side}_eligible", f"{side}_near_bi",
            f"{side}_bi_reason", f"{side}_n_overlap", f"{side}_insufficient_overlap_reason",
        )
    ],
    "eligible_both", "near_bi_both",
    *[
        field for metric in METRICS for field in (
            f"{metric}_topic_a_value", f"{metric}_topic_b_value",
            f"{metric}_topic_a_reason", f"{metric}_topic_b_reason",
            *(
                field
                for sample in SAMPLES
                for field in (
                    f"{metric}_{sample}_defined",
                    f"{metric}_{sample}_dependence_percentile_a",
                    f"{metric}_{sample}_dependence_percentile_b",
                    f"{metric}_{sample}_quartile_transition",
                )
            ),
        )
    ],
]


def as_bool(value: object) -> bool | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in {"1", "true", "yes"}:
        return True
    if text in {"0", "false", "no"}:
        return False
    raise ValueError(f"invalid boolean: {value!r}")


def as_float(value: object) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    result = float(text)
    if not math.isfinite(result):
        raise ValueError(f"non-finite metric: {value!r}")
    return result


def average_ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: (values[index], index))
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        rank = ((start + 1) + end) / 2
        for offset in range(start, end):
            ranks[order[offset]] = rank
        start = end
    return ranks


def pearson(values_a: Sequence[float], values_b: Sequence[float]) -> tuple[float | None, str]:
    if len(values_a) != len(values_b):
        raise ValueError("pearson requires equal vectors")
    if len(values_a) < 3:
        return None, "fewer_than_3_values"
    mean_a, mean_b = sum(values_a) / len(values_a), sum(values_b) / len(values_b)
    centered_a = [value - mean_a for value in values_a]
    centered_b = [value - mean_b for value in values_b]
    scale_a = math.sqrt(sum(value * value for value in centered_a))
    scale_b = math.sqrt(sum(value * value for value in centered_b))
    if scale_a == 0 and scale_b == 0:
        return None, "both_vectors_constant"
    if scale_a == 0:
        return None, "topic_a_vector_constant"
    if scale_b == 0:
        return None, "topic_b_vector_constant"
    value = sum(a * b for a, b in zip(centered_a, centered_b)) / (scale_a * scale_b)
    return max(-1.0, min(1.0, value)), ""


def spearman(values_a: Sequence[float], values_b: Sequence[float]) -> tuple[float | None, str]:
    return pearson(average_ranks(values_a), average_ranks(values_b))


def dependence_percentiles(values: Sequence[float], direction: int) -> list[float]:
    if not values:
        return []
    if len(values) == 1:
        return [0.5]
    ranks = average_ranks([direction * value for value in values])
    return [(rank - 1) / (len(values) - 1) for rank in ranks]


def dependence_quartile(percentile: float) -> int:
    if percentile <= 0.25:
        return 1
    if percentile <= 0.50:
        return 2
    if percentile <= 0.75:
        return 3
    return 4


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_FIELDS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            output = dict(row)
            for key, value in output.items():
                if isinstance(value, (dict, list)):
                    output[key] = json.dumps(value, sort_keys=True, separators=(",", ":"))
            writer.writerow(output)


def model_pair(row: Mapping[str, str]) -> tuple[str, str]:
    model_a, model_b = row["model_a"].strip(), row["model_b"].strip()
    if not model_a or not model_b or model_a == model_b:
        raise ValueError("rows require two distinct exact model names")
    return (model_a, model_b) if model_a < model_b else (model_b, model_a)


def load_pair_archive(path: Path) -> tuple[
    dict[str, dict[tuple[str, str], dict[str, str]]], tuple[tuple[str, str], ...],
    dict[str, str], dict[str, Any],
]:
    topic_rows = {topic: {} for topic in TOPICS}
    organizations: dict[str, str] = {}
    models: set[str] = set()
    input_rows = 0
    handle_context = (
        gzip.open(path, "rt", encoding="utf-8", newline="")
        if path.suffix == ".gz"
        else path.open("r", encoding="utf-8", newline="")
    )
    with handle_context as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"pair archive missing columns: {sorted(missing)}")
        for row in reader:
            input_rows += 1
            pair = model_pair(row)
            for model, organization in zip(
                (row["model_a"].strip(), row["model_b"].strip()),
                (row["organization_a"].strip(), row["organization_b"].strip()),
            ):
                previous = organizations.get(model, organization)
                if previous and organization and previous != organization:
                    raise ValueError(f"conflicting organizations for {model!r}")
                organizations[model] = previous or organization
                models.add(model)
            if row["slice_dimension"] != "topic" or row["slice_id"] not in TOPICS:
                continue
            topic = row["slice_id"]
            if pair in topic_rows[topic]:
                raise ValueError(f"duplicate pair in topic {topic}: {pair!r}")
            topic_rows[topic][pair] = dict(row)
    if len(models) < 2:
        raise ValueError("input contains fewer than two exact models")
    all_pairs = tuple(itertools.combinations(sorted(models), 2))
    return topic_rows, all_pairs, organizations, {
        "input_rows": input_rows, "n_exact_models": len(models),
        "n_pair_universe": len(all_pairs),
        "topic_row_counts": {topic: len(topic_rows[topic]) for topic in TOPICS},
    }


def metric_value_reason(row: Mapping[str, str] | None, metric: str) -> tuple[float | None, str]:
    if row is None:
        return None, "pair_missing_from_topic"
    spec = METRICS[metric]
    value = as_float(row[str(spec["column"])])
    reason = row[str(spec["reason"])].strip()
    if value is not None and reason:
        raise ValueError(f"defined {metric} has a missingness reason")
    if value is None and not reason:
        reason = row["insufficient_overlap_reason"].strip() or "metric_missing_without_reason"
    return value, reason


def pair_in_sample(row_a: Mapping[str, str] | None, row_b: Mapping[str, str] | None, sample_id: str) -> bool:
    eligible = bool(
        row_a and row_b and as_bool(row_a["eligible"]) is True and as_bool(row_b["eligible"]) is True
    )
    if sample_id == "eligible_both":
        return eligible
    if sample_id == "near_bi_both":
        return bool(eligible and as_bool(row_a["near_bi"]) is True and as_bool(row_b["near_bi"]) is True)
    raise ValueError(f"unknown sample {sample_id!r}")


def safe_ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def summary_cell(
    topic_a: str, topic_b: str, metric_id: str, sample_id: str,
    rows_a: Mapping[tuple[str, str], Mapping[str, str]],
    rows_b: Mapping[tuple[str, str], Mapping[str, str]],
    all_pairs: Sequence[tuple[str, str]],
) -> dict[str, Any]:
    sample_pairs: list[tuple[str, str]] = []
    defined_pairs: list[tuple[str, str]] = []
    values_a: list[float] = []
    values_b: list[float] = []
    for pair in all_pairs:
        row_a, row_b = rows_a.get(pair), rows_b.get(pair)
        if not pair_in_sample(row_a, row_b, sample_id):
            continue
        sample_pairs.append(pair)
        value_a, _ = metric_value_reason(row_a, metric_id)
        value_b, _ = metric_value_reason(row_b, metric_id)
        if value_a is not None and value_b is not None:
            defined_pairs.append(pair)
            values_a.append(value_a)
            values_b.append(value_b)
    percentiles_a = dependence_percentiles(values_a, int(METRICS[metric_id]["direction"]))
    percentiles_b = dependence_percentiles(values_b, int(METRICS[metric_id]["direction"]))
    dependent_a = {pair for pair, value in zip(defined_pairs, percentiles_a) if dependence_quartile(value) == 4}
    dependent_b = {pair for pair, value in zip(defined_pairs, percentiles_b) if dependence_quartile(value) == 4}
    complementary_a = {pair for pair, value in zip(defined_pairs, percentiles_a) if dependence_quartile(value) == 1}
    complementary_b = {pair for pair, value in zip(defined_pairs, percentiles_b) if dependence_quartile(value) == 1}
    dependent_intersection = dependent_a & dependent_b
    complementary_intersection = complementary_a & complementary_b
    transition_counts = {f"Q{a}->Q{b}": 0 for a in range(1, 5) for b in range(1, 5)}
    for percentile_a, percentile_b in zip(percentiles_a, percentiles_b):
        transition_counts[
            f"Q{dependence_quartile(percentile_a)}->Q{dependence_quartile(percentile_b)}"
        ] += 1
    n_defined = len(defined_pairs)
    spearman_value: float | None = None
    pearson_value: float | None = None
    if n_defined < REPORTING_MIN_DEFINED_PAIRS:
        reason = f"defined_pair_count_{n_defined}_below_reporting_min_{REPORTING_MIN_DEFINED_PAIRS}"
        if n_defined < 3:
            reason += ";fewer_than_3_values"
        elif len(set(values_a)) == 1 and len(set(values_b)) == 1:
            reason += ";both_vectors_constant"
        elif len(set(values_a)) == 1:
            reason += ";topic_a_vector_constant"
        elif len(set(values_b)) == 1:
            reason += ";topic_b_vector_constant"
    else:
        spearman_value, spearman_reason = spearman(values_a, values_b)
        pearson_value, pearson_reason = pearson(values_a, values_b)
        reason = ";".join(sorted(set(filter(None, (spearman_reason, pearson_reason)))))
    estimable = spearman_value is not None and pearson_value is not None
    if not estimable:
        status = "insufficient"
    elif n_defined >= HEADLINE_MIN_DEFINED_PAIRS:
        status = "headline"
    else:
        status = "limited"
    return {
        "topic_a": topic_a, "topic_b": topic_b, "metric_id": metric_id,
        "sample_id": sample_id, "n_pair_universe": len(all_pairs),
        "n_sample_pairs": len(sample_pairs), "n_defined_pairs": n_defined,
        "spearman": spearman_value, "pearson": pearson_value,
        "dependent_top_jaccard": safe_ratio(len(dependent_intersection), len(dependent_a | dependent_b)),
        "complementary_top_jaccard": safe_ratio(len(complementary_intersection), len(complementary_a | complementary_b)),
        "dependency_persistence_a_to_b": safe_ratio(len(dependent_intersection), len(dependent_a)),
        "dependency_persistence_b_to_a": safe_ratio(len(dependent_intersection), len(dependent_b)),
        "complementarity_persistence_a_to_b": safe_ratio(len(complementary_intersection), len(complementary_a)),
        "complementarity_persistence_b_to_a": safe_ratio(len(complementary_intersection), len(complementary_b)),
        "dependency_to_complementarity_a_to_b": safe_ratio(len(dependent_a & complementary_b), len(dependent_a)),
        "dependency_to_complementarity_b_to_a": safe_ratio(len(dependent_b & complementary_a), len(dependent_b)),
        "quartile_transition_counts": transition_counts,
        "reason": reason or None, "interpretation_status": status,
    }


def sample_percentiles(
    rows_a: Mapping[tuple[str, str], Mapping[str, str]],
    rows_b: Mapping[tuple[str, str], Mapping[str, str]],
    all_pairs: Sequence[tuple[str, str]],
    sample_id: str,
) -> dict[str, dict[tuple[str, str], tuple[float, float]]]:
    result: dict[str, dict[tuple[str, str], tuple[float, float]]] = {}
    for metric, spec in METRICS.items():
        pairs: list[tuple[str, str]] = []
        values_a: list[float] = []
        values_b: list[float] = []
        for pair in all_pairs:
            row_a, row_b = rows_a.get(pair), rows_b.get(pair)
            if not pair_in_sample(row_a, row_b, sample_id):
                continue
            value_a, _ = metric_value_reason(row_a, metric)
            value_b, _ = metric_value_reason(row_b, metric)
            if value_a is not None and value_b is not None:
                pairs.append(pair)
                values_a.append(value_a)
                values_b.append(value_b)
        percentile_a = dependence_percentiles(values_a, int(spec["direction"]))
        percentile_b = dependence_percentiles(values_b, int(spec["direction"]))
        result[metric] = {pair: (a, b) for pair, a, b in zip(pairs, percentile_a, percentile_b)}
    return result


def detail_row(
    topic_a: str, topic_b: str, pair: tuple[str, str],
    row_a: Mapping[str, str] | None, row_b: Mapping[str, str] | None,
    organizations: Mapping[str, str],
    percentiles: Mapping[str, Mapping[str, Mapping[tuple[str, str], tuple[float, float]]]],
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "topic_a": topic_a, "topic_b": topic_b, "model_a": pair[0], "model_b": pair[1],
        "organization_a": organizations.get(pair[0], ""), "organization_b": organizations.get(pair[1], ""),
        "eligible_both": int(pair_in_sample(row_a, row_b, "eligible_both")),
        "near_bi_both": int(pair_in_sample(row_a, row_b, "near_bi_both")),
    }
    for label, row in (("topic_a", row_a), ("topic_b", row_b)):
        output[f"{label}_row_present"] = int(row is not None)
        output[f"{label}_eligible"] = "" if row is None else int(as_bool(row["eligible"]) is True)
        near_bi = None if row is None else as_bool(row["near_bi"])
        output[f"{label}_near_bi"] = "" if near_bi is None else int(near_bi)
        output[f"{label}_bi_reason"] = "pair_missing_from_topic" if row is None else row["bi_reason"]
        output[f"{label}_n_overlap"] = "" if row is None else row["n_overlap"]
        output[f"{label}_insufficient_overlap_reason"] = "pair_missing_from_topic" if row is None else row["insufficient_overlap_reason"]
    for metric in METRICS:
        value_a, reason_a = metric_value_reason(row_a, metric)
        value_b, reason_b = metric_value_reason(row_b, metric)
        output[f"{metric}_topic_a_value"] = "" if value_a is None else value_a
        output[f"{metric}_topic_b_value"] = "" if value_b is None else value_b
        output[f"{metric}_topic_a_reason"] = reason_a
        output[f"{metric}_topic_b_reason"] = reason_b
        for sample in SAMPLES:
            pair_percentiles = percentiles[sample][metric].get(pair)
            output[f"{metric}_{sample}_defined"] = int(pair_percentiles is not None)
            if pair_percentiles is None:
                output[f"{metric}_{sample}_dependence_percentile_a"] = ""
                output[f"{metric}_{sample}_dependence_percentile_b"] = ""
                output[f"{metric}_{sample}_quartile_transition"] = ""
            else:
                percentile_a, percentile_b = pair_percentiles
                output[f"{metric}_{sample}_dependence_percentile_a"] = percentile_a
                output[f"{metric}_{sample}_dependence_percentile_b"] = percentile_b
                output[f"{metric}_{sample}_quartile_transition"] = (
                    f"Q{dependence_quartile(percentile_a)}->Q{dependence_quartile(percentile_b)}"
                )
    return output


def write_detail_gzip(
    path: Path, topic_rows: Mapping[str, Mapping[tuple[str, str], Mapping[str, str]]],
    all_pairs: Sequence[tuple[str, str]], organizations: Mapping[str, str],
) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding="utf-8", newline="") as text:
                writer = csv.DictWriter(text, fieldnames=DETAIL_FIELDS, lineterminator="\n")
                writer.writeheader()
                for topic_a, topic_b in itertools.combinations(TOPICS, 2):
                    rows_a, rows_b = topic_rows[topic_a], topic_rows[topic_b]
                    percentiles = {
                        sample: sample_percentiles(rows_a, rows_b, all_pairs, sample)
                        for sample in SAMPLES
                    }
                    for pair in all_pairs:
                        writer.writerow(detail_row(topic_a, topic_b, pair, rows_a.get(pair), rows_b.get(pair), organizations, percentiles))
                        count += 1
    return count


def file_record(path: Path, relative_path: str) -> dict[str, Any]:
    return {"path": relative_path, "sha256": sha256_file(path), "size_bytes": path.stat().st_size}


def run_analysis(
    *, pair_metrics: Path, derived_dir: Path, site_data_dir: Path,
    built_at: str, analysis_commit: str,
) -> dict[str, Any]:
    topic_rows, all_pairs, organizations, input_audit = load_pair_archive(pair_metrics)
    cells = [
        summary_cell(topic_a, topic_b, metric, sample, topic_rows[topic_a], topic_rows[topic_b], all_pairs)
        for topic_a, topic_b in itertools.combinations(TOPICS, 2)
        for sample in SAMPLES for metric in METRICS
    ]
    derived_dir.mkdir(parents=True, exist_ok=True)
    cross_site_dir = site_data_dir / "cross-type"
    cross_site_dir.mkdir(parents=True, exist_ok=True)
    summary_csv = derived_dir / "cross_type_summary.csv"
    summary_json = derived_dir / "cross_type_summary.json"
    detail_gzip = derived_dir / "cross_type_pair_details.csv.gz"
    audit_json = derived_dir / "cross_type_audit.json"
    thresholds = {
        "reporting_min_defined_pairs": REPORTING_MIN_DEFINED_PAIRS,
        "headline_min_defined_pairs": HEADLINE_MIN_DEFINED_PAIRS,
        "quartile": QUARTILE,
    }
    summary_payload = {
        "schema_version": SCHEMA_VERSION, "topic_ids": list(TOPICS), "metric_ids": list(METRICS),
        "sample_ids": list(SAMPLES), "thresholds": thresholds, "cells": cells,
    }
    write_csv(summary_csv, cells)
    write_json(summary_json, summary_payload)
    detail_count = write_detail_gzip(detail_gzip, topic_rows, all_pairs, organizations)
    expected_detail_count = math.comb(len(TOPICS), 2) * len(all_pairs)
    if detail_count != expected_detail_count:
        raise AssertionError(f"detail rows {detail_count} != {expected_detail_count}")
    audit_payload = {
        "schema_version": SCHEMA_VERSION, "built_at": built_at, "analysis_commit": analysis_commit,
        "input": {"filename": pair_metrics.name, "sha256": sha256_file(pair_metrics), **input_audit},
        "thresholds": thresholds, "n_unordered_topic_pairs": math.comb(len(TOPICS), 2),
        "n_summary_rows": len(cells), "n_detail_rows": detail_count,
        "expected_detail_rows": expected_detail_count,
        "metric_orientation": {
            metric: "inverted" if int(spec["direction"]) == -1 else "direct"
            for metric, spec in METRICS.items()
        },
        "files": [],
    }
    audit_payload["files"] = [
        file_record(summary_csv, "cross_type_summary.csv"),
        file_record(summary_json, "cross_type_summary.json"),
        file_record(detail_gzip, "cross_type_pair_details.csv.gz"),
    ]
    write_json(audit_json, audit_payload)
    site_files = {
        "summary_json": (summary_json, cross_site_dir / "summary.json", "summary.json"),
        "summary_csv": (summary_csv, cross_site_dir / "summary.csv", "summary.csv"),
        "pair_details_gzip": (detail_gzip, cross_site_dir / "pair-details.csv.gz", "pair-details.csv.gz"),
        "audit_json": (audit_json, cross_site_dir / "audit.json", "audit.json"),
    }
    for source, destination, _ in site_files.values():
        shutil.copyfile(source, destination)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": built_at,
        "analysis_commit": analysis_commit,
        "topics": [{"id": topic, "label_en": TOPIC_LABELS[topic]} for topic in TOPICS],
        "metrics": [
            {
                "id": metric,
                "label": str(spec["label"]),
                "dependence_direction": "lower" if int(spec["direction"]) == -1 else "higher",
            }
            for metric, spec in METRICS.items()
        ],
        "samples": [
            {"id": sample, "label": SAMPLE_LABELS[sample], "primary": sample == "near_bi_both"}
            for sample in SAMPLES
        ],
        "thresholds": thresholds,
        "summary_json": "cross-type/summary.json",
        "summary_csv": "cross-type/summary.csv",
        "pair_details_gzip": "cross-type/pair-details.csv.gz",
        "audit_json": "cross-type/audit.json",
        "files": {key: file_record(destination, relative) for key, (_, destination, relative) in site_files.items()},
    }
    write_json(cross_site_dir / "manifest.json", manifest)
    return {"summary": summary_payload, "audit": audit_payload, "manifest": manifest}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-metrics", type=Path, required=True)
    parser.add_argument("--derived-dir", type=Path, required=True)
    parser.add_argument("--site-data-dir", type=Path, required=True)
    parser.add_argument("--built-at", required=True)
    parser.add_argument("--analysis-commit", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    run_analysis(
        pair_metrics=args.pair_metrics, derived_dir=args.derived_dir,
        site_data_dir=args.site_data_dir, built_at=args.built_at,
        analysis_commit=args.analysis_commit,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
