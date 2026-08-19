"""Build global ForecastBench pair-dependence and rank-stability baselines.

The global metrics are recomputed from target-level adjusted losses for two
predeclared scopes.  Topic metrics are read only for global-to-topic
comparisons; they are never averaged to create a global result.
"""

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
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from analysis.cross_type import (
    METRICS,
    SAMPLE_LABELS,
    SAMPLES,
    TOPIC_LABELS,
    TOPICS,
    average_ranks,
    dependence_percentiles,
    dependence_quartile,
    load_pair_archive,
    pearson,
    safe_ratio,
    spearman,
)
from analysis.metrics import (
    OUTPUT_FIELDS,
    Observation,
    PairAccumulator,
    brier_index,
    finalize_accumulated_pair_row,
    load_taxonomy,
    normalize_origin,
)
from analysis.export_site import stable_model_id


GLOBAL_SCOPES = ("official_full", "seven_topic_union")
COMPARISON_MODES = ("leave_topic_out", "inclusive_global")
COMPARISON_MODE_META = {
    "leave_topic_out": {
        "label": "Leave topic out", "primary": True,
        "description": "Global baseline recomputed after removing the compared topic's eligible targets.",
    },
    "inclusive_global": {
        "label": "Inclusive global", "primary": False,
        "description": "Sensitivity baseline that includes the compared topic's eligible targets.",
    },
}
GLOBAL_SCOPE_META = {
    "official_full": {
        "label": "Official full sample",
        "description": "All scored official ForecastBench targets.",
    },
    "seven_topic_union": {
        "label": "Seven-topic union",
        "description": "The union of targets eligible for the seven audited semantic topics.",
    },
}
SCHEMA_VERSION = "1.0.0"
DEFAULT_MIN_OVERLAP = 50
DEFAULT_NEAR_BI_GAP = 2.0
DEFAULT_HIGH_LOSS_THRESHOLD = 0.25
DEFAULT_MIN_PARTNERS = 20
REPORTING_MIN = 30
HEADLINE_MIN = 100
QUARTILE = 0.25

PAIR_FIELDS = ["global_scope", *OUTPUT_FIELDS]
PAIR_STABILITY_FIELDS = [
    "global_scope", "comparison_mode", "topic_id", "metric_id", "sample_id", "n_pair_universe",
    "n_sample_pairs", "n_defined_pairs", "spearman", "pearson",
    "dependent_top_jaccard", "complementary_top_jaccard",
    "dependency_persistence_global_to_topic", "dependency_persistence_topic_to_global",
    "complementarity_persistence_global_to_topic", "complementarity_persistence_topic_to_global",
    "dependency_to_complementarity_global_to_topic",
    "dependency_to_complementarity_topic_to_global", "quartile_transition_counts",
    "reason", "interpretation_status",
]
GLOBAL_PAIR_SUMMARY_FIELDS = [
    "global_scope", "metric_id", "sample_id", "n_pair_universe", "n_sample_pairs",
    "n_defined_pairs", "mean", "median", "q25", "q75", "min", "max", "reason",
    "interpretation_status",
]
PARTNER_FIELDS = [
    "global_scope", "comparison_mode", "topic_id", "metric_id", "sample_id", "focal_model_id",
    "focal_model_name", "organization", "n_partner_universe", "n_sample_partners",
    "n_defined_partners", "spearman", "pearson", "dependent_top_jaccard",
    "complementary_top_jaccard", "dependency_persistence_global_to_topic",
    "dependency_persistence_topic_to_global", "complementarity_persistence_global_to_topic",
    "complementarity_persistence_topic_to_global",
    "dependency_to_complementarity_global_to_topic",
    "dependency_to_complementarity_topic_to_global", "global_top_dependent_partner_id",
    "global_top_dependent_partner_name", "topic_top_dependent_partner_id",
    "topic_top_dependent_partner_name", "global_top_dependent_partner_retained",
    "global_top_dependent_partner_topic_percentile", "global_top_complementary_partner_id",
    "global_top_complementary_partner_name", "topic_top_complementary_partner_id",
    "topic_top_complementary_partner_name", "global_top_complementary_partner_retained",
    "global_top_complementary_partner_topic_percentile", "reason", "interpretation_status",
]
PARTNER_UI_FIELDS = [
    "global_scope", "comparison_mode", "topic_id", "metric_id", "sample_id",
    "focal_model_id", "focal_model_name", "n_defined_partners", "spearman", "pearson",
    "global_top_complementary_partner_name", "global_top_complementary_partner_retained",
    "global_top_complementary_partner_topic_percentile", "reason", "interpretation_status",
]
PARTNER_SUMMARY_FIELDS = [
    "global_scope", "comparison_mode", "topic_id", "metric_id", "sample_id", "n_focal_model_universe",
    "n_reportable_focal_models", "n_limited_focal_models", "n_headline_focal_models",
    "median_spearman", "q25_spearman", "q75_spearman", "min_spearman",
    "max_spearman", "fraction_negative_spearman", "median_defined_partners",
    "mean_dependent_top_jaccard", "mean_complementary_top_jaccard", "reason",
    "interpretation_status",
]
ABILITY_FIELDS = [
    "scope_dimension", "scope_id", "model_id", "model_name", "organization",
    "n_targets", "n_dates", "date_min", "date_max", "n_dataset_targets",
    "n_market_targets", "adjusted_brier", "brier_index", "min_targets_required",
    "eligible", "reason",
]
ABILITY_STABILITY_FIELDS = [
    "global_scope", "comparison_mode", "topic_id", "n_model_universe", "n_sample_models",
    "n_defined_models", "spearman", "pearson", "top_quartile_jaccard",
    "global_top_quartile_retained", "topic_top_quartile_retained", "reason",
    "interpretation_status",
]


@dataclass
class AbilityAccumulator:
    n_targets: int = 0
    origin_sum: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    origin_count: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    dates: set[str] = field(default_factory=set)
    date_min: str = ""
    date_max: str = ""

    def update(self, observation: Observation) -> None:
        self.n_targets += 1
        self.origin_sum[observation.origin_type] += observation.adjusted_brier
        self.origin_count[observation.origin_type] += 1
        self.dates.add(observation.date)
        self.date_min = min(self.date_min, observation.date) if self.date_min else observation.date
        self.date_max = max(self.date_max, observation.date) if self.date_max else observation.date


def is_excluded_llm_crowd(model_name: str) -> bool:
    return model_name.strip().casefold().startswith("llm crowd")


def model_id(model_name: str) -> str:
    return stable_model_id(model_name)


