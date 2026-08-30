"""Build the six-family aggregation benchmark used by the Site.

The input is the post-merge ForecastBench model-version panel. Every eligible
GPT, Claude, Gemini, Qwen, DeepSeek, and Kimi pair is evaluated on exact common
support.
Alongside the same-sample diagnostic, a deterministic event-level two-fold
cross-fit estimates dependence and Near-BI on one half and aggregation gain on
the other, then swaps the halves. No outcome from a test event is used to form
its dependence signal or Near-BI inclusion decision.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable, Mapping

from analysis.metrics import (
    adjusted_pog,
    brier_index,
    high_loss_lift,
    pearson_correlation,
    total_variation,
)


KEY = ("date", "source", "event_id", "horizon")
ORIGINS = ("Dataset", "Market")
FAMILIES = ("GPT", "Claude", "Gemini", "Qwen", "DeepSeek", "Kimi")
FAMILY_ORDER = {family: index for index, family in enumerate(FAMILIES)}
PAIR_GROUPS = tuple(
    f"{first.casefold()}_{second.casefold()}"
    for first_index, first in enumerate(FAMILIES)
    for second in FAMILIES[first_index:]
)
METHODS = (
    "ec_w0_56",
    "simple_mean",
    "log_odds_mean",
    "piecewise_odds",
    "best_single",
    "past_only_best_single",
)
DIVERSITY_METRICS = (
    "adjusted_pog",
    "high_loss_lift",
    "adjusted_loss_corr",
    "total_variation",
)

# ForecastBench's 2024-07-21 files used OpenAI's moving ``GPT-4o`` alias.
# At that date the alias resolved to the 2024-05-13 snapshot.  Keep both real
# forecast histories, but expose and evaluate them as one pinned model version.
MODEL_ALIASES = {"GPT-4o": "GPT-4o-2024-05-13"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def logit(value: float) -> float:
    clipped = min(max(value, 1e-6), 1 - 1e-6)
    return math.log(clipped / (1 - clipped))


def sigmoid(value: float) -> float:
    if value >= 0:
        term = math.exp(-value)
        return 1 / (1 + term)
    term = math.exp(value)
    return term / (1 + term)


def predictions(first: float, second: float, ec_weight: float, piecewise_threshold: float) -> dict[str, float]:
    first_logit = logit(first)
    second_logit = logit(second)
    summed_logit = first_logit + second_logit
    boundary = math.log(piecewise_threshold)
    if summed_logit <= -boundary:
        piecewise_logit = summed_logit + boundary / 2
    elif summed_logit >= boundary:
        piecewise_logit = summed_logit - boundary / 2
    else:
        piecewise_logit = summed_logit / 2
    return {
        "ec_w0_56": sigmoid(ec_weight * summed_logit),
        "simple_mean": (first + second) / 2,
        "log_odds_mean": sigmoid(summed_logit / 2),
        "piecewise_odds": sigmoid(piecewise_logit),
    }


def adjusted_loss(row: Mapping[str, str], prediction: float) -> float:
    return (
        (prediction - float(row["outcome"])) ** 2
        - float(row["question_fixed_effect"])
        + float(row["normalization_term"])
    )


def official_mean(rows: Iterable[tuple[str, float]]) -> float:
    grouped: dict[str, list[float]] = defaultdict(list)
    for origin, value in rows:
        grouped[origin].append(value)
    means = [sum(grouped[origin]) / len(grouped[origin]) for origin in ORIGINS if grouped[origin]]
    if not means:
        raise ValueError("official mean requires Dataset or Market observations")
    return sum(means) / len(means)


def accumulated_official_mean(sums: Mapping[str, float], counts: Mapping[str, int]) -> float | None:
    means = [sums[origin] / counts[origin] for origin in ORIGINS if counts.get(origin, 0)]
    return sum(means) / len(means) if means else None


def family(model: str) -> str | None:
    lowered = model.casefold()
    for candidate in FAMILIES:
        if lowered.startswith(candidate.casefold()):
            return candidate
    return None


def pair_group(first: str, second: str) -> str:
    first_family = family(first)
    second_family = family(second)
    if first_family is None or second_family is None:
        raise ValueError(f"unsupported pair: {first} x {second}")
    ordered = sorted((first_family, second_family), key=FAMILY_ORDER.__getitem__)
    return "_".join(value.casefold() for value in ordered)


def read_pairs(path: Path) -> list[dict[str, str]]:
    opener = gzip.open if path.suffix == ".gz" else open
    rows: list[dict[str, str]] = []
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("global_scope") != "official_full" or row.get("eligible") != "1":
                continue
            if family(row["model_a"]) and family(row["model_b"]):
                rows.append(row)
    return rows


def resolve_model_alias(model: str) -> str:
    return MODEL_ALIASES.get(model, model)


def read_panel(
    path: Path,
) -> tuple[dict[str, dict[tuple[str, ...], dict[str, str]]], dict[str, Any]]:
    output: dict[str, dict[tuple[str, ...], dict[str, str]]] = defaultdict(dict)
    source_names: dict[tuple[str, tuple[str, ...]], str] = {}
    remapped_rows: dict[str, int] = defaultdict(int)
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {*KEY, "model_name", "prediction", "outcome", "origin_type", "question_fixed_effect", "normalization_term"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"merged panel missing fields: {sorted(missing)}")
        for row in reader:
            source_model = row["model_name"].strip()
            if family(source_model) is None:
                continue
            model = resolve_model_alias(source_model)
            key = tuple(row[field] for field in KEY)
            if key in output[model]:
                previous = source_names[(model, key)]
                raise ValueError(
                    f"alias merge creates duplicate model-target row for {model}: {key}; "
                    f"sources={previous!r},{source_model!r}"
                )
            resolved_row = dict(row)
            resolved_row["model_name"] = model
            output[model][key] = resolved_row
            source_names[(model, key)] = source_model
            if model != source_model:
                remapped_rows[source_model] += 1
    return dict(output), {
        "aliases": dict(MODEL_ALIASES),
        "remapped_rows": dict(sorted(remapped_rows.items())),
        "target_collisions": 0,
    }


def eligible_pair_rows(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    minimum_overlap: int,
    minimum_fold_overlap: int,
    split_seeds: list[int],
    preferred_orientation: Mapping[frozenset[str], tuple[str, str]],
) -> tuple[list[dict[str, str]], int]:
    ordered_models = sorted(panel, key=lambda model: (FAMILY_ORDER[family(model)], model.casefold(), model))
    rows: list[dict[str, str]] = []
    fold_ineligible = 0
    for first_name, second_name in combinations(ordered_models, 2):
        common = set(panel[first_name]) & set(panel[second_name])
        if len(common) < minimum_overlap:
            continue
        fold_counts = [
            {
                fold: sum(event_fold(key[1], key[2], seed) == fold for key in common)
                for fold in ("A", "B")
            }
            for seed in split_seeds
        ]
        if any(min(counts.values()) < minimum_fold_overlap for counts in fold_counts):
            fold_ineligible += 1
            continue
        first_name, second_name = preferred_orientation.get(
            frozenset((first_name, second_name)),
            (first_name, second_name),
        )
        rows.append({"model_a": first_name, "model_b": second_name})
    return rows, fold_ineligible


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    location = quantile * (len(ordered) - 1)
    low = math.floor(location)
    high = math.ceil(location)
    weight = location - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def summarize(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for group in ("all", *PAIR_GROUPS):
        group_points = points if group == "all" else [point for point in points if point["pair_group"] == group]
        for sample in ("eligible", "near_bi"):
            sample_points = group_points if sample == "eligible" else [point for point in group_points if point["near_bi"]]
            for method in METHODS:
                valid = [point for point in sample_points if point["gain_fraction_vs_best_single"].get(method) is not None]
                gains = [point["gain_fraction_vs_best_single"][method] for point in valid]
                weights = [point["n_overlap"] for point in valid]
                weight_total = sum(weights)
                output.append(
                    {
                        "pair_group": group,
                        "sample": sample,
                        "method": method,
                        "pair_count": len(valid),
                        "pair_event_cells": weight_total,
                        "positive_pairs": sum(gain > 0 for gain in gains),
                        "positive_pair_share": sum(gain > 0 for gain in gains) / len(gains) if gains else None,
                        "macro_mean_gain_fraction": sum(gains) / len(gains) if gains else None,
                        "support_weighted_gain_fraction": (
                            sum(gain * weight for gain, weight in zip(gains, weights)) / weight_total
                            if weight_total else None
                        ),
                        "median_gain_fraction": percentile(gains, 0.5) if gains else None,
                        "p10_gain_fraction": percentile(gains, 0.1) if gains else None,
                        "p90_gain_fraction": percentile(gains, 0.9) if gains else None,
                    }
                )
    return output


def score_aggregation_support(
    first_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    second_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    common: list[tuple[str, ...]],
    ec_weight: float,
    piecewise_threshold: float,
) -> dict[str, Any]:
    if not common:
        raise ValueError("aggregation support cannot be empty")
    losses: dict[str, list[tuple[str, float]]] = defaultdict(list)
    by_date: dict[str, list[tuple[Mapping[str, str], Mapping[str, str]]]] = defaultdict(list)
    for key in common:
        first = first_panel[key]
        second = second_panel[key]
        if first["outcome"] != second["outcome"] or first["origin_type"] != second["origin_type"]:
            raise ValueError(f"misaligned pair rows: {key}")
        by_date[first["date"][:10]].append((first, second))
        first_prediction = float(first["prediction"])
        second_prediction = float(second["prediction"])
        origin = first["origin_type"]
        losses["model_a"].append((origin, adjusted_loss(first, first_prediction)))
        losses["model_b"].append((origin, adjusted_loss(second, second_prediction)))
        for method, prediction in predictions(first_prediction, second_prediction, ec_weight, piecewise_threshold).items():
            losses[method].append((origin, adjusted_loss(first, prediction)))

    first_sums: dict[str, float] = defaultdict(float)
    second_sums: dict[str, float] = defaultdict(float)
    history_counts: dict[str, int] = defaultdict(int)
    cold_start_rows = 0
    history_choice_dates = {"model_a": 0, "model_b": 0}
    for date in sorted(by_date):
        first_history = accumulated_official_mean(first_sums, history_counts)
        second_history = accumulated_official_mean(second_sums, history_counts)
        if first_history is None or second_history is None:
            chosen = "model_a"
            cold_start_rows += len(by_date[date])
        else:
            chosen = "model_a" if first_history <= second_history else "model_b"
        history_choice_dates[chosen] += 1
        for first, second in by_date[date]:
            origin = first["origin_type"]
            selected_prediction = float(first["prediction"] if chosen == "model_a" else second["prediction"])
            losses["past_only_best_single"].append((origin, adjusted_loss(first, selected_prediction)))
        for first, second in by_date[date]:
            origin = first["origin_type"]
            first_sums[origin] += adjusted_loss(first, float(first["prediction"]))
            second_sums[origin] += adjusted_loss(second, float(second["prediction"]))
            history_counts[origin] += 1

    briers = {method: official_mean(values) for method, values in losses.items()}
    best_side = "model_a" if briers["model_a"] <= briers["model_b"] else "model_b"
    best_brier = briers[best_side]
    briers["best_single"] = best_brier
    brier_indices: dict[str, float] = {}
    for method, value in briers.items():
        index, reason = brier_index(value)
        if index is None:
            raise ValueError(f"undefined aggregation BI for {method}: {reason}")
        brier_indices[method] = index
    gains: dict[str, float | None]
    if best_brier <= 0:
        gains = {method: None for method in METHODS}
    else:
        gains = {method: (best_brier - briers[method]) / best_brier for method in METHODS}
    return {
        "adjusted_brier": briers,
        "brier_index": brier_indices,
        "best_single_side": best_side,
        "gain_fraction_vs_best_single": gains,
        "n_dates": len(by_date),
        "date_min": min(by_date),
        "date_max": max(by_date),
        "past_only_diagnostic": {
            "cold_start_rows": cold_start_rows,
            "model_a_choice_dates": history_choice_dates["model_a"],
            "model_b_choice_dates": history_choice_dates["model_b"],
            "uses_only_prior_forecast_dates": True,
            "resolution_aware": False,
        },
    }


def dependence_support(
    first_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    second_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    common: list[tuple[str, ...]],
    near_bi_gap: float,
    high_loss_threshold: float,
) -> dict[str, Any]:
    if not common:
        raise ValueError("dependence support cannot be empty")
    loss_a = [adjusted_loss(first_panel[key], float(first_panel[key]["prediction"])) for key in common]
    loss_b = [adjusted_loss(second_panel[key], float(second_panel[key]["prediction"])) for key in common]
    origins = [first_panel[key]["origin_type"] for key in common]
    pog = adjusted_pog(loss_a, loss_b)
    lift, _, _, _, _, lift_reason = high_loss_lift(loss_a, loss_b, high_loss_threshold)
    correlation, correlation_reason = pearson_correlation(loss_a, loss_b)
    variation = total_variation(
        [float(first_panel[key]["prediction"]) for key in common],
        [float(second_panel[key]["prediction"]) for key in common],
    )
    brier_a = official_mean(zip(origins, loss_a))
    brier_b = official_mean(zip(origins, loss_b))
    bi_a, bi_reason_a = brier_index(brier_a)
    bi_b, bi_reason_b = brier_index(brier_b)
    if bi_a is None or bi_b is None:
        raise ValueError(f"undefined train-fold BI: model_a={bi_reason_a}, model_b={bi_reason_b}")
    bi_gap = abs(bi_a - bi_b)
    return {
        "near_bi": bi_gap <= near_bi_gap,
        "bi_gap": bi_gap,
        "model_a_bi": bi_a,
        "model_b_bi": bi_b,
        "metrics": {
            "adjusted_pog": {"raw": pog, "complementarity": pog, "reason": ""},
            "high_loss_lift": {
                "raw": lift,
                "complementarity": None if lift is None else 1 - lift,
                "reason": lift_reason,
            },
            "adjusted_loss_corr": {
                "raw": correlation,
                "complementarity": None if correlation is None else -correlation,
                "reason": correlation_reason,
            },
            "total_variation": {
                "raw": variation,
                "complementarity": variation,
                "reason": "",
            },
        },
    }


def event_fold(source: str, event_id: str, seed: int) -> str:
    token = f"{seed}|{source.casefold()}|{event_id}".encode("utf-8")
    value = int.from_bytes(hashlib.sha256(token).digest()[:8], "big")
    return "A" if value % 2 == 0 else "B"


def weighted_average(records: list[dict[str, Any]], field: str, weight_field: str) -> float | None:
    values = [(record[field], record[weight_field]) for record in records if record.get(field) is not None]
    total = sum(weight for _, weight in values)
    return sum(value * weight for value, weight in values) / total if total else None


def aggregate_cross_fit_records(
    base_point: Mapping[str, Any],
    records: list[dict[str, Any]],
    sample: str,
) -> dict[str, Any]:
    if not records:
        raise ValueError("cross-fit aggregation requires at least one fold record")
    test_total = sum(record["n_test"] for record in records)
    train_total = sum(record["n_train"] for record in records)
    metric_values: dict[str, dict[str, float | None]] = {}
    for metric in DIVERSITY_METRICS:
        metric_records = [
            {
                "raw": record["metrics"][metric]["raw"],
                "complementarity": record["metrics"][metric]["complementarity"],
                "weight": record["n_train"],
            }
            for record in records
        ]
        metric_values[metric] = {
            "raw": weighted_average(metric_records, "raw", "weight"),
            "complementarity": weighted_average(metric_records, "complementarity", "weight"),
        }

    brier_methods = ("model_a", "model_b", *METHODS)
    adjusted_briers = {
        method: weighted_average(
            [{"value": record["adjusted_brier"][method], "weight": record["n_test"]} for record in records],
            "value",
            "weight",
        )
        for method in brier_methods
    }
    brier_indices = {
        method: weighted_average(
            [{"value": record["brier_index"][method], "weight": record["n_test"]} for record in records],
            "value",
            "weight",
        )
        for method in brier_methods
    }
    gains = {
        method: weighted_average(
            [{"value": record["gain_fraction_vs_best_single"][method], "weight": record["n_test"]} for record in records],
            "value",
            "weight",
        )
        for method in METHODS
    }
    best_sides = {record["best_single_side"] for record in records}
    return {
        **{key: base_point[key] for key in ("model_a", "model_b", "family_a", "family_b", "pair_group", "n_dates", "date_min", "date_max")},
        "n_overlap": test_total,
        "near_bi": sample == "near_bi",
        "bi_gap": weighted_average(
            [{"value": record["train_bi_gap"], "weight": record["n_train"]} for record in records],
            "value",
            "weight",
        ),
        "metrics": metric_values,
        "adjusted_brier": adjusted_briers,
        "brier_index": brier_indices,
        "best_single_side": next(iter(best_sides)) if len(best_sides) == 1 else "mixed",
        "gain_fraction_vs_best_single": gains,
        "past_only_diagnostic": {
            "cold_start_rows": sum(record["past_only_diagnostic"]["cold_start_rows"] for record in records),
            "model_a_choice_dates": sum(record["past_only_diagnostic"]["model_a_choice_dates"] for record in records),
            "model_b_choice_dates": sum(record["past_only_diagnostic"]["model_b_choice_dates"] for record in records),
            "uses_only_prior_forecast_dates": True,
            "resolution_aware": False,
        },
        "cross_fit": {
            "sample": sample,
            "included_fold_count": len(records),
            "train_near_bi_fold_count": sum(record["train_near_bi"] for record in records),
            "train_target_rows": train_total,
            "test_target_rows": test_total,
            "fold_ids": [record["fold_id"] for record in records],
        },
    }


def summarize_explicit_samples(
    eligible_points: list[dict[str, Any]],
    near_bi_points: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for group in ("all", *PAIR_GROUPS):
        for sample, points in (("eligible", eligible_points), ("near_bi", near_bi_points)):
            group_points = points if group == "all" else [point for point in points if point["pair_group"] == group]
            for method in METHODS:
                valid = [point for point in group_points if point["gain_fraction_vs_best_single"].get(method) is not None]
                gains = [point["gain_fraction_vs_best_single"][method] for point in valid]
                weights = [point["n_overlap"] for point in valid]
                weight_total = sum(weights)
                output.append(
                    {
                        "pair_group": group,
                        "sample": sample,
                        "method": method,
                        "pair_count": len(valid),
                        "pair_event_cells": weight_total,
                        "positive_pairs": sum(gain > 0 for gain in gains),
                        "positive_pair_share": sum(gain > 0 for gain in gains) / len(gains) if gains else None,
                        "macro_mean_gain_fraction": sum(gains) / len(gains) if gains else None,
                        "support_weighted_gain_fraction": (
                            sum(gain * weight for gain, weight in zip(gains, weights)) / weight_total if weight_total else None
                        ),
                        "median_gain_fraction": percentile(gains, 0.5) if gains else None,
                        "p10_gain_fraction": percentile(gains, 0.1) if gains else None,
                        "p90_gain_fraction": percentile(gains, 0.9) if gains else None,
                    }
                )
    return output


def build_cross_fit(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    pair_rows: list[dict[str, str]],
    base_points: list[dict[str, Any]],
    ec_weight: float,
    piecewise_threshold: float,
    split_seeds: list[int],
    minimum_fold_overlap: int,
    near_bi_gap: float,
    high_loss_threshold: float,
) -> dict[str, Any]:
    if not split_seeds:
        raise ValueError("cross-fit requires at least one split seed")
    base_by_pair = {(point["model_a"], point["model_b"]): point for point in base_points}
    eligible_points: list[dict[str, Any]] = []
    near_bi_points: list[dict[str, Any]] = []
    directional_points = {
        "a_to_b": {"eligible_points": [], "near_bi_points": []},
        "b_to_a": {"eligible_points": [], "near_bi_points": []},
    }
    all_events: set[tuple[str, str]] = set()
    pair_fold_records = 0
    near_bi_fold_records = 0
    minimum_observed_train_rows: int | None = None
    minimum_observed_test_rows: int | None = None

    for pair_row in pair_rows:
        first_name = pair_row["model_a"]
        second_name = pair_row["model_b"]
        first_panel = panel[first_name]
        second_panel = panel[second_name]
        common = sorted(set(first_panel) & set(second_panel))
        for key in common:
            all_events.add((key[1].casefold(), key[2]))
        records: list[dict[str, Any]] = []
        for repetition, seed in enumerate(split_seeds, start=1):
            split = {"A": [], "B": []}
            for key in common:
                event = (key[1].casefold(), key[2])
                split[event_fold(*event, seed)].append(key)
            for train_fold, test_fold in (("A", "B"), ("B", "A")):
                train_keys = split[train_fold]
                test_keys = split[test_fold]
                if len(train_keys) < minimum_fold_overlap or len(test_keys) < minimum_fold_overlap:
                    raise ValueError(
                        f"cross-fit support below {minimum_fold_overlap} for {first_name} x {second_name} "
                        f"at seed {seed}: train={len(train_keys)}, test={len(test_keys)}"
                    )
                train = dependence_support(
                    first_panel,
                    second_panel,
                    train_keys,
                    near_bi_gap,
                    high_loss_threshold,
                )
                test = score_aggregation_support(
                    first_panel,
                    second_panel,
                    test_keys,
                    ec_weight,
                    piecewise_threshold,
                )
                record = {
                    "fold_id": f"split_{repetition:02d}_seed_{seed}__{train_fold}_train__{test_fold}_test",
                    "split_repetition": repetition,
                    "split_seed": seed,
                    "train_fold": train_fold,
                    "test_fold": test_fold,
                    "model_a": first_name,
                    "model_b": second_name,
                    "family_a": family(first_name),
                    "family_b": family(second_name),
                    "pair_group": pair_group(first_name, second_name),
                    "n_train": len(train_keys),
                    "n_test": len(test_keys),
                    "n_train_events": len({(key[1].casefold(), key[2]) for key in train_keys}),
                    "n_test_events": len({(key[1].casefold(), key[2]) for key in test_keys}),
                    "train_near_bi": train["near_bi"],
                    "train_bi_gap": train["bi_gap"],
                    "train_model_a_bi": train["model_a_bi"],
                    "train_model_b_bi": train["model_b_bi"],
                    "metrics": train["metrics"],
                    **test,
                }
                records.append(record)
                pair_fold_records += 1
                near_bi_fold_records += int(record["train_near_bi"])
                minimum_observed_train_rows = min(
                    minimum_observed_train_rows or record["n_train"], record["n_train"]
                )
                minimum_observed_test_rows = min(
                    minimum_observed_test_rows or record["n_test"], record["n_test"]
                )
        base = base_by_pair[(first_name, second_name)]
        eligible_points.append(aggregate_cross_fit_records(base, records, "eligible"))
        qualifying = [record for record in records if record["train_near_bi"]]
        if qualifying:
            near_bi_points.append(aggregate_cross_fit_records(base, qualifying, "near_bi"))

        for direction_id, train_fold in (("a_to_b", "A"), ("b_to_a", "B")):
            direction_records = [record for record in records if record["train_fold"] == train_fold]
            directional_points[direction_id]["eligible_points"].append(
                aggregate_cross_fit_records(base, direction_records, "eligible")
            )
            qualifying_direction = [record for record in direction_records if record["train_near_bi"]]
            if qualifying_direction:
                directional_points[direction_id]["near_bi_points"].append(
                    aggregate_cross_fit_records(base, qualifying_direction, "near_bi")
                )

    assignment_lines = [
        f"{seed}\t{source}\t{event_id}\t{event_fold(source, event_id, seed)}"
        for seed in split_seeds
        for source, event_id in sorted(all_events)
    ]
    assignment_sha = hashlib.sha256(("\n".join(assignment_lines) + "\n").encode("utf-8")).hexdigest()
    fold_a_events = [
        sum(event_fold(source, event_id, seed) == "A" for source, event_id in all_events)
        for seed in split_seeds
    ]
    fold_b_events = [len(all_events) - count for count in fold_a_events]
    expected_combined_directions = 2 * len(split_seeds)
    return {
        "schema_version": "2.0.0",
        "evaluation": "ten-repeat two-fold event-level cross-fit",
        "split": {
            "seed": split_seeds[0],
            "seeds": split_seeds,
            "repetitions": len(split_seeds),
            "unit": "(source, event_id); every date and horizon for an event stays in one fold",
            "assignment": "SHA-256(seed|lowercase source|event_id) parity",
            "assignment_sha256": assignment_sha,
            "folds": ["A_train__B_test", "B_train__A_test"],
            "minimum_train_target_rows": minimum_fold_overlap,
            "minimum_test_target_rows": minimum_fold_overlap,
        },
        "leakage_controls": {
            "dependence_signal": "train fold only",
            "near_bi": "train-fold BI gap only",
            "aggregation_gain": "opposite test fold only",
            "event_disjoint": True,
            "outcomes_used_to_form_current_pool": False,
            "best_single_role": "test-fold hindsight benchmark only; never used to form a pool",
        },
        "audit": {
            "unique_events": len(all_events),
            "fold_a_events_by_repetition": fold_a_events,
            "fold_b_events_by_repetition": fold_b_events,
            "pair_fold_records": pair_fold_records,
            "eligible_pairs": len(eligible_points),
            "near_bi_pairs_any_train_fold": len(near_bi_points),
            "near_bi_fold_records": near_bi_fold_records,
            "pairs_near_bi_in_all_directions": sum(
                point["cross_fit"]["included_fold_count"] == expected_combined_directions
                for point in near_bi_points
            ),
            "minimum_observed_train_rows": minimum_observed_train_rows,
            "minimum_observed_test_rows": minimum_observed_test_rows,
        },
        "summary": summarize_explicit_samples(eligible_points, near_bi_points),
        "eligible_points": eligible_points,
        "near_bi_points": near_bi_points,
        "directional_points": directional_points,
    }


def build_payload(
    panel_path: Path,
    pair_path: Path,
    ec_weight: float,
    piecewise_threshold: float,
    split_seed: int = 20260825,
    split_repetitions: int = 10,
    minimum_fold_overlap: int = 50,
) -> dict[str, Any]:
    if split_repetitions < 1:
        raise ValueError("split_repetitions must be positive")
    split_seeds = [split_seed + offset for offset in range(split_repetitions)]
    archived_pair_rows = read_pairs(pair_path)
    preferred_orientation: dict[frozenset[str], tuple[str, str]] = {}
    for row in archived_pair_rows:
        first_name = resolve_model_alias(row["model_a"])
        second_name = resolve_model_alias(row["model_b"])
        if first_name != second_name:
            preferred_orientation.setdefault(
                frozenset((first_name, second_name)),
                (first_name, second_name),
            )
    panel, alias_audit = read_panel(panel_path)
    models = set(panel)
    pair_rows, fold_ineligible_pairs = eligible_pair_rows(
        panel,
        minimum_overlap=50,
        minimum_fold_overlap=minimum_fold_overlap,
        split_seeds=split_seeds,
        preferred_orientation=preferred_orientation,
    )
    points: list[dict[str, Any]] = []

    for pair_row in pair_rows:
        first_name = pair_row["model_a"]
        second_name = pair_row["model_b"]
        first_panel = panel[first_name]
        second_panel = panel[second_name]
        common = sorted(set(first_panel) & set(second_panel))
        dependence = dependence_support(
            first_panel,
            second_panel,
            common,
            near_bi_gap=2.0,
            high_loss_threshold=0.25,
        )
        aggregation = score_aggregation_support(
            first_panel,
            second_panel,
            common,
            ec_weight,
            piecewise_threshold,
        )

        points.append(
            {
                "model_a": first_name,
                "model_b": second_name,
                "family_a": family(first_name),
                "family_b": family(second_name),
                "pair_group": pair_group(first_name, second_name),
                "n_overlap": len(common),
                "n_dates": aggregation["n_dates"],
                "date_min": aggregation["date_min"],
                "date_max": aggregation["date_max"],
                "near_bi": dependence["near_bi"],
                "bi_gap": dependence["bi_gap"],
                "metrics": dependence["metrics"],
                "adjusted_brier": aggregation["adjusted_brier"],
                "brier_index": aggregation["brier_index"],
                "best_single_side": aggregation["best_single_side"],
                "gain_fraction_vs_best_single": aggregation["gain_fraction_vs_best_single"],
                "past_only_diagnostic": aggregation["past_only_diagnostic"],
            }
        )

    group_counts = {group: sum(point["pair_group"] == group for point in points) for group in PAIR_GROUPS}
    cross_fit = build_cross_fit(
        panel,
        pair_rows,
        points,
        ec_weight,
        piecewise_threshold,
        split_seeds,
        minimum_fold_overlap,
        near_bi_gap=2.0,
        high_loss_threshold=0.25,
    )
    return {
        "schema_version": "2.2.0",
        "generated_at": "2026-08-26",
        "scope": "official_full",
        "model_scope": {
            "definition": "exact merged model versions whose names begin with GPT, Claude, Gemini, Qwen, DeepSeek, or Kimi",
            "gpt_models": sorted(model for model in models if family(model) == "GPT"),
            "claude_models": sorted(model for model in models if family(model) == "Claude"),
            "gemini_models": sorted(model for model in models if family(model) == "Gemini"),
            "qwen_models": sorted(model for model in models if family(model) == "Qwen"),
            "deepseek_models": sorted(model for model in models if family(model) == "DeepSeek"),
            "kimi_models": sorted(model for model in models if family(model) == "Kimi"),
        },
        "pair_scope": {
            "eligible_pair_count": len(points),
            "near_bi_pair_count": sum(point["near_bi"] for point in points),
            "group_counts": group_counts,
            "minimum_overlap": 50,
            "fold_ineligible_pair_count": fold_ineligible_pairs,
            "common_support": "each pair and every method use the exact same pair-common targets",
        },
        "methods": {
            "ec_w0_56": {
                "label": "EC · w = 0.56",
                "formula": "sigmoid(0.56 * (logit(p1) + logit(p2)))",
                "outcome_blind": True,
            },
            "simple_mean": {"label": "Simple Mean", "formula": "(p1 + p2) / 2", "outcome_blind": True},
            "log_odds_mean": {
                "label": "Log-odds Mean",
                "formula": "sigmoid((logit(p1) + logit(p2)) / 2)",
                "outcome_blind": True,
            },
            "piecewise_odds": {
                "label": "Piecewise Odds",
                "formula": "threshold-5 piecewise transform of logit(p1) + logit(p2)",
                "threshold": piecewise_threshold,
                "outcome_blind": True,
            },
            "best_single": {
                "label": "Best Single",
                "formula": "lower adjusted Brier of the two constituents on all pair-common targets",
                "outcome_blind": False,
                "role": "hindsight benchmark; not a deployable aggregation rule",
            },
            "past_only_best_single": {
                "label": "Past-only Best Single",
                "formula": "at each date, select the constituent with lower adjusted Brier on earlier common forecast dates",
                "outcome_blind": True,
                "role": "round-ordered diagnostic",
                "resolution_aware": False,
            },
        },
        "outcome": {
            "id": "adjusted_brier_gain_fraction_vs_pair_best_single",
            "formula": "(best_single_adjusted_brier - method_adjusted_brier) / best_single_adjusted_brier",
            "positive_means": "method improves on the hindsight-better constituent on identical support",
            "pair_summary_weighting": "pair gain fractions weighted by n_overlap; pair-event cells are duplicated across pairs",
            "score_weighting": "equal-weight mean of Dataset and Market adjusted-Brier strata within each pair",
        },
        "brier_index": {
            "formula": "(1 - sqrt(adjusted_brier)) * 100",
            "higher_is_better": True,
            "cross_fit_aggregation": "test-support-weighted mean of fold-level BI across 10 random A/B repetitions and both directions",
        },
        "near_bi": {
            "threshold_bi_points": 2.0,
            "definition": "absolute common-support Brier Index gap <= 2.0 points",
        },
        "provenance": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "pair_metrics": str(pair_path),
            "pair_metrics_sha256": sha256_file(pair_path),
            "pair_metrics_role": "preserves historical model_a/model_b orientation only; pair eligibility, dependence, and gains are recomputed from the alias-resolved panel",
            "merged_model_rule": "one outcome-blind representative configuration per exact model version; stitch GPT-4o alias history into GPT-4o-2024-05-13 before pair construction and fold assignment",
            "model_alias_audit": alias_audit,
            "resolution_time_available": False,
        },
        "summary": summarize(points),
        "points": points,
        "cross_fit": cross_fit,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel_model_versions.csv"))
    parser.add_argument("--pair-metrics", type=Path, default=Path("data/derived/global_baseline_pair_metrics.csv.gz"))
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument("--split-seed", type=int, default=20260825)
    parser.add_argument("--split-repetitions", type=int, default=10)
    parser.add_argument("--minimum-fold-overlap", type=int, default=50)
    parser.add_argument("--output", type=Path, default=Path("site/public/data/pair-aggregation/all-six-family-pairs.json"))
    args = parser.parse_args()
    payload = build_payload(
        panel_path=args.panel,
        pair_path=args.pair_metrics,
        ec_weight=args.ec_weight,
        piecewise_threshold=args.piecewise_threshold,
        split_seed=args.split_seed,
        split_repetitions=args.split_repetitions,
        minimum_fold_overlap=args.minimum_fold_overlap,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "pairs": payload["pair_scope"]["eligible_pair_count"],
                "near_bi_pairs": payload["pair_scope"]["near_bi_pair_count"],
                "groups": payload["pair_scope"]["group_counts"],
                "cross_fit": payload["cross_fit"]["audit"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
