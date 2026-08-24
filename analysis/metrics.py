"""Compute the three audited ForecastBench dependence metrics by topic.

Input 1 is the scored panel produced by :mod:`analysis.scoring`.  Input 2 is a
derived taxonomy with the required key, provenance, and eligibility columns:
``date, source, event_id, topic_id, origin_type, official_source,
topic_analysis_eligible, review_required``.

The output contains every global model-version pair for every eligible
semantic topic, official origin, and official source, including rows that are
not estimable. Such rows retain overlap counts and an explicit reason instead
of disappearing from the published result.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEFAULT_MIN_OVERLAP = 50
DEFAULT_NEAR_BI_GAP = 2.0
DEFAULT_HIGH_LOSS_THRESHOLD = 0.25
DEFAULT_MAX_UNCLASSIFIED_TARGETS = 4

TAXONOMY_REQUIRED = {
    "date",
    "source",
    "event_id",
    "topic_id",
    "origin_type",
    "official_source",
    "topic_analysis_eligible",
    "review_required",
}
SCORED_REQUIRED = {
    "date",
    "source",
    "event_id",
    "horizon",
    "origin_type",
    "model_name",
    "model_organization",
    "adjusted_brier",
}

OUTPUT_FIELDS = [
    "slice_dimension",
    "slice_id",
    "topic_id",
    "model_a",
    "model_b",
    "organization_a",
    "organization_b",
    "n_model_a_targets",
    "n_model_b_targets",
    "n_overlap",
    "n_dates",
    "date_min",
    "date_max",
    "source_list",
    "origin_type_list",
    "min_overlap_required",
    "eligible",
    "insufficient_overlap_reason",
    "model_a_common_bi",
    "model_b_common_bi",
    "bi_gap_common",
    "near_bi_threshold",
    "near_bi",
    "bi_reason",
    "adjusted_pog",
    "pog_reason",
    "adjusted_high_loss_lift_025",
    "high_loss_rate_a_025",
    "high_loss_rate_b_025",
    "joint_high_loss_rate_025",
    "joint_high_loss_count_025",
    "lift_reason",
    "adjusted_loss_pearson_corr",
    "corr_reason",
    "metric_status",
]


@dataclass(frozen=True)
class Observation:
    date: str
    source: str
    event_id: str
    horizon: str
    origin_type: str
    adjusted_brier: float

    @property
    def target_key(self) -> tuple[str, str, str, str]:
        return (self.date, self.source, self.event_id, self.horizon)


@dataclass(frozen=True)
class TaxonomyRecord:
    topic_id: str
    origin_type: str
    official_source: str
    topic_analysis_eligible: bool
    review_required: bool

    def slices(self) -> tuple[tuple[str, str], ...]:
        values: list[tuple[str, str]] = [
            ("origin_type", self.origin_type),
            ("official_source", self.official_source),
        ]
        if self.topic_analysis_eligible:
            values.insert(0, ("topic", self.topic_id))
        return tuple(values)


@dataclass
class PairAccumulator:
    """Sufficient statistics for one topic and one unordered model pair."""

    n_overlap: int = 0
    n_dates: int = 0
    date_min: str = ""
    date_max: str = ""
    sum_a: float = 0.0
    sum_b: float = 0.0
    sum_min: float = 0.0
    running_mean_a: float = 0.0
    running_mean_b: float = 0.0
    running_m2_a: float = 0.0
    running_m2_b: float = 0.0
    running_covariance: float = 0.0
    high_a: int = 0
    high_b: int = 0
    high_both: int = 0
    origin_sum_a: dict[str, float] | None = None
    origin_sum_b: dict[str, float] | None = None
    origin_count: dict[str, int] | None = None
    sources: set[str] | None = None
    origins: set[str] | None = None

    def __post_init__(self) -> None:
        self.origin_sum_a = defaultdict(float)
        self.origin_sum_b = defaultdict(float)
        self.origin_count = defaultdict(int)
        self.sources = set()
        self.origins = set()

    def update(
        self,
        date: str,
        rows_a: Sequence[Observation],
        rows_b: Sequence[Observation],
        high_loss_threshold: float,
    ) -> None:
        if not rows_a or len(rows_a) != len(rows_b):
            raise ValueError("PairAccumulator.update requires equal non-empty rows")
        self.n_dates += 1
        self.date_min = min(self.date_min, date) if self.date_min else date
        self.date_max = max(self.date_max, date) if self.date_max else date
        assert self.origin_sum_a is not None
        assert self.origin_sum_b is not None
        assert self.origin_count is not None
        assert self.sources is not None
        assert self.origins is not None
        for row_a, row_b in zip(rows_a, rows_b):
            if row_a.target_key != row_b.target_key:
                raise ValueError("pair accumulator received misaligned target rows")
            if row_a.origin_type != row_b.origin_type:
                raise ValueError("pair accumulator received conflicting origins")
            a = row_a.adjusted_brier
            b = row_b.adjusted_brier
            new_n = self.n_overlap + 1
            delta_a = a - self.running_mean_a
            delta_b = b - self.running_mean_b
            self.running_mean_a += delta_a / new_n
            self.running_mean_b += delta_b / new_n
            self.running_m2_a += delta_a * (a - self.running_mean_a)
            self.running_m2_b += delta_b * (b - self.running_mean_b)
            self.running_covariance += delta_a * (b - self.running_mean_b)
            self.n_overlap = new_n
            self.sum_a += a
            self.sum_b += b
            self.sum_min += min(a, b)
            high_a = a > high_loss_threshold
            high_b = b > high_loss_threshold
            self.high_a += int(high_a)
            self.high_b += int(high_b)
            self.high_both += int(high_a and high_b)
            self.origin_sum_a[row_a.origin_type] += a
            self.origin_sum_b[row_a.origin_type] += b
            self.origin_count[row_a.origin_type] += 1
            self.sources.add(row_a.source)
            self.origins.add(row_a.origin_type)


def normalize_origin(value: str) -> str:
    lowered = value.strip().lower()
    if lowered == "market":
        return "Market"
    if lowered == "dataset":
        return "Dataset"
    raise ValueError(f"origin_type must be Dataset or Market, got {value!r}")


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def adjusted_pog(loss_a: Sequence[float], loss_b: Sequence[float]) -> float:
    """Adjusted pairwise oracle gain, event-weighted as in the legacy audit."""

    if not loss_a or len(loss_a) != len(loss_b):
        raise ValueError("adjusted_pog requires equal non-empty loss vectors")
    best_adjusted = min(mean(loss_a), mean(loss_b))
    oracle_adjusted = mean([min(a, b) for a, b in zip(loss_a, loss_b)])
    return best_adjusted - oracle_adjusted


def high_loss_lift(
    loss_a: Sequence[float],
    loss_b: Sequence[float],
    threshold: float = DEFAULT_HIGH_LOSS_THRESHOLD,
) -> tuple[float | None, float, float, float, int, str]:
    """Return lift, marginals, joint rate/count, and an explicit validity reason."""

    if not loss_a or len(loss_a) != len(loss_b):
        raise ValueError("high_loss_lift requires equal non-empty loss vectors")
    high_a = [value > threshold for value in loss_a]
    high_b = [value > threshold for value in loss_b]
    joint_count = sum(a and b for a, b in zip(high_a, high_b))
    n = len(loss_a)
    rate_a = sum(high_a) / n
    rate_b = sum(high_b) / n
    joint_rate = joint_count / n
    if rate_a == 0 and rate_b == 0:
        return None, rate_a, rate_b, joint_rate, joint_count, "both_marginal_high_loss_rates_zero"
    if rate_a == 0:
        return None, rate_a, rate_b, joint_rate, joint_count, "model_a_marginal_high_loss_rate_zero"
    if rate_b == 0:
        return None, rate_a, rate_b, joint_rate, joint_count, "model_b_marginal_high_loss_rate_zero"
    return (
        joint_rate / (rate_a * rate_b),
        rate_a,
        rate_b,
        joint_rate,
        joint_count,
        "",
    )


def pearson_correlation(
    values_a: Sequence[float], values_b: Sequence[float]
) -> tuple[float | None, str]:
    if len(values_a) != len(values_b):
        raise ValueError("pearson_correlation requires equal-length vectors")
    if len(values_a) < 3:
        return None, "fewer_than_3_observations"
    mean_a = mean(values_a)
    mean_b = mean(values_b)
    centered_a = [value - mean_a for value in values_a]
    centered_b = [value - mean_b for value in values_b]
    scale_a = math.sqrt(sum(value * value for value in centered_a))
    scale_b = math.sqrt(sum(value * value for value in centered_b))
    if scale_a == 0 and scale_b == 0:
        return None, "both_adjusted_loss_vectors_constant"
    if scale_a == 0:
        return None, "model_a_adjusted_loss_vector_constant"
    if scale_b == 0:
        return None, "model_b_adjusted_loss_vector_constant"
    correlation = sum(a * b for a, b in zip(centered_a, centered_b)) / (
        scale_a * scale_b
    )
    # Clamp only machine-level excursions beyond the mathematical bounds.
    return max(-1.0, min(1.0, correlation)), ""


def official_adjusted_brier(observations: Sequence[Observation]) -> float:
    """Equal-weight Dataset/Market means, preserving official aggregation."""

    if not observations:
        raise ValueError("official_adjusted_brier requires observations")
    grouped: dict[str, list[float]] = defaultdict(list)
    for observation in observations:
        grouped[observation.origin_type].append(observation.adjusted_brier)
    stratum_means = [mean(grouped[key]) for key in ("Dataset", "Market") if grouped[key]]
    return mean(stratum_means)


def brier_index(adjusted_brier: float) -> tuple[float | None, str]:
    if not math.isfinite(adjusted_brier):
        return None, "nonfinite_adjusted_brier"
    if adjusted_brier < 0:
        return None, "negative_adjusted_brier"
    return (1 - math.sqrt(adjusted_brier)) * 100, ""


def _empty_metrics(reason: str) -> dict[str, Any]:
    return {
        "model_a_common_bi": "",
        "model_b_common_bi": "",
        "bi_gap_common": "",
        "near_bi": "",
        "bi_reason": reason,
        "adjusted_pog": "",
        "pog_reason": reason,
        "adjusted_high_loss_lift_025": "",
        "high_loss_rate_a_025": "",
        "high_loss_rate_b_025": "",
        "joint_high_loss_rate_025": "",
        "joint_high_loss_count_025": "",
        "lift_reason": reason,
        "adjusted_loss_pearson_corr": "",
        "corr_reason": reason,
        "metric_status": "not_estimable",
    }


def compute_pair_topic_row(
    topic_id: str,
    model_a: str,
    model_b: str,
    observations_a: Mapping[tuple[str, str, str, str], Observation],
    observations_b: Mapping[tuple[str, str, str, str], Observation],
    organization_a: str = "",
    organization_b: str = "",
    min_overlap: int = DEFAULT_MIN_OVERLAP,
    near_bi_gap: float = DEFAULT_NEAR_BI_GAP,
    high_loss_threshold: float = DEFAULT_HIGH_LOSS_THRESHOLD,
) -> dict[str, Any]:
    common = sorted(set(observations_a) & set(observations_b))
    n_overlap = len(common)
    common_a = [observations_a[key] for key in common]
    common_b = [observations_b[key] for key in common]
    dates = sorted({row.date for row in common_a})
    sources = sorted({row.source for row in common_a})
    origins = sorted({row.origin_type for row in common_a})

    if not observations_a or not observations_b:
        insufficient_reason = "model_missing_in_slice"
    elif n_overlap == 0:
        insufficient_reason = "no_common_targets"
    elif n_overlap < min_overlap:
        insufficient_reason = f"n_overlap_{n_overlap}_below_min_{min_overlap}"
    else:
        insufficient_reason = ""

    result: dict[str, Any] = {
        "slice_dimension": "topic",
        "slice_id": topic_id,
        "topic_id": topic_id,
        "model_a": model_a,
        "model_b": model_b,
        "organization_a": organization_a,
        "organization_b": organization_b,
        "n_model_a_targets": len(observations_a),
        "n_model_b_targets": len(observations_b),
        "n_overlap": n_overlap,
        "n_dates": len(dates),
        "date_min": dates[0] if dates else "",
        "date_max": dates[-1] if dates else "",
        "source_list": ";".join(sources),
        "origin_type_list": ";".join(origins),
        "min_overlap_required": min_overlap,
        "eligible": int(not insufficient_reason),
        "insufficient_overlap_reason": insufficient_reason,
        "near_bi_threshold": near_bi_gap,
    }
    if insufficient_reason:
        result.update(_empty_metrics(insufficient_reason))
        return result

    loss_a = [row.adjusted_brier for row in common_a]
    loss_b = [row.adjusted_brier for row in common_b]
    result["adjusted_pog"] = adjusted_pog(loss_a, loss_b)
    result["pog_reason"] = ""

    lift, rate_a, rate_b, joint_rate, joint_count, lift_reason = high_loss_lift(
        loss_a, loss_b, high_loss_threshold
    )
    result.update(
        {
            "adjusted_high_loss_lift_025": "" if lift is None else lift,
            "high_loss_rate_a_025": rate_a,
            "high_loss_rate_b_025": rate_b,
            "joint_high_loss_rate_025": joint_rate,
            "joint_high_loss_count_025": joint_count,
            "lift_reason": lift_reason,
        }
    )

    correlation, corr_reason = pearson_correlation(loss_a, loss_b)
    result["adjusted_loss_pearson_corr"] = (
        "" if correlation is None else correlation
    )
    result["corr_reason"] = corr_reason

    adjusted_brier_a = official_adjusted_brier(common_a)
    adjusted_brier_b = official_adjusted_brier(common_b)
    bi_a, bi_reason_a = brier_index(adjusted_brier_a)
    bi_b, bi_reason_b = brier_index(adjusted_brier_b)
    bi_reasons = ";".join(
        value
        for value in (
            f"model_a:{bi_reason_a}" if bi_reason_a else "",
            f"model_b:{bi_reason_b}" if bi_reason_b else "",
        )
        if value
    )
    if bi_a is None or bi_b is None:
        result.update(
            {
                "model_a_common_bi": "" if bi_a is None else bi_a,
                "model_b_common_bi": "" if bi_b is None else bi_b,
                "bi_gap_common": "",
                "near_bi": "",
                "bi_reason": bi_reasons,
            }
        )
    else:
        gap = abs(bi_a - bi_b)
        result.update(
            {
                "model_a_common_bi": bi_a,
                "model_b_common_bi": bi_b,
                "bi_gap_common": gap,
                "near_bi": int(gap <= near_bi_gap),
                "bi_reason": "",
            }
        )

    undefined = [name for name, reason in (("BI", bi_reasons), ("lift", lift_reason), ("corr", corr_reason)) if reason]
    result["metric_status"] = (
        "eligible_all_metrics" if not undefined else "eligible_partial:" + ",".join(undefined)
    )
    return result


def _require_columns(actual: Iterable[str] | None, required: set[str], label: str) -> None:
    fields = set(actual or [])
    missing = sorted(required - fields)
    if missing:
        raise ValueError(f"{label} is missing required columns: {', '.join(missing)}")


def parse_bool(value: object, field: str, row_number: int) -> bool:
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    raise ValueError(f"invalid {field} boolean at taxonomy row {row_number}: {value!r}")


def load_taxonomy(
    path: Path,
) -> tuple[dict[tuple[str, str, str], TaxonomyRecord], int, Counter[str]]:
    result: dict[tuple[str, str, str], TaxonomyRecord] = {}
    audit: Counter[str] = Counter()
    rows = 0
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        _require_columns(reader.fieldnames, TAXONOMY_REQUIRED, "taxonomy CSV")
        for raw in reader:
            rows += 1
            key = (
                raw["date"].strip()[:10],
                raw["source"].strip().lower(),
                raw["event_id"].strip(),
            )
            topic_id = raw["topic_id"].strip()
            if not all(key) or not topic_id:
                raise ValueError(f"blank taxonomy key/topic at input row {rows + 1}")
            official_source = raw["official_source"].strip()
            if not official_source:
                raise ValueError(f"blank official_source at taxonomy row {rows + 1}")
            value = TaxonomyRecord(
                topic_id=topic_id,
                origin_type=normalize_origin(raw["origin_type"]),
                official_source=official_source,
                topic_analysis_eligible=parse_bool(
                    raw["topic_analysis_eligible"],
                    "topic_analysis_eligible",
                    rows + 1,
                ),
                review_required=parse_bool(
                    raw["review_required"], "review_required", rows + 1
                ),
            )
            prior = result.get(key)
            if prior is not None and prior != value:
                raise ValueError(
                    f"conflicting taxonomy rows for {key!r}: {prior!r} vs {value!r}"
                )
            if prior is None:
                result[key] = value
                audit["unique_taxonomy_keys"] += 1
                audit[
                    "topic_analysis_eligible_rows"
                    if value.topic_analysis_eligible
                    else "topic_analysis_ineligible_rows"
                ] += 1
                if value.review_required:
                    audit["review_required_rows"] += 1
                    if value.topic_analysis_eligible:
                        audit["eligible_review_required_rows"] += 1
    return result, rows, audit


def _accumulate_one_date(
    date: str,
    by_slice_model: Mapping[
        tuple[str, str],
        Mapping[str, Mapping[tuple[str, str, str, str], Observation]],
    ],
    accumulators: dict[tuple[str, str, str, str], PairAccumulator],
    high_loss_threshold: float,
) -> None:
    for (slice_dimension, slice_id), slice_models in by_slice_model.items():
        for model_a, model_b in itertools.combinations(sorted(slice_models), 2):
            rows_by_key_a = slice_models[model_a]
            rows_by_key_b = slice_models[model_b]
            common = sorted(set(rows_by_key_a) & set(rows_by_key_b))
            if not common:
                continue
            rows_a = [rows_by_key_a[key] for key in common]
            rows_b = [rows_by_key_b[key] for key in common]
            accumulator = accumulators.setdefault(
                (slice_dimension, slice_id, model_a, model_b), PairAccumulator()
            )
            accumulator.update(date, rows_a, rows_b, high_loss_threshold)


def stream_pair_accumulators(
    scored_panel: Path,
    taxonomy: Mapping[tuple[str, str, str], TaxonomyRecord],
    high_loss_threshold: float = DEFAULT_HIGH_LOSS_THRESHOLD,
    allow_unclassified: bool = False,
) -> tuple[
    dict[tuple[str, str, str, str], PairAccumulator],
    dict[tuple[str, str, str], int],
    dict[str, str],
    Counter[str],
    set[tuple[str, str, str, str]],
]:
    """Accumulate pair statistics one date at a time.

    The scored-panel writer sorts by date, so the full multi-million-row panel
    never needs to reside in memory.  An externally supplied panel that breaks
    date ordering fails explicitly rather than producing partial accumulators.
    """

    accumulators: dict[tuple[str, str, str, str], PairAccumulator] = {}
    target_counts: Counter[tuple[str, str, str]] = Counter()
    organizations: dict[str, str] = {}
    counters: Counter[str] = Counter()
    missing_taxonomy_targets: set[tuple[str, str, str, str]] = set()
    current_date = ""
    current: dict[
        tuple[str, str],
        dict[str, dict[tuple[str, str, str, str], Observation]],
    ] = defaultdict(lambda: defaultdict(dict))

    with scored_panel.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        _require_columns(reader.fieldnames, SCORED_REQUIRED, "scored panel CSV")
        for row_number, raw in enumerate(reader, start=2):
            counters["scored_input_rows"] += 1
            date = raw["date"].strip()[:10]
            if current_date and date < current_date:
                raise ValueError(
                    "scored panel must be sorted by date; "
                    f"row {row_number} has {date} after {current_date}"
                )
            if current_date and date != current_date:
                _accumulate_one_date(
                    current_date, current, accumulators, high_loss_threshold
                )
                current = defaultdict(lambda: defaultdict(dict))
            current_date = date

            source = raw["source"].strip().lower()
            event_id = raw["event_id"].strip()
            taxonomy_value = taxonomy.get((date, source, event_id))
            if taxonomy_value is None:
                counters["scored_rows_missing_taxonomy"] += 1
                missing_taxonomy_targets.add(
                    (date, source, event_id, raw["horizon"].strip())
                )
                if allow_unclassified:
                    continue
                raise ValueError(
                    "scored row has no taxonomy match at row "
                    f"{row_number}: {(date, source, event_id)!r}"
                )
            taxonomy_origin = taxonomy_value.origin_type
            scored_origin = normalize_origin(raw["origin_type"])
            if taxonomy_origin != scored_origin:
                raise ValueError(
                    f"origin mismatch for {(date, source, event_id)!r}: "
                    f"taxonomy={taxonomy_origin}, scored={scored_origin}"
                )
            model = raw["model_name"].strip()
            if not model:
                raise ValueError(f"blank model_name at scored row {row_number}")
            organization = raw["model_organization"].strip()
            known_org = organizations.setdefault(model, organization)
            if known_org and organization and known_org != organization:
                raise ValueError(
                    f"model {model!r} has conflicting organizations: "
                    f"{known_org!r} vs {organization!r}"
                )
            if not known_org and organization:
                organizations[model] = organization
            try:
                adjusted_brier = float(raw["adjusted_brier"])
            except ValueError as exc:
                raise ValueError(
                    f"invalid adjusted_brier at scored row {row_number}"
                ) from exc
            if not math.isfinite(adjusted_brier):
                raise ValueError(f"non-finite adjusted_brier at scored row {row_number}")
            observation = Observation(
                date=date,
                source=source,
                event_id=event_id,
                horizon=raw["horizon"].strip(),
                origin_type=taxonomy_origin,
                adjusted_brier=adjusted_brier,
            )
            inserted_any = False
            for slice_dimension, slice_id in taxonomy_value.slices():
                model_rows = current[(slice_dimension, slice_id)][model]
                prior = model_rows.get(observation.target_key)
                if prior is not None:
                    if prior != observation:
                        raise ValueError(
                            "conflicting duplicate scored observation for "
                            f"slice={(slice_dimension, slice_id)!r}, "
                            f"model={model!r}, target={observation.target_key!r}"
                        )
                    counters["collapsed_identical_scored_slice_duplicates"] += 1
                    continue
                model_rows[observation.target_key] = observation
                target_counts[(slice_dimension, slice_id, model)] += 1
                counters[f"joined_unique_rows:{slice_dimension}"] += 1
                inserted_any = True
            if inserted_any:
                counters["joined_unique_scored_rows"] += 1

    if current_date:
        _accumulate_one_date(
            current_date, current, accumulators, high_loss_threshold
        )
    return (
        accumulators,
        dict(target_counts),
        organizations,
        counters,
        missing_taxonomy_targets,
    )


def _correlation_from_accumulator(
    accumulator: PairAccumulator,
) -> tuple[float | None, str]:
    n = accumulator.n_overlap
    if n < 3:
        return None, "fewer_than_3_observations"
    if accumulator.running_m2_a <= 0 and accumulator.running_m2_b <= 0:
        return None, "both_adjusted_loss_vectors_constant"
    if accumulator.running_m2_a <= 0:
        return None, "model_a_adjusted_loss_vector_constant"
    if accumulator.running_m2_b <= 0:
        return None, "model_b_adjusted_loss_vector_constant"
    value = accumulator.running_covariance / math.sqrt(
        accumulator.running_m2_a * accumulator.running_m2_b
    )
    return max(-1.0, min(1.0, value)), ""


def finalize_accumulated_pair_row(
    *,
    slice_dimension: str,
    slice_id: str,
    model_a: str,
    model_b: str,
    n_model_a_targets: int,
    n_model_b_targets: int,
    accumulator: PairAccumulator | None,
    organization_a: str,
    organization_b: str,
    min_overlap: int,
    near_bi_gap: float,
) -> dict[str, Any]:
    n_overlap = accumulator.n_overlap if accumulator else 0
    if n_model_a_targets == 0 or n_model_b_targets == 0:
        insufficient_reason = "model_missing_in_slice"
    elif n_overlap == 0:
        insufficient_reason = "no_common_targets"
    elif n_overlap < min_overlap:
        insufficient_reason = f"n_overlap_{n_overlap}_below_min_{min_overlap}"
    else:
        insufficient_reason = ""

    result: dict[str, Any] = {
        "slice_dimension": slice_dimension,
        "slice_id": slice_id,
        "topic_id": slice_id if slice_dimension == "topic" else "",
        "model_a": model_a,
        "model_b": model_b,
        "organization_a": organization_a,
        "organization_b": organization_b,
        "n_model_a_targets": n_model_a_targets,
        "n_model_b_targets": n_model_b_targets,
        "n_overlap": n_overlap,
        "n_dates": accumulator.n_dates if accumulator else 0,
        "date_min": accumulator.date_min if accumulator else "",
        "date_max": accumulator.date_max if accumulator else "",
        "source_list": ";".join(sorted(accumulator.sources or ())) if accumulator else "",
        "origin_type_list": ";".join(sorted(accumulator.origins or ())) if accumulator else "",
        "min_overlap_required": min_overlap,
        "eligible": int(not insufficient_reason),
        "insufficient_overlap_reason": insufficient_reason,
        "near_bi_threshold": near_bi_gap,
    }
    if insufficient_reason:
        result.update(_empty_metrics(insufficient_reason))
        return result
    assert accumulator is not None
    n = accumulator.n_overlap
    result["adjusted_pog"] = min(accumulator.sum_a / n, accumulator.sum_b / n) - accumulator.sum_min / n
    result["pog_reason"] = ""

    rate_a = accumulator.high_a / n
    rate_b = accumulator.high_b / n
    joint_rate = accumulator.high_both / n
    if rate_a == 0 and rate_b == 0:
        lift = None
        lift_reason = "both_marginal_high_loss_rates_zero"
    elif rate_a == 0:
        lift = None
        lift_reason = "model_a_marginal_high_loss_rate_zero"
    elif rate_b == 0:
        lift = None
        lift_reason = "model_b_marginal_high_loss_rate_zero"
    else:
        lift = joint_rate / (rate_a * rate_b)
        lift_reason = ""
    result.update(
        {
            "adjusted_high_loss_lift_025": "" if lift is None else lift,
            "high_loss_rate_a_025": rate_a,
            "high_loss_rate_b_025": rate_b,
            "joint_high_loss_rate_025": joint_rate,
            "joint_high_loss_count_025": accumulator.high_both,
            "lift_reason": lift_reason,
        }
    )

    correlation, corr_reason = _correlation_from_accumulator(accumulator)
    result["adjusted_loss_pearson_corr"] = "" if correlation is None else correlation
    result["corr_reason"] = corr_reason

    assert accumulator.origin_sum_a is not None
    assert accumulator.origin_sum_b is not None
    assert accumulator.origin_count is not None
    brier_a = mean(
        [
            accumulator.origin_sum_a[origin] / accumulator.origin_count[origin]
            for origin in ("Dataset", "Market")
            if accumulator.origin_count[origin]
        ]
    )
    brier_b = mean(
        [
            accumulator.origin_sum_b[origin] / accumulator.origin_count[origin]
            for origin in ("Dataset", "Market")
            if accumulator.origin_count[origin]
        ]
    )
    bi_a, bi_reason_a = brier_index(brier_a)
    bi_b, bi_reason_b = brier_index(brier_b)
    bi_reasons = ";".join(
        value
        for value in (
            f"model_a:{bi_reason_a}" if bi_reason_a else "",
            f"model_b:{bi_reason_b}" if bi_reason_b else "",
        )
        if value
    )
    if bi_a is None or bi_b is None:
        result.update(
            {
                "model_a_common_bi": "" if bi_a is None else bi_a,
                "model_b_common_bi": "" if bi_b is None else bi_b,
                "bi_gap_common": "",
                "near_bi": "",
                "bi_reason": bi_reasons,
            }
        )
    else:
        gap = abs(bi_a - bi_b)
        result.update(
            {
                "model_a_common_bi": bi_a,
                "model_b_common_bi": bi_b,
                "bi_gap_common": gap,
                "near_bi": int(gap <= near_bi_gap),
                "bi_reason": "",
            }
        )
    undefined = [
        name
        for name, reason in (
            ("BI", bi_reasons),
            ("lift", lift_reason),
            ("corr", corr_reason),
        )
        if reason
    ]
    result["metric_status"] = (
        "eligible_all_metrics"
        if not undefined
        else "eligible_partial:" + ",".join(undefined)
    )
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_analysis(
    scored_panel: Path,
    taxonomy_csv: Path,
    output_csv: Path,
    audit_json: Path | None = None,
    min_overlap: int = DEFAULT_MIN_OVERLAP,
    near_bi_gap: float = DEFAULT_NEAR_BI_GAP,
    high_loss_threshold: float = DEFAULT_HIGH_LOSS_THRESHOLD,
    allow_unclassified: bool = False,
    max_unclassified_targets: int = DEFAULT_MAX_UNCLASSIFIED_TARGETS,
) -> dict[str, Any]:
    if min_overlap < 1:
        raise ValueError("min_overlap must be positive")
    if max_unclassified_targets < 0:
        raise ValueError("max_unclassified_targets cannot be negative")
    taxonomy, taxonomy_input_rows, taxonomy_counters = load_taxonomy(taxonomy_csv)
    (
        accumulators,
        target_counts,
        organizations,
        counters,
        missing_taxonomy_targets,
    ) = stream_pair_accumulators(
        scored_panel,
        taxonomy,
        high_loss_threshold=high_loss_threshold,
        allow_unclassified=allow_unclassified,
    )
    if allow_unclassified and len(missing_taxonomy_targets) > max_unclassified_targets:
        raise ValueError(
            f"found {len(missing_taxonomy_targets)} unique unclassified targets; "
            f"release limit is {max_unclassified_targets}"
        )
    models = sorted(organizations)
    slice_ids: dict[str, set[str]] = defaultdict(set)
    for taxonomy_row in taxonomy.values():
        for slice_dimension, slice_id in taxonomy_row.slices():
            slice_ids[slice_dimension].add(slice_id)
    ordered_dimensions = ("topic", "origin_type", "official_source")
    model_pairs = list(itertools.combinations(models, 2))

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    status_counts: Counter[str] = Counter()
    rows_by_dimension: Counter[str] = Counter()
    rows_written = 0
    with output_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        for slice_dimension in ordered_dimensions:
            for slice_id in sorted(slice_ids[slice_dimension]):
                for model_a, model_b in model_pairs:
                    row = finalize_accumulated_pair_row(
                        slice_dimension=slice_dimension,
                        slice_id=slice_id,
                        model_a=model_a,
                        model_b=model_b,
                        n_model_a_targets=target_counts.get(
                            (slice_dimension, slice_id, model_a), 0
                        ),
                        n_model_b_targets=target_counts.get(
                            (slice_dimension, slice_id, model_b), 0
                        ),
                        accumulator=accumulators.get(
                            (slice_dimension, slice_id, model_a, model_b)
                        ),
                        organization_a=organizations.get(model_a, ""),
                        organization_b=organizations.get(model_b, ""),
                        min_overlap=min_overlap,
                        near_bi_gap=near_bi_gap,
                    )
                    writer.writerow(row)
                    rows_written += 1
                    rows_by_dimension[slice_dimension] += 1
                    status_counts[
                        f"{slice_dimension}:{row['metric_status']}"
                    ] += 1

    missing_target_rows = [
        {"date": date, "source": source, "event_id": event_id, "horizon": horizon}
        for date, source, event_id, horizon in sorted(missing_taxonomy_targets)
    ]
    topics = sorted(slice_ids["topic"])

    audit = {
        "schema_version": 1,
        "scored_panel_file": scored_panel.name,
        "scored_panel_sha256": _sha256(scored_panel),
        "taxonomy_file": taxonomy_csv.name,
        "taxonomy_sha256": _sha256(taxonomy_csv),
        "taxonomy_input_rows": taxonomy_input_rows,
        "taxonomy_unique_keys": len(taxonomy),
        "taxonomy_counters": dict(sorted(taxonomy_counters.items())),
        "n_topics": len(topics),
        "topics": topics,
        "slice_ids_by_dimension": {
            dimension: sorted(slice_ids[dimension])
            for dimension in ordered_dimensions
        },
        "n_slices_by_dimension": {
            dimension: len(slice_ids[dimension])
            for dimension in ordered_dimensions
        },
        "n_exact_model_names": len(models),
        "n_global_model_pairs": len(model_pairs),
        "pair_slice_rows": rows_written,
        "pair_rows_by_dimension": dict(sorted(rows_by_dimension.items())),
        "pair_topic_rows": rows_by_dimension["topic"],
        "min_overlap": min_overlap,
        "near_bi_gap": near_bi_gap,
        "high_adjusted_loss_threshold": high_loss_threshold,
        "join_counters": dict(sorted(counters.items())),
        "join_mode": (
            f"allow_unclassified_up_to_{max_unclassified_targets}_unique_targets"
            if allow_unclassified
            else "strict"
        ),
        "unclassified_scored_rows": counters["scored_rows_missing_taxonomy"],
        "unclassified_unique_targets": len(missing_taxonomy_targets),
        "unclassified_targets": missing_target_rows,
        "metric_status_counts": dict(sorted(status_counts.items())),
    }
    if audit_json is not None:
        audit_json.parent.mkdir(parents=True, exist_ok=True)
        audit_json.write_text(
            json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    return audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scored-panel", required=True, type=Path)
    parser.add_argument("--taxonomy", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--audit-output", type=Path)
    parser.add_argument("--min-overlap", type=int, default=DEFAULT_MIN_OVERLAP)
    parser.add_argument("--near-bi-gap", type=float, default=DEFAULT_NEAR_BI_GAP)
    parser.add_argument(
        "--high-loss-threshold", type=float, default=DEFAULT_HIGH_LOSS_THRESHOLD
    )
    parser.add_argument(
        "--allow-unclassified",
        action="store_true",
        help="Drop a bounded number of targets without taxonomy metadata.",
    )
    parser.add_argument(
        "--max-unclassified-targets",
        type=int,
        default=DEFAULT_MAX_UNCLASSIFIED_TARGETS,
        help="Fatal unique-target limit when --allow-unclassified is set.",
    )
    args = parser.parse_args()
    audit = run_analysis(
        scored_panel=args.scored_panel,
        taxonomy_csv=args.taxonomy,
        output_csv=args.output,
        audit_json=args.audit_output,
        min_overlap=args.min_overlap,
        near_bi_gap=args.near_bi_gap,
        high_loss_threshold=args.high_loss_threshold,
        allow_unclassified=args.allow_unclassified,
        max_unclassified_targets=args.max_unclassified_targets,
    )
    print(json.dumps(audit, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