def pair_key(model_a: str, model_b: str) -> tuple[str, str]:
    return (model_a, model_b) if model_a < model_b else (model_b, model_a)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_record(path: Path, relative_path: str) -> dict[str, Any]:
    return {"path": relative_path, "sha256": sha256_file(path), "size_bytes": path.stat().st_size}


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _csv_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return value


def write_csv(path: Path, rows: Iterable[Mapping[str, Any]], fields: Sequence[str]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: _csv_value(row.get(field)) for field in fields})
            count += 1
    return count


def write_gzip_csv(path: Path, rows: Iterable[Mapping[str, Any]], fields: Sequence[str]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
                writer.writeheader()
                for row in rows:
                    writer.writerow({field: _csv_value(row.get(field)) for field in fields})
                    count += 1
    return count


def write_partner_profile_shards(
    directory: Path, rows: Sequence[Mapping[str, Any]], models: Sequence[str]
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.json"):
        stale.unlink()
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["focal_model_id"])].append(row)
    paths: dict[str, str] = {}
    records: list[dict[str, Any]] = []
    for model in models:
        identifier = model_id(model)
        path = directory / f"{identifier}.json"
        profiles = [
            {field: row.get(field) for field in PARTNER_UI_FIELDS}
            for row in grouped.get(identifier, [])
        ]
        write_json(
            path,
            {"schema_version": SCHEMA_VERSION, "focal_model_id": identifier, "profiles": profiles},
        )
        paths[identifier] = path.name
        records.append({"model_id": identifier, **file_record(path, path.name), "n_profiles": len(profiles)})
    return paths, records


