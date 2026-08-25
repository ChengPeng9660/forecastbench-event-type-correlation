"""Build the all-pair GPT/Claude aggregation benchmark used by the Site.

The input is the post-merge ForecastBench model-version panel.  Every eligible
GPT-GPT, Claude-Claude, and GPT-Claude pair is evaluated on its exact common
support.  Four outcome-blind pools are compared with the hindsight better
single model on that same support.  A round-ordered past-only single-model
selector is retained as a diagnostic, but it is not called resolution-aware
because this compact panel does not contain actual outcome-resolution times.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping


KEY = ("date", "source", "event_id", "horizon")
ORIGINS = ("Dataset", "Market")
METHODS = (
    "ec_w0_56",
    "simple_mean",
    "log_odds_mean",
    "piecewise_odds",
    "best_single",
    "past_only_best_single",
)


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
    if lowered.startswith("gpt"):
        return "GPT"
    if lowered.startswith("claude"):
        return "Claude"
    return None


def pair_group(first: str, second: str) -> str:
    first_family = family(first)
    second_family = family(second)
    if first_family == second_family == "GPT":
        return "gpt_gpt"
    if first_family == second_family == "Claude":
        return "claude_claude"
    if {first_family, second_family} == {"GPT", "Claude"}:
        return "gpt_claude"
    raise ValueError(f"unsupported pair: {first} x {second}")


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


def read_panel(path: Path, models: set[str]) -> dict[str, dict[tuple[str, ...], dict[str, str]]]:
    output: dict[str, dict[tuple[str, ...], dict[str, str]]] = defaultdict(dict)
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {*KEY, "model_name", "prediction", "outcome", "origin_type", "question_fixed_effect", "normalization_term"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"merged panel missing fields: {sorted(missing)}")
        for row in reader:
            model = row["model_name"].strip()
            if model not in models:
                continue
            key = tuple(row[field] for field in KEY)
            if key in output[model]:
                raise ValueError(f"duplicate model-target row for {model}: {key}")
            output[model][key] = row
    absent = models - set(output)
    if absent:
        raise ValueError(f"models missing from merged panel: {sorted(absent)}")
    return dict(output)


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
    for group in ("all", "gpt_gpt", "claude_claude", "gpt_claude"):
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


def build_payload(panel_path: Path, pair_path: Path, ec_weight: float, piecewise_threshold: float) -> dict[str, Any]:
    pair_rows = read_pairs(pair_path)
    models = {row[name] for row in pair_rows for name in ("model_a", "model_b")}
    panel = read_panel(panel_path, models)
    points: list[dict[str, Any]] = []

    for metric_row in pair_rows:
        first_name = metric_row["model_a"]
        second_name = metric_row["model_b"]
        first_panel = panel[first_name]
        second_panel = panel[second_name]
        common = sorted(set(first_panel) & set(second_panel))
        if len(common) != int(metric_row["n_overlap"]):
            raise ValueError(
                f"pair support mismatch for {first_name} x {second_name}: "
                f"panel={len(common)}, metrics={metric_row['n_overlap']}"
            )

        losses: dict[str, list[tuple[str, float]]] = defaultdict(list)
        by_date: dict[str, list[tuple[dict[str, str], dict[str, str]]]] = defaultdict(list)
        for key in common:
            first = first_panel[key]
            second = second_panel[key]
            if first["outcome"] != second["outcome"] or first["origin_type"] != second["origin_type"]:
                raise ValueError(f"misaligned rows for {first_name} x {second_name}: {key}")
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
                first_prediction = float(first["prediction"])
                second_prediction = float(second["prediction"])
                selected_prediction = first_prediction if chosen == "model_a" else second_prediction
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
        if best_brier <= 0:
            gains: dict[str, float | None] = {method: None for method in METHODS}
        else:
            gains = {method: (best_brier - briers[method]) / best_brier for method in METHODS}

        points.append(
            {
                "model_a": first_name,
                "model_b": second_name,
                "family_a": family(first_name),
                "family_b": family(second_name),
                "pair_group": pair_group(first_name, second_name),
                "n_overlap": len(common),
                "n_dates": len(by_date),
                "date_min": min(by_date),
                "date_max": max(by_date),
                "near_bi": metric_row["near_bi"] == "1",
                "bi_gap": float(metric_row["bi_gap_common"]),
                "metrics": {
                    "adjusted_pog": {
                        "raw": float(metric_row["adjusted_pog"]),
                        "complementarity": float(metric_row["adjusted_pog"]),
                    },
                    "high_loss_lift": {
                        "raw": float(metric_row["adjusted_high_loss_lift_025"]),
                        "complementarity": 1 - float(metric_row["adjusted_high_loss_lift_025"]),
                    },
                    "adjusted_loss_corr": {
                        "raw": float(metric_row["adjusted_loss_pearson_corr"]),
                        "complementarity": -float(metric_row["adjusted_loss_pearson_corr"]),
                    },
                },
                "adjusted_brier": {
                    "model_a": briers["model_a"],
                    "model_b": briers["model_b"],
                    **{method: briers[method] for method in METHODS},
                },
                "best_single_side": best_side,
                "gain_fraction_vs_best_single": gains,
                "past_only_diagnostic": {
                    "cold_start_rows": cold_start_rows,
                    "model_a_choice_dates": history_choice_dates["model_a"],
                    "model_b_choice_dates": history_choice_dates["model_b"],
                    "uses_only_prior_forecast_dates": True,
                    "resolution_aware": False,
                },
            }
        )

    group_counts = {
        group: sum(point["pair_group"] == group for point in points)
        for group in ("gpt_gpt", "claude_claude", "gpt_claude")
    }
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-25",
        "scope": "official_full",
        "model_scope": {
            "definition": "exact merged model versions whose names begin with GPT or Claude",
            "gpt_models": sorted(model for model in models if family(model) == "GPT"),
            "claude_models": sorted(model for model in models if family(model) == "Claude"),
        },
        "pair_scope": {
            "eligible_pair_count": len(points),
            "near_bi_pair_count": sum(point["near_bi"] for point in points),
            "group_counts": group_counts,
            "minimum_overlap": 50,
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
        "near_bi": {
            "threshold_bi_points": 2.0,
            "definition": "absolute common-support Brier Index gap <= 2.0 points",
        },
        "provenance": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "pair_metrics": str(pair_path),
            "pair_metrics_sha256": sha256_file(pair_path),
            "merged_model_rule": "one outcome-blind representative configuration per exact model version",
            "resolution_time_available": False,
        },
        "summary": summarize(points),
        "points": points,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel_model_versions.csv"))
    parser.add_argument("--pair-metrics", type=Path, default=Path("data/derived/global_baseline_pair_metrics.csv.gz"))
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument("--output", type=Path, default=Path("site/public/data/pair-aggregation/all-gpt-claude-pairs.json"))
    args = parser.parse_args()
    payload = build_payload(args.panel, args.pair_metrics, args.ec_weight, args.piecewise_threshold)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "pairs": payload["pair_scope"]["eligible_pair_count"],
                "near_bi_pairs": payload["pair_scope"]["near_bi_pair_count"],
                "groups": payload["pair_scope"]["group_counts"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