def quantile(values: Sequence[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def mean_or_none(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def status_for(n: int, minimum: int = REPORTING_MIN) -> str:
    if n < minimum:
        return "insufficient"
    if n >= HEADLINE_MIN:
        return "headline"
    return "limited"


def bool_value(value: Any) -> bool | None:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip().casefold()
    if text in {"1", "true", "yes"}:
        return True
    if text in {"0", "false", "no"}:
        return False
    raise ValueError(f"invalid boolean value: {value!r}")


def row_in_sample(row: Mapping[str, Any] | None, sample_id: str) -> bool:
    if row is None or bool_value(row.get("eligible")) is not True:
        return False
    if sample_id == "eligible_both":
        return True
    if sample_id == "near_bi_both":
        return bool_value(row.get("near_bi")) is True
    raise ValueError(f"unknown sample {sample_id!r}")


def pair_in_sample(
    global_row: Mapping[str, Any] | None,
    topic_row: Mapping[str, Any] | None,
    sample_id: str,
) -> bool:
    return row_in_sample(global_row, sample_id) and row_in_sample(topic_row, sample_id)


def metric_value(row: Mapping[str, Any] | None, metric_id: str) -> float | None:
    if row is None:
        return None
    raw = row.get(str(METRICS[metric_id]["column"]))
    if raw is None or str(raw).strip() == "":
        return None
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError(f"non-finite {metric_id}: {raw!r}")
    return value


def _quartile_sets(
    keys: Sequence[Any], values: Sequence[float], direction: int
) -> tuple[dict[Any, float], set[Any], set[Any], dict[Any, int]]:
    percentiles = dependence_percentiles(values, direction)
    by_key = dict(zip(keys, percentiles))
    quartiles = {key: dependence_quartile(percentile) for key, percentile in by_key.items()}
    dependent = {key for key, quartile in quartiles.items() if quartile == 4}
    complementary = {key for key, quartile in quartiles.items() if quartile == 1}
    return by_key, dependent, complementary, quartiles


def comparison_statistics(
    keys: Sequence[Any],
    values_global: Sequence[float],
    values_topic: Sequence[float],
    direction: int,
    reporting_min: int,
) -> dict[str, Any]:
    if not (len(keys) == len(values_global) == len(values_topic)):
        raise ValueError("comparison vectors must align")
    n = len(keys)
    pct_global, dep_global, comp_global, q_global = _quartile_sets(keys, values_global, direction)
    pct_topic, dep_topic, comp_topic, q_topic = _quartile_sets(keys, values_topic, direction)
    transitions = {f"Q{a}->Q{b}": 0 for a in range(1, 5) for b in range(1, 5)}
    for key in keys:
        transitions[f"Q{q_global[key]}->Q{q_topic[key]}"] += 1
    if n < reporting_min:
        return {
            "spearman": None, "pearson": None, "dependent_top_jaccard": None,
            "complementary_top_jaccard": None,
            "dependency_persistence_global_to_topic": None,
            "dependency_persistence_topic_to_global": None,
            "complementarity_persistence_global_to_topic": None,
            "complementarity_persistence_topic_to_global": None,
            "dependency_to_complementarity_global_to_topic": None,
            "dependency_to_complementarity_topic_to_global": None,
            "quartile_transition_counts": transitions,
            "reason": f"defined_count_{n}_below_reporting_min_{reporting_min}",
            "interpretation_status": "insufficient",
            "percentiles_global": pct_global, "percentiles_topic": pct_topic,
        }
    rho, rho_reason = spearman(values_global, values_topic)
    linear, linear_reason = pearson(values_global, values_topic)
    dep_intersection = dep_global & dep_topic
    comp_intersection = comp_global & comp_topic
    reasons = sorted(set(filter(None, (rho_reason, linear_reason))))
    estimable = rho is not None
    return {
        "spearman": rho, "pearson": linear,
        "dependent_top_jaccard": safe_ratio(len(dep_intersection), len(dep_global | dep_topic)),
        "complementary_top_jaccard": safe_ratio(len(comp_intersection), len(comp_global | comp_topic)),
        "dependency_persistence_global_to_topic": safe_ratio(len(dep_intersection), len(dep_global)),
        "dependency_persistence_topic_to_global": safe_ratio(len(dep_intersection), len(dep_topic)),
        "complementarity_persistence_global_to_topic": safe_ratio(len(comp_intersection), len(comp_global)),
        "complementarity_persistence_topic_to_global": safe_ratio(len(comp_intersection), len(comp_topic)),
        "dependency_to_complementarity_global_to_topic": safe_ratio(len(dep_global & comp_topic), len(dep_global)),
        "dependency_to_complementarity_topic_to_global": safe_ratio(len(dep_topic & comp_global), len(dep_topic)),
        "quartile_transition_counts": transitions, "reason": ";".join(reasons) or None,
        "interpretation_status": status_for(n, reporting_min) if estimable else "insufficient",
        "percentiles_global": pct_global, "percentiles_topic": pct_topic,
    }


def _flush_date(
    date: str,
    current: Mapping[str, Mapping[str, Mapping[tuple[str, str, str, str], Observation]]],
    accumulators: dict[tuple[str, str, str], PairAccumulator],
    high_loss_threshold: float,
) -> None:
    for slice_id in sorted(current):
        models = current[slice_id]
        for model_a, model_b in itertools.combinations(sorted(models), 2):
            rows_a, rows_b = models[model_a], models[model_b]
            common = sorted(set(rows_a) & set(rows_b))
            if not common:
                continue
            accumulator = accumulators.setdefault((slice_id, model_a, model_b), PairAccumulator())
            accumulator.update(
                date, [rows_a[key] for key in common], [rows_b[key] for key in common],
                high_loss_threshold,
            )


def stream_global_inputs(
    scored_panel: Path,
    taxonomy_path: Path,
    high_loss_threshold: float,
) -> tuple[
    dict[tuple[str, str, str], PairAccumulator], dict[tuple[str, str], int],
    dict[tuple[str, str, str], AbilityAccumulator], dict[str, str], tuple[str, ...],
    dict[str, Any],
]:
    taxonomy, taxonomy_rows, taxonomy_audit = load_taxonomy(taxonomy_path)
    accumulators: dict[tuple[str, str, str], PairAccumulator] = {}
    target_counts: Counter[tuple[str, str]] = Counter()
    ability: dict[tuple[str, str, str], AbilityAccumulator] = {}
    organizations: dict[str, str] = {}
    active_models: set[str] = set()
    excluded_rows: Counter[str] = Counter()
    excluded_files: dict[str, set[str]] = defaultdict(set)
    counters: Counter[str] = Counter()
    current_date = ""
    current: dict[str, dict[str, dict[tuple[str, str, str, str], Observation]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    required = {
        "date", "source", "event_id", "horizon", "origin_type", "model_name",
        "model_organization", "source_file", "adjusted_brier",
    }
    with scored_panel.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"scored panel missing columns: {sorted(missing)}")
        for row_number, raw in enumerate(reader, start=2):
            counters["scored_input_rows"] += 1
            date = raw["date"].strip()[:10]
            if current_date and date < current_date:
                raise ValueError("scored panel must be sorted by date")
            if current_date and date != current_date:
                _flush_date(current_date, current, accumulators, high_loss_threshold)
                current = defaultdict(lambda: defaultdict(dict))
            current_date = date
            source = raw["source"].strip().lower()
            event_id = raw["event_id"].strip()
            taxon = taxonomy.get((date, source, event_id))
            if taxon is None:
                raise ValueError(f"scored row {row_number} has no taxonomy match")
            if normalize_origin(raw["origin_type"]) != taxon.origin_type:
                raise ValueError(f"origin mismatch at scored row {row_number}")
            model = raw["model_name"].strip()
            organization = raw["model_organization"].strip()
            known_org = organizations.setdefault(model, organization)
            if known_org and organization and known_org != organization:
                raise ValueError(f"conflicting organization for {model!r}")
            if is_excluded_llm_crowd(model):
                excluded_rows[model] += 1
                excluded_files[model].add(raw["source_file"].strip())
                counters["excluded_llm_crowd_rows"] += 1
                continue
            active_models.add(model)
            try:
                loss = float(raw["adjusted_brier"])
            except ValueError as exc:
                raise ValueError(f"invalid adjusted_brier at row {row_number}") from exc
            if not math.isfinite(loss):
                raise ValueError(f"non-finite adjusted_brier at row {row_number}")
            observation = Observation(
                date=date, source=source, event_id=event_id, horizon=raw["horizon"].strip(),
                origin_type=taxon.origin_type, adjusted_brier=loss,
            )
            slices = [("global_scope", "official_full")]
            if taxon.topic_analysis_eligible and taxon.topic_id in TOPICS:
                slices.extend((("global_scope", "seven_topic_union"), ("topic", taxon.topic_id)))
            for dimension, scope_id in slices:
                stats = ability.setdefault((dimension, scope_id, model), AbilityAccumulator())
                if dimension in {"global_scope", "topic"}:
                    rows = current[scope_id][model]
                    prior = rows.get(observation.target_key)
                    if prior is not None:
                        if prior != observation:
                            raise ValueError("conflicting duplicate target observation")
                        counters["collapsed_identical_duplicates"] += 1
                        continue
                    rows[observation.target_key] = observation
                    target_counts[(scope_id, model)] += 1
                stats.update(observation)
                counters[f"joined_rows:{dimension}:{scope_id}"] += 1
    if current_date:
        _flush_date(current_date, current, accumulators, high_loss_threshold)
    models = tuple(sorted(active_models))
    excluded = [
        {
            "model_name": model, "scored_rows": excluded_rows[model],
            "source_file_count": len(excluded_files[model]),
            "source_files": sorted(excluded_files[model]),
        }
        for model in sorted(excluded_rows)
    ]
    audit = {
        "taxonomy_rows": taxonomy_rows, "taxonomy_audit": dict(taxonomy_audit),
        "counters": dict(counters), "excluded_llm_crowd": excluded,
    }
    return accumulators, dict(target_counts), ability, organizations, models, audit


def scan_excluded_reference(path: Path) -> list[dict[str, Any]]:
    rows: Counter[str] = Counter()
    files: dict[str, set[str]] = defaultdict(set)
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"model_name", "source_file"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"exclusion reference panel missing columns: {sorted(missing)}")
        for raw in reader:
            model = raw["model_name"].strip()
            if is_excluded_llm_crowd(model):
                rows[model] += 1
                files[model].add(raw["source_file"].strip())
    return [
        {
            "model_name": model, "scored_rows": rows[model],
            "source_file_count": len(files[model]), "source_files": sorted(files[model]),
            "evidence": "excluded_reference_panel",
        }
        for model in sorted(rows)
    ]


def subtract_pair_accumulator(
    total: PairAccumulator | None, removed: PairAccumulator | None
) -> PairAccumulator | None:
    """Return exact sufficient statistics for ``total - removed`` support."""

    if total is None:
        return None
    if removed is None or removed.n_overlap == 0:
        return total
    n_total, n_removed = total.n_overlap, removed.n_overlap
    n_keep = n_total - n_removed
    if n_keep < 0:
        raise ValueError("removed pair support exceeds total support")
    if n_keep == 0:
        return None
    result = PairAccumulator()
    result.n_overlap = n_keep
    result.sum_a = total.sum_a - removed.sum_a
    result.sum_b = total.sum_b - removed.sum_b
    result.sum_min = total.sum_min - removed.sum_min
    result.high_a = total.high_a - removed.high_a
    result.high_b = total.high_b - removed.high_b
    result.high_both = total.high_both - removed.high_both
    result.running_mean_a = result.sum_a / n_keep
    result.running_mean_b = result.sum_b / n_keep
    weight = n_keep * n_removed / n_total
    delta_a = removed.running_mean_a - result.running_mean_a
    delta_b = removed.running_mean_b - result.running_mean_b
    result.running_m2_a = total.running_m2_a - removed.running_m2_a - delta_a * delta_a * weight
    result.running_m2_b = total.running_m2_b - removed.running_m2_b - delta_b * delta_b * weight
    result.running_covariance = (
        total.running_covariance - removed.running_covariance - delta_a * delta_b * weight
    )
    tolerance = 1e-12
    if -tolerance < result.running_m2_a < 0:
        result.running_m2_a = 0.0
    if -tolerance < result.running_m2_b < 0:
        result.running_m2_b = 0.0
    assert total.origin_sum_a is not None and removed.origin_sum_a is not None
    assert total.origin_sum_b is not None and removed.origin_sum_b is not None
    assert total.origin_count is not None and removed.origin_count is not None
    assert result.origin_sum_a is not None and result.origin_sum_b is not None
    assert result.origin_count is not None
    for origin in ("Dataset", "Market"):
        result.origin_sum_a[origin] = total.origin_sum_a[origin] - removed.origin_sum_a[origin]
        result.origin_sum_b[origin] = total.origin_sum_b[origin] - removed.origin_sum_b[origin]
        result.origin_count[origin] = total.origin_count[origin] - removed.origin_count[origin]
    # Calendar/source fields are not used by the LOO comparisons, but retain a
    # conservative support description for audit diagnostics.
    result.n_dates = total.n_dates
    result.date_min = total.date_min
    result.date_max = total.date_max
    result.sources = set(total.sources or ())
    result.origins = {origin for origin in ("Dataset", "Market") if result.origin_count[origin]}
    return result


def subtract_ability_accumulator(
    total: AbilityAccumulator | None, removed: AbilityAccumulator | None
) -> AbilityAccumulator | None:
    if total is None:
        return None
    if removed is None or removed.n_targets == 0:
        return total
    n_keep = total.n_targets - removed.n_targets
    if n_keep < 0:
        raise ValueError("removed model support exceeds total support")
    if n_keep == 0:
        return None
    result = AbilityAccumulator(n_targets=n_keep)
    for origin in ("Dataset", "Market"):
        result.origin_sum[origin] = total.origin_sum[origin] - removed.origin_sum[origin]
        result.origin_count[origin] = total.origin_count[origin] - removed.origin_count[origin]
    result.dates = set(total.dates)
    result.date_min = total.date_min
    result.date_max = total.date_max
    return result


def finalize_leave_topic_out_pairs(
    *, scope: str, topic: str,
    accumulators: Mapping[tuple[str, str, str], PairAccumulator],
    target_counts: Mapping[tuple[str, str], int], organizations: Mapping[str, str],
    models: Sequence[str], min_overlap: int, near_bi_gap: float,
) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, Any]]:
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    digest = hashlib.sha256()
    eligible = near_bi = 0
    defined = Counter()
    for model_a, model_b in itertools.combinations(models, 2):
        pair = (model_a, model_b)
        accumulator = subtract_pair_accumulator(
            accumulators.get((scope, model_a, model_b)),
            accumulators.get((topic, model_a, model_b)),
        )
        row = finalize_accumulated_pair_row(
            slice_dimension="global_leave_topic_out", slice_id=f"{scope}__without__{topic}",
            model_a=model_a, model_b=model_b,
            n_model_a_targets=max(0, target_counts.get((scope, model_a), 0) - target_counts.get((topic, model_a), 0)),
            n_model_b_targets=max(0, target_counts.get((scope, model_b), 0) - target_counts.get((topic, model_b), 0)),
            accumulator=accumulator, organization_a=organizations.get(model_a, ""),
            organization_b=organizations.get(model_b, ""), min_overlap=min_overlap,
            near_bi_gap=near_bi_gap,
        )
        row = {"global_scope": scope, **row}
        rows[pair] = row
        eligible += int(bool_value(row["eligible"]) is True)
        near_bi += int(bool_value(row["near_bi"]) is True)
        for metric_id in METRICS:
            defined[metric_id] += int(metric_value(row, metric_id) is not None)
        canonical = {field: row.get(field) for field in PAIR_FIELDS}
        digest.update(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\n")
    return rows, {
        "global_scope": scope, "topic_id": topic, "n_pairs": len(rows),
        "n_eligible_pairs": eligible, "n_near_bi_pairs": near_bi,
        "n_defined_by_metric": dict(defined), "sha256": digest.hexdigest(),
    }


def finalize_global_pairs(
    accumulators: Mapping[tuple[str, str, str], PairAccumulator],
    target_counts: Mapping[tuple[str, str], int], organizations: Mapping[str, str],
    models: Sequence[str], min_overlap: int, near_bi_gap: float,
) -> tuple[list[dict[str, Any]], dict[str, dict[tuple[str, str], dict[str, Any]]]]:
    rows: list[dict[str, Any]] = []
    by_scope = {scope: {} for scope in GLOBAL_SCOPES}
    for scope in GLOBAL_SCOPES:
        for model_a, model_b in itertools.combinations(models, 2):
            row = finalize_accumulated_pair_row(
                slice_dimension="global", slice_id=scope, model_a=model_a, model_b=model_b,
                n_model_a_targets=target_counts.get((scope, model_a), 0),
                n_model_b_targets=target_counts.get((scope, model_b), 0),
                accumulator=accumulators.get((scope, model_a, model_b)),
                organization_a=organizations.get(model_a, ""),
                organization_b=organizations.get(model_b, ""), min_overlap=min_overlap,
                near_bi_gap=near_bi_gap,
            )
            row = {"global_scope": scope, **row}
            rows.append(row)
            by_scope[scope][(model_a, model_b)] = row
    return rows, by_scope


def build_global_pair_summary(
    global_rows: Mapping[str, Mapping[tuple[str, str], Mapping[str, Any]]],
    all_pairs: Sequence[tuple[str, str]],
) -> list[dict[str, Any]]:
    output = []
    for scope in GLOBAL_SCOPES:
        for sample_id in SAMPLES:
            for metric_id in METRICS:
                sample = [pair for pair in all_pairs if row_in_sample(global_rows[scope].get(pair), sample_id)]
                values = [
                    value for pair in sample
                    if (value := metric_value(global_rows[scope].get(pair), metric_id)) is not None
                ]
                n = len(values)
                output.append({
                    "global_scope": scope, "metric_id": metric_id, "sample_id": sample_id,
                    "n_pair_universe": len(all_pairs), "n_sample_pairs": len(sample),
                    "n_defined_pairs": n, "mean": mean_or_none(values),
                    "median": quantile(values, .5), "q25": quantile(values, .25),
                    "q75": quantile(values, .75), "min": min(values) if values else None,
                    "max": max(values) if values else None,
                    "reason": None if n else "no_defined_pairs",
                    "interpretation_status": status_for(n),
                })
    return output


def build_pair_stability(
    global_rows: Mapping[str, Mapping[tuple[str, str], Mapping[str, Any]]],
    topic_rows: Mapping[str, Mapping[tuple[str, str], Mapping[str, Any]]],
    all_pairs: Sequence[tuple[str, str]], comparison_mode: str,
    topics: Sequence[str] = TOPICS,
) -> list[dict[str, Any]]:
    output = []
    for scope in GLOBAL_SCOPES:
        for topic in topics:
            for sample_id in SAMPLES:
                for metric_id, spec in METRICS.items():
                    sample_pairs, defined, values_global, values_topic = [], [], [], []
                    for pair in all_pairs:
                        global_row, topic_row = global_rows[scope].get(pair), topic_rows[topic].get(pair)
                        if not pair_in_sample(global_row, topic_row, sample_id):
                            continue
                        sample_pairs.append(pair)
                        global_value, topic_value = metric_value(global_row, metric_id), metric_value(topic_row, metric_id)
                        if global_value is not None and topic_value is not None:
                            defined.append(pair)
                            values_global.append(global_value)
                            values_topic.append(topic_value)
                    stats = comparison_statistics(
                        defined, values_global, values_topic, int(spec["direction"]), REPORTING_MIN
                    )
                    stats.pop("percentiles_global")
                    stats.pop("percentiles_topic")
                    output.append({
                        "global_scope": scope, "comparison_mode": comparison_mode,
                        "topic_id": topic, "metric_id": metric_id,
                        "sample_id": sample_id, "n_pair_universe": len(all_pairs),
                        "n_sample_pairs": len(sample_pairs), "n_defined_pairs": len(defined), **stats,
                    })
    return output


def _top_key(keys: Sequence[str], percentiles: Mapping[str, float], highest: bool) -> str | None:
    if not keys:
        return None
    target = max(percentiles[key] for key in keys) if highest else min(percentiles[key] for key in keys)
    return min(key for key in keys if percentiles[key] == target)


def build_partner_profiles(
    global_rows: Mapping[str, Mapping[tuple[str, str], Mapping[str, Any]]],
    topic_rows: Mapping[str, Mapping[tuple[str, str], Mapping[str, Any]]],
    models: Sequence[str], organizations: Mapping[str, str], min_partners: int,
    comparison_mode: str, topics: Sequence[str] = TOPICS,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for scope in GLOBAL_SCOPES:
        for topic in topics:
            for sample_id in SAMPLES:
                for metric_id, spec in METRICS.items():
                    for focal in models:
                        sample_partners, partners, values_global, values_topic = [], [], [], []
                        for partner in models:
                            if partner == focal:
                                continue
                            pair = pair_key(focal, partner)
                            global_row, topic_row = global_rows[scope].get(pair), topic_rows[topic].get(pair)
                            if not pair_in_sample(global_row, topic_row, sample_id):
                                continue
                            sample_partners.append(partner)
                            global_value, topic_value = metric_value(global_row, metric_id), metric_value(topic_row, metric_id)
                            if global_value is not None and topic_value is not None:
                                partners.append(partner)
                                values_global.append(global_value)
                                values_topic.append(topic_value)
                        stats = comparison_statistics(
                            partners, values_global, values_topic, int(spec["direction"]), min_partners
                        )
                        pct_global = stats.pop("percentiles_global")
                        pct_topic = stats.pop("percentiles_topic")
                        stats.pop("quartile_transition_counts")
                        top_dep_global = _top_key(partners, pct_global, True)
                        top_dep_topic = _top_key(partners, pct_topic, True)
                        top_comp_global = _top_key(partners, pct_global, False)
                        top_comp_topic = _top_key(partners, pct_topic, False)
                        def partner_fields(prefix: str, partner: str | None) -> dict[str, Any]:
                            return {
                                f"{prefix}_id": model_id(partner) if partner else None,
                                f"{prefix}_name": partner,
                            }
                        output.append({
                            "global_scope": scope, "comparison_mode": comparison_mode,
                            "topic_id": topic, "metric_id": metric_id,
                            "sample_id": sample_id, "focal_model_id": model_id(focal),
                            "focal_model_name": focal, "organization": organizations.get(focal, ""),
                            "n_partner_universe": len(models) - 1,
                            "n_sample_partners": len(sample_partners), "n_defined_partners": len(partners),
                            **{key: value for key, value in stats.items() if key in PARTNER_FIELDS},
                            **partner_fields("global_top_dependent_partner", top_dep_global),
                            **partner_fields("topic_top_dependent_partner", top_dep_topic),
                            "global_top_dependent_partner_retained": (
                                None if not top_dep_global or not top_dep_topic else int(top_dep_global == top_dep_topic)
                            ),
                            "global_top_dependent_partner_topic_percentile": (
                                pct_topic.get(top_dep_global) if top_dep_global else None
                            ),
                            **partner_fields("global_top_complementary_partner", top_comp_global),
                            **partner_fields("topic_top_complementary_partner", top_comp_topic),
                            "global_top_complementary_partner_retained": (
                                None if not top_comp_global or not top_comp_topic else int(top_comp_global == top_comp_topic)
                            ),
                            "global_top_complementary_partner_topic_percentile": (
                                pct_topic.get(top_comp_global) if top_comp_global else None
                            ),
                        })
    return output


def build_partner_summary(rows: Sequence[Mapping[str, Any]], n_models: int) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["global_scope"], row["comparison_mode"], row["topic_id"], row["metric_id"], row["sample_id"])].append(row)
    output = []
    for scope in GLOBAL_SCOPES:
        for comparison_mode in COMPARISON_MODES:
            for topic in TOPICS:
                for sample_id in SAMPLES:
                    for metric_id in METRICS:
                        cell = grouped[(scope, comparison_mode, topic, metric_id, sample_id)]
                        reportable = [row for row in cell if row.get("spearman") is not None]
                        rhos = [float(row["spearman"]) for row in reportable]
                        defined = [float(row["n_defined_partners"]) for row in reportable]
                        dep_j = [float(row["dependent_top_jaccard"]) for row in reportable if row.get("dependent_top_jaccard") is not None]
                        comp_j = [float(row["complementary_top_jaccard"]) for row in reportable if row.get("complementary_top_jaccard") is not None]
                        n = len(reportable)
                        publish = n >= REPORTING_MIN
                        output.append({
                            "global_scope": scope, "comparison_mode": comparison_mode,
                            "topic_id": topic, "metric_id": metric_id,
                            "sample_id": sample_id, "n_focal_model_universe": n_models,
                            "n_reportable_focal_models": n,
                            "n_limited_focal_models": sum(row["interpretation_status"] == "limited" for row in cell),
                            "n_headline_focal_models": sum(row["interpretation_status"] == "headline" for row in cell),
                            "median_spearman": quantile(rhos, .5) if publish else None,
                            "q25_spearman": quantile(rhos, .25) if publish else None,
                            "q75_spearman": quantile(rhos, .75) if publish else None,
                            "min_spearman": min(rhos) if publish else None,
                            "max_spearman": max(rhos) if publish else None,
                            "fraction_negative_spearman": (
                                safe_ratio(sum(value < 0 for value in rhos), n) if publish else None
                            ),
                            "median_defined_partners": quantile(defined, .5) if publish else None,
                            "mean_dependent_top_jaccard": mean_or_none(dep_j) if publish else None,
                            "mean_complementary_top_jaccard": mean_or_none(comp_j) if publish else None,
                            "reason": (
                                None if publish else
                                f"reportable_focal_model_count_{n}_below_reporting_min_{REPORTING_MIN}"
                            ),
                            "interpretation_status": status_for(n),
                        })
    return output


def ability_row_from_stats(
    dimension: str, scope_id: str, model: str, stats: AbilityAccumulator | None,
    organization: str, min_targets: int,
) -> dict[str, Any]:
    n = stats.n_targets if stats else 0
    if not stats:
        adjusted, bi, reason = None, None, "model_missing_in_scope"
    elif n < min_targets:
        adjusted, bi, reason = None, None, f"n_targets_{n}_below_min_{min_targets}"
    else:
        origin_means = [
            stats.origin_sum[origin] / stats.origin_count[origin]
            for origin in ("Dataset", "Market") if stats.origin_count[origin]
        ]
        adjusted = sum(origin_means) / len(origin_means)
        bi, reason = brier_index(adjusted)
    return {
                "scope_dimension": dimension, "scope_id": scope_id, "model_id": model_id(model),
                "model_name": model, "organization": organization, "n_targets": n,
                "n_dates": len(stats.dates) if stats else 0, "date_min": stats.date_min if stats else "",
                "date_max": stats.date_max if stats else "",
                "n_dataset_targets": stats.origin_count["Dataset"] if stats else 0,
                "n_market_targets": stats.origin_count["Market"] if stats else 0,
                "adjusted_brier": adjusted, "brier_index": bi,
                "min_targets_required": min_targets, "eligible": int(bi is not None),
                "reason": reason or None,
            }


def build_ability_rows(
    ability: Mapping[tuple[str, str, str], AbilityAccumulator], models: Sequence[str],
    organizations: Mapping[str, str], min_targets: int,
) -> tuple[list[dict[str, Any]], dict[tuple[str, str], dict[str, dict[str, Any]]]]:
    output = []
    index: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    scopes = [("global_scope", scope) for scope in GLOBAL_SCOPES] + [("topic", topic) for topic in TOPICS]
    for dimension, scope_id in scopes:
        index[(dimension, scope_id)] = {}
        for model in models:
            row = ability_row_from_stats(
                dimension, scope_id, model, ability.get((dimension, scope_id, model)),
                organizations.get(model, ""), min_targets,
            )
            output.append(row)
            index[(dimension, scope_id)][model] = row
    return output, index


def build_ability_stability(
    global_index: Mapping[str, Mapping[str, Mapping[str, Any]]],
    topic_index: Mapping[str, Mapping[str, Mapping[str, Any]]],
    models: Sequence[str], comparison_mode: str, topics: Sequence[str] = TOPICS,
) -> list[dict[str, Any]]:
    output = []
    for scope in GLOBAL_SCOPES:
        for topic in topics:
            keys, global_values, topic_values = [], [], []
            for model in models:
                global_row = global_index[scope][model]
                topic_row = topic_index[topic][model]
                if not global_row["eligible"] or not topic_row["eligible"]:
                    continue
                keys.append(model)
                global_values.append(float(global_row["brier_index"]))
                topic_values.append(float(topic_row["brier_index"]))
            stats = comparison_statistics(keys, global_values, topic_values, 1, REPORTING_MIN)
            stats.pop("percentiles_global")
            stats.pop("percentiles_topic")
            output.append({
                "global_scope": scope, "comparison_mode": comparison_mode,
                "topic_id": topic, "n_model_universe": len(models),
                "n_sample_models": len(keys), "n_defined_models": len(keys),
                "spearman": stats["spearman"], "pearson": stats["pearson"],
                "top_quartile_jaccard": stats["dependent_top_jaccard"],
                "global_top_quartile_retained": stats["dependency_persistence_global_to_topic"],
                "topic_top_quartile_retained": stats["dependency_persistence_topic_to_global"],
                "reason": stats["reason"], "interpretation_status": stats["interpretation_status"],
            })
    return output


def build_leave_topic_out_ability_index(
    *, topic: str, ability: Mapping[tuple[str, str, str], AbilityAccumulator],
    models: Sequence[str], organizations: Mapping[str, str], min_targets: int,
) -> dict[str, dict[str, dict[str, Any]]]:
    output: dict[str, dict[str, dict[str, Any]]] = {scope: {} for scope in GLOBAL_SCOPES}
    for scope in GLOBAL_SCOPES:
        for model in models:
            stats = subtract_ability_accumulator(
                ability.get(("global_scope", scope, model)), ability.get(("topic", topic, model))
            )
            output[scope][model] = ability_row_from_stats(
                "global_leave_topic_out", f"{scope}__without__{topic}", model, stats,
                organizations.get(model, ""), min_targets,
            )
    return output


def run_analysis(
    *, scored_panel: Path, taxonomy: Path, pair_metrics: Path, derived_dir: Path,
    site_data_dir: Path, built_at: str, analysis_commit: str,
    min_overlap: int = DEFAULT_MIN_OVERLAP, near_bi_gap: float = DEFAULT_NEAR_BI_GAP,
    high_loss_threshold: float = DEFAULT_HIGH_LOSS_THRESHOLD,
    min_partners: int = DEFAULT_MIN_PARTNERS,
    exclusion_reference_panel: Path | None = None,
) -> dict[str, Any]:
    accumulators, target_counts, ability, organizations, models, stream_audit = stream_global_inputs(
        scored_panel, taxonomy, high_loss_threshold
    )
    if exclusion_reference_panel is not None:
        reference_exclusions = scan_excluded_reference(exclusion_reference_panel)
        if reference_exclusions:
            stream_audit["excluded_llm_crowd"] = reference_exclusions
            stream_audit["excluded_reference_panel"] = file_record(
                exclusion_reference_panel, exclusion_reference_panel.name
            )
    if len(models) < 2:
        raise ValueError("fewer than two active exact models")
    all_pairs = tuple(itertools.combinations(models, 2))
    global_pair_rows, global_rows = finalize_global_pairs(
        accumulators, target_counts, organizations, models, min_overlap, near_bi_gap
    )
    loaded_topic_rows, source_pairs, topic_organizations, topic_input_audit = load_pair_archive(pair_metrics)
    if tuple(source_pairs) != all_pairs:
        raise ValueError(
            "clean pair archive universe does not exactly match the active scored-panel universe"
        )
    active_pairs = set(all_pairs)
    topic_rows = {
        topic: {pair: row for pair, row in loaded_topic_rows[topic].items() if pair in active_pairs}
        for topic in TOPICS
    }
    organizations = {**topic_organizations, **organizations}
    global_summary = build_global_pair_summary(global_rows, all_pairs)
    ability_rows, ability_index = build_ability_rows(ability, models, organizations, min_overlap)
    topic_ability_index = {topic: ability_index[("topic", topic)] for topic in TOPICS}
    inclusive_ability_index = {
        scope: ability_index[("global_scope", scope)] for scope in GLOBAL_SCOPES
    }
    pair_stability: list[dict[str, Any]] = []
    partner_profiles: list[dict[str, Any]] = []
    ability_stability: list[dict[str, Any]] = []
    loo_audit: list[dict[str, Any]] = []
    # Primary LOO comparisons come first in every deterministic artifact.
    for topic in TOPICS:
        loo_global_rows: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
        for scope in GLOBAL_SCOPES:
            loo_global_rows[scope], support_audit = finalize_leave_topic_out_pairs(
                scope=scope, topic=topic, accumulators=accumulators,
                target_counts=target_counts, organizations=organizations, models=models,
                min_overlap=min_overlap, near_bi_gap=near_bi_gap,
            )
            loo_audit.append(support_audit)
        pair_stability.extend(build_pair_stability(
            loo_global_rows, topic_rows, all_pairs, "leave_topic_out", (topic,)
        ))
        partner_profiles.extend(build_partner_profiles(
            loo_global_rows, topic_rows, models, organizations, min_partners,
            "leave_topic_out", (topic,)
        ))
        loo_ability_index = build_leave_topic_out_ability_index(
            topic=topic, ability=ability, models=models, organizations=organizations,
            min_targets=min_overlap,
        )
        ability_stability.extend(build_ability_stability(
            loo_ability_index, topic_ability_index, models, "leave_topic_out", (topic,)
        ))
    pair_stability.extend(build_pair_stability(
        global_rows, topic_rows, all_pairs, "inclusive_global"
    ))
    partner_profiles.extend(build_partner_profiles(
        global_rows, topic_rows, models, organizations, min_partners, "inclusive_global"
    ))
    ability_stability.extend(build_ability_stability(
        inclusive_ability_index, topic_ability_index, models, "inclusive_global"
    ))
    partner_summary = build_partner_summary(partner_profiles, len(models))

    derived_dir.mkdir(parents=True, exist_ok=True)
    site_dir = site_data_dir / "global-baseline"
    site_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "pair_metrics_gzip": derived_dir / "global_baseline_pair_metrics.csv.gz",
        "pair_stability_csv": derived_dir / "global_topic_pair_stability.csv",
        "partner_stability_gzip": derived_dir / "global_partner_rank_stability.csv.gz",
        "partner_summary_csv": derived_dir / "global_partner_rank_summary.csv",
        "model_ability_csv": derived_dir / "global_model_ability.csv",
        "ability_stability_csv": derived_dir / "global_model_ability_stability.csv",
        "summary_json": derived_dir / "global_baseline_summary.json",
        "audit_json": derived_dir / "global_baseline_audit.json",
    }
    counts = {
        "pair_metrics": write_gzip_csv(paths["pair_metrics_gzip"], global_pair_rows, PAIR_FIELDS),
        "pair_stability": write_csv(paths["pair_stability_csv"], pair_stability, PAIR_STABILITY_FIELDS),
        "partner_stability": write_gzip_csv(paths["partner_stability_gzip"], partner_profiles, PARTNER_FIELDS),
        "partner_summary": write_csv(paths["partner_summary_csv"], partner_summary, PARTNER_SUMMARY_FIELDS),
        "model_ability": write_csv(paths["model_ability_csv"], ability_rows, ABILITY_FIELDS),
        "ability_stability": write_csv(paths["ability_stability_csv"], ability_stability, ABILITY_STABILITY_FIELDS),
    }
    profile_paths, profile_records = write_partner_profile_shards(
        derived_dir / "global_partner_profiles", partner_profiles, models
    )
    expected_profiles_per_model = (
        len(COMPARISON_MODES) * len(GLOBAL_SCOPES) * len(TOPICS) * len(METRICS) * len(SAMPLES)
    )
    if any(record["n_profiles"] != expected_profiles_per_model for record in profile_records):
        raise AssertionError("partner profile shard row count mismatch")
    counts["partner_profile_files"] = len(profile_paths)
    thresholds = {
        "min_overlap": min_overlap, "near_bi_gap": near_bi_gap,
        "high_loss_threshold": high_loss_threshold, "min_partners": min_partners,
        "reporting_min_defined": REPORTING_MIN, "headline_min_defined": HEADLINE_MIN,
        "quartile": QUARTILE,
    }
    summary = {
        "schema_version": SCHEMA_VERSION,
        "global_scopes": [{"id": scope, **GLOBAL_SCOPE_META[scope]} for scope in GLOBAL_SCOPES],
        "comparison_modes": [
            {"id": mode, **COMPARISON_MODE_META[mode]} for mode in COMPARISON_MODES
        ],
        "topic_ids": list(TOPICS), "metric_ids": list(METRICS), "sample_ids": list(SAMPLES),
        "thresholds": thresholds, "global_pair_summary": global_summary,
        "pair_stability": pair_stability, "partner_summary": partner_summary,
        "ability_stability": ability_stability,
    }
    write_json(paths["summary_json"], summary)
    expected = {
        "pair_metrics": len(GLOBAL_SCOPES) * len(all_pairs),
        "pair_stability": len(COMPARISON_MODES) * len(GLOBAL_SCOPES) * len(TOPICS) * len(METRICS) * len(SAMPLES),
        "partner_stability": len(COMPARISON_MODES) * len(GLOBAL_SCOPES) * len(TOPICS) * len(METRICS) * len(SAMPLES) * len(models),
        "partner_summary": len(COMPARISON_MODES) * len(GLOBAL_SCOPES) * len(TOPICS) * len(METRICS) * len(SAMPLES),
        "partner_profile_files": len(models),
        "model_ability": (len(GLOBAL_SCOPES) + len(TOPICS)) * len(models),
        "ability_stability": len(COMPARISON_MODES) * len(GLOBAL_SCOPES) * len(TOPICS),
    }
    if counts != expected:
        raise AssertionError(f"output counts mismatch: {counts!r} != {expected!r}")
    audit = {
        "schema_version": SCHEMA_VERSION, "built_at": built_at,
        "analysis_commit": analysis_commit,
        "inputs": {
            "scored_panel": file_record(scored_panel, scored_panel.name),
            "taxonomy": file_record(taxonomy, taxonomy.name),
            "pair_metrics": file_record(pair_metrics, pair_metrics.name),
        },
        "thresholds": thresholds,
        "universe": {"n_exact_models": len(models), "n_unordered_pairs": len(all_pairs), "model_names": list(models)},
        "stream": stream_audit, "topic_input": topic_input_audit,
        "leave_topic_out_internal_tables": loo_audit,
        "partner_profile_files": profile_records,
        "output_counts": counts, "expected_output_counts": expected,
        "files": {},
    }
    audit["files"] = {
        key: file_record(path, path.name) for key, path in paths.items()
        if key not in {"audit_json"}
    }
    write_json(paths["audit_json"], audit)

    site_names = {
        "pair_metrics_gzip": "pair-metrics.csv.gz", "pair_stability_csv": "pair-stability.csv",
        "partner_stability_gzip": "partner-stability.csv.gz",
        "partner_summary_csv": "partner-summary.csv",
        "model_ability_csv": "model-ability.csv", "ability_stability_csv": "ability-stability.csv",
        "summary_json": "summary.json", "audit_json": "audit.json",
    }
    for key, name in site_names.items():
        shutil.copyfile(paths[key], site_dir / name)
    site_profile_dir = site_dir / "partner-profiles"
    site_profile_dir.mkdir(parents=True, exist_ok=True)
    for stale in site_profile_dir.glob("*.json"):
        stale.unlink()
    for identifier, filename in profile_paths.items():
        shutil.copyfile(
            derived_dir / "global_partner_profiles" / filename,
            site_profile_dir / filename,
        )
    site_profile_names = {path.name for path in site_profile_dir.glob("*.json")}
    if site_profile_names != set(profile_paths.values()):
        raise AssertionError("site partner profile files do not match manifest references")
    manifest = {
        "schema_version": SCHEMA_VERSION, "generated_at": built_at,
        "analysis_commit": analysis_commit,
        "global_scopes": summary["global_scopes"],
        "comparison_modes": summary["comparison_modes"],
        "topics": [{"id": topic, "label_en": TOPIC_LABELS[topic]} for topic in TOPICS],
        "metrics": [
            {"id": metric, "label": str(spec["label"]),
             "dependence_direction": "lower" if int(spec["direction"]) == -1 else "higher"}
            for metric, spec in METRICS.items()
        ],
        "samples": [
            {"id": sample, "label": SAMPLE_LABELS[sample], "primary": sample == "near_bi_both"}
            for sample in SAMPLES
        ],
        "thresholds": thresholds,
        **{key: f"global-baseline/{name}" for key, name in site_names.items()},
        "partner_profile_files": {
            identifier: f"global-baseline/partner-profiles/{filename}"
            for identifier, filename in profile_paths.items()
        },
        "partner_profile_file_records": {
            record["model_id"]: {
                "path": f"partner-profiles/{record['path']}",
                "sha256": record["sha256"], "size_bytes": record["size_bytes"],
                "n_profiles": record["n_profiles"],
            }
            for record in profile_records
        },
        "universe": {"n_exact_models": len(models), "n_unordered_pairs": len(all_pairs)},
        "excluded_llm_crowd": stream_audit["excluded_llm_crowd"],
        "files": {
            key: file_record(site_dir / name, name) for key, name in site_names.items()
        },
    }
    write_json(site_dir / "manifest.json", manifest)
    return {"summary": summary, "audit": audit, "manifest": manifest}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scored-panel", type=Path, required=True)
    parser.add_argument("--taxonomy", type=Path, required=True)
    parser.add_argument("--pair-metrics", type=Path, required=True)
    parser.add_argument("--derived-dir", type=Path, required=True)
    parser.add_argument("--site-data-dir", type=Path, required=True)
    parser.add_argument("--built-at", required=True)
    parser.add_argument("--analysis-commit", required=True)
    parser.add_argument("--min-overlap", type=int, default=DEFAULT_MIN_OVERLAP)
    parser.add_argument("--near-bi-gap", type=float, default=DEFAULT_NEAR_BI_GAP)
    parser.add_argument("--high-loss-threshold", type=float, default=DEFAULT_HIGH_LOSS_THRESHOLD)
    parser.add_argument("--min-partners", type=int, default=DEFAULT_MIN_PARTNERS)
    parser.add_argument("--exclusion-reference-panel", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    run_analysis(
        scored_panel=args.scored_panel, taxonomy=args.taxonomy, pair_metrics=args.pair_metrics,
        derived_dir=args.derived_dir, site_data_dir=args.site_data_dir,
        built_at=args.built_at, analysis_commit=args.analysis_commit,
        min_overlap=args.min_overlap, near_bi_gap=args.near_bi_gap,
        high_loss_threshold=args.high_loss_threshold, min_partners=args.min_partners,
        exclusion_reference_panel=args.exclusion_reference_panel,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
