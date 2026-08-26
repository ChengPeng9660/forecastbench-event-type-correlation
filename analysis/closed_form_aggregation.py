"""Diagnose diversity failures and evaluate closed-form two-forecast pools.

The experiment uses the released ten-repeat, event-disjoint two-fold split.
Every fitted weight, anchor choice, dependence metric, and Near-BI decision is
formed on the training fold.  The opposite fold is used only for evaluation.

For an anchor forecast p0 and partner forecast p1, define d = p1 - p0 and
r = y - p0.  A linear pool q(alpha) = p0 + alpha*d has exact Brier improvement
over the anchor equal to 2*alpha*C - alpha**2*D, where C = E[r*d] and
D = E[d**2].  Hence alpha = clip(C / D, 0, 1) is the closed-form constrained
training optimum.  A one-standard-error lower-confidence version replaces C
with max(C - SE(C), 0) before division by D.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

from analysis.metrics import brier_index
from analysis.pair_aggregation import (
    adjusted_loss,
    dependence_support,
    event_fold,
    family,
    official_mean,
    pair_group,
    percentile,
    predictions,
    read_panel,
    sha256_file,
)
from analysis.polymarket_aggregation import BASELINE_NAME, build_freeze_panel, read_freeze_snapshots


DEPLOYABLE_METHODS = (
    "ec_w0_56",
    "simple_mean",
    "log_odds_mean",
    "piecewise_odds",
    "cf_linear",
    "cf_lcb_1se",
    "cf_lcb_95",
    "cf_directional",
    "cf_directional_lcb_1se",
)
DIAGNOSTIC_METHODS = (
    "anchor",
    "partner",
    "best_single",
    "oracle_linear",
    "oracle_directional",
)
ALL_METHODS = (*DIAGNOSTIC_METHODS, *DEPLOYABLE_METHODS)
COMPLEMENTARITY_METRICS = ("adjusted_pog", "high_loss_lift", "adjusted_loss_corr")


def _weighted_rows(
    panel: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: Iterable[tuple[str, ...]],
) -> list[tuple[tuple[str, ...], Mapping[str, str], float]]:
    ordered = list(keys)
    counts = Counter(panel[key]["origin_type"] for key in ordered)
    origins = [origin for origin in ("Dataset", "Market") if counts[origin]]
    if not origins:
        raise ValueError("support has no Dataset or Market observations")
    return [
        (key, panel[key], 1 / (len(origins) * counts[panel[key]["origin_type"]]))
        for key in ordered
    ]


def single_brier(
    panel: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: Iterable[tuple[str, ...]],
) -> float:
    return official_mean(
        (panel[key]["origin_type"], adjusted_loss(panel[key], float(panel[key]["prediction"])))
        for key in keys
    )


def forecast_diagnostics(
    anchor: Mapping[tuple[str, ...], Mapping[str, str]],
    partner: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
) -> dict[str, float]:
    weighted = _weighted_rows(anchor, keys)
    alignment = 0.0
    disagreement = 0.0
    anchor_bias = 0.0
    partner_bias = 0.0
    anchor_extremity = 0.0
    partner_extremity = 0.0
    partner_win_weight = 0.0
    contributions: list[tuple[tuple[str, str], float, float, float, float]] = []
    upward_alignment = 0.0
    upward_disagreement = 0.0
    downward_alignment = 0.0
    downward_disagreement = 0.0
    for key, row, weight in weighted:
        p0 = float(row["prediction"])
        p1 = float(partner[key]["prediction"])
        outcome = float(row["outcome"])
        delta = p1 - p0
        contribution = (outcome - p0) * delta
        alignment += weight * contribution
        disagreement += weight * delta * delta
        if delta >= 0:
            upward_alignment += weight * contribution
            upward_disagreement += weight * delta * delta
        else:
            downward_alignment += weight * contribution
            downward_disagreement += weight * delta * delta
        anchor_bias += weight * (p0 - outcome)
        partner_bias += weight * (p1 - outcome)
        anchor_extremity += weight * abs(p0 - 0.5)
        partner_extremity += weight * abs(p1 - 0.5)
        partner_win_weight += weight * ((p1 - outcome) ** 2 < (p0 - outcome) ** 2)
        contributions.append(
            (
                (key[1].casefold(), key[2]),
                weight,
                contribution,
                contribution if delta >= 0 else 0.0,
                contribution if delta < 0 else 0.0,
            )
        )

    def cluster_se(component_index: int, component_mean: float) -> float:
        by_event: dict[tuple[str, str], float] = defaultdict(float)
        for values in contributions:
            event, weight = values[0], values[1]
            by_event[event] += weight * (values[component_index] - component_mean)
        event_count = len(by_event)
        return (
            math.sqrt(event_count / (event_count - 1) * sum(value * value for value in by_event.values()))
            if event_count > 1 else 0.0
        )

    event_count = len({values[0] for values in contributions})
    alignment_se = cluster_se(2, alignment)
    upward_alignment_se = cluster_se(3, upward_alignment)
    downward_alignment_se = cluster_se(4, downward_alignment)
    raw_alpha = alignment / disagreement if disagreement > 0 else 0.0
    oracle_alpha = min(1.0, max(0.0, raw_alpha))

    def component_alpha(component_c: float, component_d: float, component_se: float, z: float) -> float:
        return (
            min(1.0, max(0.0, (component_c - z * component_se) / component_d))
            if component_d > 0 else 0.0
        )

    return {
        "alignment_c": alignment,
        "disagreement_d": disagreement,
        "alignment_se": alignment_se,
        "alpha_raw": raw_alpha,
        "alpha_clipped": oracle_alpha,
        "alpha_lcb_1se": min(1.0, max(0.0, (alignment - alignment_se) / disagreement)) if disagreement > 0 else 0.0,
        "alpha_lcb_95": min(1.0, max(0.0, (alignment - 1.645 * alignment_se) / disagreement)) if disagreement > 0 else 0.0,
        "upward_alignment_c": upward_alignment,
        "upward_disagreement_d": upward_disagreement,
        "upward_alignment_se": upward_alignment_se,
        "upward_alpha_clipped": component_alpha(upward_alignment, upward_disagreement, 0.0, 0.0),
        "upward_alpha_lcb_1se": component_alpha(
            upward_alignment, upward_disagreement, upward_alignment_se, 1.0
        ),
        "downward_alignment_c": downward_alignment,
        "downward_disagreement_d": downward_disagreement,
        "downward_alignment_se": downward_alignment_se,
        "downward_alpha_clipped": component_alpha(
            downward_alignment, downward_disagreement, 0.0, 0.0
        ),
        "downward_alpha_lcb_1se": component_alpha(
            downward_alignment, downward_disagreement, downward_alignment_se, 1.0
        ),
        "anchor_bias": anchor_bias,
        "partner_bias": partner_bias,
        "anchor_extremity": anchor_extremity,
        "partner_extremity": partner_extremity,
        "partner_win_share": partner_win_weight,
        "event_count": float(event_count),
    }


def score_methods(
    anchor: Mapping[tuple[str, ...], Mapping[str, str]],
    partner: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
    train_diagnostics: Mapping[str, float],
    test_diagnostics: Mapping[str, float],
    ec_weight: float,
    piecewise_threshold: float,
) -> dict[str, dict[str, float]]:
    losses: dict[str, list[tuple[str, float]]] = defaultdict(list)
    alphas = {
        "cf_linear": train_diagnostics["alpha_clipped"],
        "cf_lcb_1se": train_diagnostics["alpha_lcb_1se"],
        "cf_lcb_95": train_diagnostics["alpha_lcb_95"],
        "oracle_linear": test_diagnostics["alpha_clipped"],
    }
    directional_alphas = {
        "cf_directional": (
            train_diagnostics["upward_alpha_clipped"],
            train_diagnostics["downward_alpha_clipped"],
        ),
        "cf_directional_lcb_1se": (
            train_diagnostics["upward_alpha_lcb_1se"],
            train_diagnostics["downward_alpha_lcb_1se"],
        ),
        "oracle_directional": (
            test_diagnostics["upward_alpha_clipped"],
            test_diagnostics["downward_alpha_clipped"],
        ),
    }
    for key in keys:
        first = anchor[key]
        second = partner[key]
        p0 = float(first["prediction"])
        p1 = float(second["prediction"])
        origin = first["origin_type"]
        losses["anchor"].append((origin, adjusted_loss(first, p0)))
        losses["partner"].append((origin, adjusted_loss(first, p1)))
        for method, prediction in predictions(p0, p1, ec_weight, piecewise_threshold).items():
            losses[method].append((origin, adjusted_loss(first, prediction)))
        for method, alpha in alphas.items():
            prediction = p0 + alpha * (p1 - p0)
            losses[method].append((origin, adjusted_loss(first, prediction)))
        for method, (upward_alpha, downward_alpha) in directional_alphas.items():
            alpha = upward_alpha if p1 >= p0 else downward_alpha
            prediction = p0 + alpha * (p1 - p0)
            losses[method].append((origin, adjusted_loss(first, prediction)))

    briers = {method: official_mean(values) for method, values in losses.items()}
    briers["best_single"] = min(briers["anchor"], briers["partner"])
    output: dict[str, dict[str, float]] = {}
    for method in ALL_METHODS:
        adjusted_brier = briers[method]
        index, reason = brier_index(adjusted_brier)
        if index is None:
            raise ValueError(f"undefined BI for {method}: {reason}")
        output[method] = {
            "adjusted_brier": adjusted_brier,
            "anchor_adjusted_brier": briers["anchor"],
            "best_single_adjusted_brier": briers["best_single"],
            "brier_index": index,
            "gain_vs_anchor": (
                (briers["anchor"] - adjusted_brier) / briers["anchor"]
                if briers["anchor"] > 0 else math.nan
            ),
            "gain_vs_best_single": (
                (briers["best_single"] - adjusted_brier) / briers["best_single"]
                if briers["best_single"] > 0 else math.nan
            ),
        }
    return output


def _rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=values.__getitem__)
    result = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        rank = (start + end - 1) / 2
        for position in range(start, end):
            result[order[position]] = rank
        start = end
    return result


def correlation(
    first: list[float | None],
    second: list[float | None],
    *,
    spearman: bool = False,
) -> float | None:
    pairs = [
        (a, b)
        for a, b in zip(first, second)
        if a is not None and b is not None and math.isfinite(a) and math.isfinite(b)
    ]
    if len(pairs) < 3:
        return None
    x = [pair[0] for pair in pairs]
    y = [pair[1] for pair in pairs]
    if spearman:
        x = _rank(x)
        y = _rank(y)
    mean_x = sum(x) / len(x)
    mean_y = sum(y) / len(y)
    numerator = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
    scale_x = math.sqrt(sum((a - mean_x) ** 2 for a in x))
    scale_y = math.sqrt(sum((b - mean_y) ** 2 for b in y))
    return numerator / (scale_x * scale_y) if scale_x and scale_y else None


def residualize(values: list[float], controls: list[float]) -> list[float]:
    if len(values) != len(controls):
        raise ValueError("residualization inputs must have equal length")
    mean_value = sum(values) / len(values)
    mean_control = sum(controls) / len(controls)
    denominator = sum((value - mean_control) ** 2 for value in controls)
    slope = (
        sum((control - mean_control) * (value - mean_value) for control, value in zip(controls, values))
        / denominator
        if denominator else 0.0
    )
    return [
        value - (mean_value + slope * (control - mean_control))
        for value, control in zip(values, controls)
    ]


def _method_weight(method: str, diagnostics: Mapping[str, float]) -> float | None:
    return {
        "anchor": 0.0,
        "partner": 1.0,
        "simple_mean": 0.5,
        "cf_linear": diagnostics["alpha_clipped"],
        "cf_lcb_1se": diagnostics["alpha_lcb_1se"],
        "cf_lcb_95": diagnostics["alpha_lcb_95"],
        "oracle_linear": diagnostics["alpha_clipped"],
    }.get(method)


def evaluate_pair(
    experiment: str,
    model_a: str,
    model_b: str,
    first_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    second_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    split_seeds: list[int],
    minimum_fold_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> list[dict[str, Any]]:
    common = sorted(set(first_panel) & set(second_panel))
    output: list[dict[str, Any]] = []
    for repetition, seed in enumerate(split_seeds, start=1):
        split = {"A": [], "B": []}
        for key in common:
            split[event_fold(key[1], key[2], seed)].append(key)
        for train_fold, test_fold in (("A", "B"), ("B", "A")):
            train_keys = split[train_fold]
            test_keys = split[test_fold]
            if min(len(train_keys), len(test_keys)) < minimum_fold_overlap:
                raise ValueError(
                    f"fold support below {minimum_fold_overlap} for {model_a} x {model_b}: "
                    f"train={len(train_keys)} test={len(test_keys)}"
                )
            dependence = dependence_support(first_panel, second_panel, train_keys, 2.0, 0.25)
            first_train_brier = single_brier(first_panel, train_keys)
            second_train_brier = single_brier(second_panel, train_keys)
            if experiment in {
                "polymarket_model",
                "same_version_freeze_exposure",
                "fixed_focal_without_freeze",
            } or first_train_brier <= second_train_brier:
                anchor_name, partner_name = model_a, model_b
                anchor_panel, partner_panel = first_panel, second_panel
            else:
                anchor_name, partner_name = model_b, model_a
                anchor_panel, partner_panel = second_panel, first_panel
            train_diag = forecast_diagnostics(anchor_panel, partner_panel, train_keys)
            test_diag = forecast_diagnostics(anchor_panel, partner_panel, test_keys)
            scores = score_methods(
                anchor_panel,
                partner_panel,
                test_keys,
                train_diag,
                test_diag,
                ec_weight,
                piecewise_threshold,
            )
            for method, score in scores.items():
                output.append(
                    {
                        "experiment": experiment,
                        "pair_id": (
                            f"{model_a} -> {model_b}"
                            if experiment == "fixed_focal_without_freeze"
                            else " x ".join(sorted((model_a, model_b), key=str.casefold))
                        ),
                        "model_a": model_a,
                        "model_b": model_b,
                        "pair_group": (
                            family(model_b).casefold()
                            if experiment == "polymarket_model" and family(model_b)
                            else pair_group(model_a, model_b)
                        ),
                        "repetition": repetition,
                        "seed": seed,
                        "train_fold": train_fold,
                        "test_fold": test_fold,
                        "n_train": len(train_keys),
                        "n_test": len(test_keys),
                        "train_near_bi": dependence["near_bi"],
                        "train_bi_gap": dependence["bi_gap"],
                        "anchor": anchor_name,
                        "partner": partner_name,
                        "train_anchor_adjusted_brier": single_brier(anchor_panel, train_keys),
                        "train_partner_adjusted_brier": single_brier(partner_panel, train_keys),
                        **{
                            f"train_{metric}_complementarity": dependence["metrics"][metric]["complementarity"]
                            for metric in COMPLEMENTARITY_METRICS
                        },
                        **{f"train_{key}": value for key, value in train_diag.items()},
                        **{f"test_{key}": value for key, value in test_diag.items()},
                        "method": method,
                        "method_partner_weight": _method_weight(
                            method,
                            test_diag if method == "oracle_linear" else train_diag,
                        ),
                        **score,
                    }
                )
    return output


def aggregate_pairs(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[(record["pair_id"], record["method"])].append(record)
    output: list[dict[str, Any]] = []
    for (pair_id, method), group in sorted(grouped.items()):
        test_total = sum(record["n_test"] for record in group)
        train_total = sum(record["n_train"] for record in group)

        def test_weighted(field: str) -> float:
            return sum(record[field] * record["n_test"] for record in group) / test_total

        def train_weighted(field: str) -> float | None:
            values = [(record[field], record["n_train"]) for record in group if record[field] is not None]
            total = sum(weight for _, weight in values)
            return sum(value * weight for value, weight in values) / total if total else None

        pooled_adjusted_brier = test_weighted("adjusted_brier")
        pooled_anchor_brier = test_weighted("anchor_adjusted_brier")
        pooled_best_brier = test_weighted("best_single_adjusted_brier")
        pooled_test_alignment = test_weighted("test_alignment_c")
        pooled_test_disagreement = test_weighted("test_disagreement_d")
        pooled_test_alpha = (
            min(1.0, max(0.0, pooled_test_alignment / pooled_test_disagreement))
            if pooled_test_disagreement > 0 else 0.0
        )
        output.append(
            {
                "experiment": group[0]["experiment"],
                "pair_id": pair_id,
                "model_a": group[0]["model_a"],
                "model_b": group[0]["model_b"],
                "pair_group": group[0]["pair_group"],
                "method": method,
                "fold_records": len(group),
                "train_target_cells": train_total,
                "test_target_cells": test_total,
                "train_near_bi_share": sum(record["train_near_bi"] for record in group) / len(group),
                "train_bi_gap": train_weighted("train_bi_gap"),
                **{
                    f"train_{metric}_complementarity": train_weighted(f"train_{metric}_complementarity")
                    for metric in COMPLEMENTARITY_METRICS
                },
                "train_alignment_c": train_weighted("train_alignment_c"),
                "train_disagreement_d": train_weighted("train_disagreement_d"),
                "train_alpha_clipped": train_weighted("train_alpha_clipped"),
                "train_alpha_lcb_1se": train_weighted("train_alpha_lcb_1se"),
                "train_alpha_lcb_95": train_weighted("train_alpha_lcb_95"),
                "test_alignment_c": test_weighted("test_alignment_c"),
                "test_disagreement_d": test_weighted("test_disagreement_d"),
                "test_alpha_clipped": test_weighted("test_alpha_clipped"),
                "test_pooled_alpha_clipped": pooled_test_alpha,
                "test_partner_win_share": test_weighted("test_partner_win_share"),
                "method_partner_weight": train_weighted("method_partner_weight"),
                "adjusted_brier": pooled_adjusted_brier,
                "anchor_adjusted_brier": pooled_anchor_brier,
                "best_single_adjusted_brier": pooled_best_brier,
                "brier_index": test_weighted("brier_index"),
                "gain_vs_anchor": (
                    (pooled_anchor_brier - pooled_adjusted_brier) / pooled_anchor_brier
                    if pooled_anchor_brier > 0 else None
                ),
                "gain_vs_best_single": (
                    (pooled_best_brier - pooled_adjusted_brier) / pooled_best_brier
                    if pooled_best_brier > 0 else None
                ),
                "mean_fold_gain_vs_anchor": test_weighted("gain_vs_anchor"),
                "mean_fold_gain_vs_best_single": test_weighted("gain_vs_best_single"),
            }
        )
    return output


def method_summary(pair_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in pair_rows:
        grouped[(row["experiment"], "all", row["method"])].append(row)
        if row["train_near_bi_share"] > 0:
            grouped[(row["experiment"], "near_bi_any", row["method"])].append(row)
    output: list[dict[str, Any]] = []
    for (experiment, sample, method), rows in sorted(grouped.items()):
        weights = [row["test_target_cells"] for row in rows]
        total = sum(weights)

        def weighted(field: str) -> float:
            return sum(row[field] * weight for row, weight in zip(rows, weights)) / total

        output.append(
            {
                "experiment": experiment,
                "sample": sample,
                "method": method,
                "pair_count": len(rows),
                "pair_event_cells": total,
                "support_weighted_brier_index": weighted("brier_index"),
                "support_weighted_gain_vs_anchor": weighted("gain_vs_anchor"),
                "support_weighted_gain_vs_best_single": weighted("gain_vs_best_single"),
                "macro_gain_vs_anchor": sum(row["gain_vs_anchor"] for row in rows) / len(rows),
                "macro_gain_vs_best_single": sum(row["gain_vs_best_single"] for row in rows) / len(rows),
                "positive_vs_anchor_share": sum(row["gain_vs_anchor"] > 0 for row in rows) / len(rows),
                "positive_vs_best_single_share": (
                    sum(row["gain_vs_best_single"] > 0 for row in rows) / len(rows)
                ),
                "median_gain_vs_anchor": percentile([row["gain_vs_anchor"] for row in rows], 0.5),
                "median_gain_vs_best_single": percentile(
                    [row["gain_vs_best_single"] for row in rows], 0.5
                ),
            }
        )
    return output


def diversity_gain_summary(pair_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for experiment in ("polymarket_model", "model_model"):
        for method in DEPLOYABLE_METHODS:
            rows = [
                row for row in pair_rows
                if row["experiment"] == experiment and row["method"] == method
            ]
            for metric in COMPLEMENTARITY_METRICS:
                x = [row[f"train_{metric}_complementarity"] for row in rows]
                for outcome in ("gain_vs_anchor", "gain_vs_best_single"):
                    y = [row[outcome] for row in rows]
                    complete = [
                        (first, second, row["train_bi_gap"])
                        for first, second, row in zip(x, y, rows)
                        if first is not None and second is not None
                    ]
                    complete_x = [value[0] for value in complete]
                    complete_y = [value[1] for value in complete]
                    gaps = [value[2] for value in complete]
                    near = [value for value in complete if value[2] <= 2.0]
                    output.append(
                        {
                            "experiment": experiment,
                            "method": method,
                            "metric": metric,
                            "outcome": outcome,
                            "n_pairs": len(rows),
                            "pearson": correlation(x, y),
                            "spearman": correlation(x, y, spearman=True),
                            "pearson_controlling_mean_bi_gap": correlation(
                                residualize(complete_x, gaps),
                                residualize(complete_y, gaps),
                            ),
                            "mean_bi_gap_le_2_pairs": len(near),
                            "pearson_mean_bi_gap_le_2": correlation(
                                [value[0] for value in near],
                                [value[1] for value in near],
                            ),
                        }
                    )
    return output


def failure_diagnostics(pair_rows: list[dict[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for experiment in ("polymarket_model", "model_model"):
        rows = [
            row for row in pair_rows
            if row["experiment"] == experiment and row["method"] == "simple_mean"
        ]
        pog_values = [row["train_adjusted_pog_complementarity"] for row in rows]
        threshold = percentile([value for value in pog_values if value is not None], 0.75)
        high_diversity = [
            row for row in rows
            if row["train_adjusted_pog_complementarity"] is not None
            and row["train_adjusted_pog_complementarity"] >= threshold
        ]
        negative = [row for row in high_diversity if row["gain_vs_anchor"] < 0]
        nonpositive_alignment = [row for row in negative if row["test_alignment_c"] <= 0]
        overmixed = [
            row for row in negative
            if row["test_alignment_c"] > 0 and row["test_pooled_alpha_clipped"] < 0.25
        ]
        unexplained = [
            row for row in negative
            if row["test_alignment_c"] > 0 and row["test_pooled_alpha_clipped"] >= 0.25
        ]
        output[experiment] = {
            "pair_count": len(rows),
            "near_bi_any_pair_count": sum(row["train_near_bi_share"] > 0 for row in rows),
            "median_train_bi_gap": percentile([row["train_bi_gap"] for row in rows], 0.5),
            "top_quartile_pog_threshold": threshold,
            "top_quartile_pair_count": len(high_diversity),
            "top_quartile_negative_simple_mean_count": len(negative),
            "top_quartile_negative_simple_mean_share": len(negative) / len(high_diversity) if high_diversity else None,
            "negative_failure_modes": {
                "nonpositive_test_alignment": len(nonpositive_alignment),
                "positive_but_equal_weight_overmixes": len(overmixed),
                "test_optimum_at_or_above_equal_weight": len(unexplained),
                "large_train_bi_gap_gt_2": sum(row["train_bi_gap"] > 2 for row in negative),
            },
            "largest_negative_examples": [
                {
                    key: row[key]
                    for key in (
                        "pair_id", "pair_group", "train_adjusted_pog_complementarity",
                        "train_bi_gap", "test_alignment_c", "test_disagreement_d",
                        "test_pooled_alpha_clipped", "gain_vs_anchor", "gain_vs_best_single",
                    )
                }
                for row in sorted(negative, key=lambda item: item["gain_vs_anchor"])[:10]
            ],
        }
    return output


def release_reproduction_audit(
    pair_rows: list[dict[str, Any]],
    pair_payload: Mapping[str, Any],
    polymarket_payload: Mapping[str, Any],
) -> dict[str, Any]:
    current_methods = ("ec_w0_56", "simple_mean", "log_odds_mean", "piecewise_odds")
    comparisons: list[dict[str, Any]] = []
    for experiment, payload, released_field, candidate_field in (
        (
            "polymarket_model",
            polymarket_payload,
            "support_weighted_gain_vs_polymarket",
            "gain_vs_anchor",
        ),
        (
            "model_model",
            pair_payload,
            "support_weighted_gain_fraction",
            "mean_fold_gain_vs_best_single",
        ),
    ):
        for method in current_methods:
            released = next(
                row[released_field]
                for row in payload["cross_fit"]["summary"]
                if row["pair_group"] == "all"
                and row["sample"] == "eligible"
                and row["method"] == method
            )
            candidates = [
                row for row in pair_rows
                if row["experiment"] == experiment and row["method"] == method
            ]
            total = sum(row["test_target_cells"] for row in candidates)
            reproduced = sum(
                row[candidate_field] * row["test_target_cells"] for row in candidates
            ) / total
            comparisons.append(
                {
                    "experiment": experiment,
                    "method": method,
                    "released": released,
                    "reproduced": reproduced,
                    "absolute_error": abs(released - reproduced),
                }
            )
    return {
        "comparisons": comparisons,
        "maximum_absolute_error": max(row["absolute_error"] for row in comparisons),
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        raise ValueError(f"cannot write empty CSV: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        raw_handle = path.open("wb")
        gzip_handle = gzip.GzipFile(filename="", mode="wb", fileobj=raw_handle, mtime=0)
        handle = io.TextIOWrapper(gzip_handle, encoding="utf-8", newline="")
    else:
        raw_handle = None
        gzip_handle = None
        handle = path.open("w", encoding="utf-8", newline="")
    try:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    finally:
        handle.close()
        if gzip_handle is not None and not gzip_handle.closed:
            gzip_handle.close()
        if raw_handle is not None and not raw_handle.closed:
            raw_handle.close()


def run_experiment(
    panel_path: Path,
    taxonomy_path: Path,
    pair_payload_path: Path,
    polymarket_payload_path: Path,
    split_seed: int = 20260825,
    split_repetitions: int = 10,
    minimum_fold_overlap: int = 50,
    ec_weight: float = 0.56,
    piecewise_threshold: float = 5.0,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    split_seeds = [split_seed + offset for offset in range(split_repetitions)]
    panel, alias_audit = read_panel(panel_path)
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    freeze_panel, match_audit = build_freeze_panel(panel, snapshots)
    pair_payload = json.loads(pair_payload_path.read_text(encoding="utf-8"))
    polymarket_payload = json.loads(polymarket_payload_path.read_text(encoding="utf-8"))

    records: list[dict[str, Any]] = []
    polymarket_models = [
        point["model_b"] for point in polymarket_payload["cross_fit"]["eligible_points"]
    ]
    for model in polymarket_models:
        records.extend(
            evaluate_pair(
                "polymarket_model",
                BASELINE_NAME,
                model,
                freeze_panel,
                panel[model],
                split_seeds,
                minimum_fold_overlap,
                ec_weight,
                piecewise_threshold,
            )
        )

    model_pairs = [
        (point["model_a"], point["model_b"])
        for point in pair_payload["cross_fit"]["eligible_points"]
    ]
    for model_a, model_b in model_pairs:
        records.extend(
            evaluate_pair(
                "model_model",
                model_a,
                model_b,
                panel[model_a],
                panel[model_b],
                split_seeds,
                minimum_fold_overlap,
                ec_weight,
                piecewise_threshold,
            )
        )

    pair_rows = aggregate_pairs(records)
    report = {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-26",
        "design": {
            "evaluation": "ten-repeat two-fold event-disjoint cross-fit",
            "split_seeds": split_seeds,
            "anchor_policy": {
                "polymarket_model": "Polymarket Freeze is always the anchor",
                "model_model": "lower adjusted-Brier constituent on the training fold is the anchor",
            },
            "closed_form": {
                "pool": "q = p_anchor + alpha * (p_partner - p_anchor)",
                "alignment_c": "official-weighted E[(y - p_anchor) * (p_partner - p_anchor)]",
                "disagreement_d": "official-weighted E[(p_partner - p_anchor)^2]",
                "cf_linear": "clip(C / D, 0, 1)",
                "cf_lcb_1se": "clip((C - cluster_event_SE(C)) / D, 0, 1)",
                "cf_lcb_95": "clip((C - 1.645 * cluster_event_SE(C)) / D, 0, 1)",
                "cf_directional": "fit separate clipped C / D weights when p_partner is above versus below p_anchor",
                "cf_directional_lcb_1se": "direction-specific C / D with one cluster-event SE subtracted",
                "exact_anchor_improvement": "2 * alpha * C - alpha^2 * D",
            },
            "leakage_controls": {
                "anchor_selection": "training fold only",
                "weight_fit": "training fold only",
                "dependence_and_near_bi": "training fold only",
                "gain": "opposite test fold only",
                "event_disjoint": True,
            },
        },
        "audit": {
            "polymarket_model_pairs": len(polymarket_models),
            "model_model_pairs": len(model_pairs),
            "fold_directions_per_pair": 2 * split_repetitions,
            "long_fold_method_rows": len(records),
            "pair_method_rows": len(pair_rows),
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "taxonomy": str(taxonomy_path),
            "taxonomy_sha256": sha256_file(taxonomy_path),
            "pair_payload": str(pair_payload_path),
            "pair_payload_sha256": sha256_file(pair_payload_path),
            "polymarket_payload": str(polymarket_payload_path),
            "polymarket_payload_sha256": sha256_file(polymarket_payload_path),
            "model_alias_audit": alias_audit,
            "snapshot_audit": snapshot_audit,
            "match_audit": match_audit,
        },
        "methods": {
            "deployable": list(DEPLOYABLE_METHODS),
            "diagnostic_only": list(DIAGNOSTIC_METHODS),
        },
        "method_summary": method_summary(pair_rows),
        "diversity_gain_correlations": diversity_gain_summary(pair_rows),
        "failure_diagnostics": failure_diagnostics(pair_rows),
        "release_reproduction_audit": release_reproduction_audit(
            pair_rows,
            pair_payload,
            polymarket_payload,
        ),
    }
    return report, records, pair_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel_model_versions.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument(
        "--pair-payload",
        type=Path,
        default=Path("site/public/data/pair-aggregation/all-six-family-pairs.json"),
    )
    parser.add_argument(
        "--polymarket-payload",
        type=Path,
        default=Path("site/public/data/polymarket-aggregation/freeze-baseline.json"),
    )
    parser.add_argument(
        "--output-dir", type=Path, default=Path("data/derived/closed_form_aggregation")
    )
    parser.add_argument("--split-seed", type=int, default=20260825)
    parser.add_argument("--split-repetitions", type=int, default=10)
    parser.add_argument("--minimum-fold-overlap", type=int, default=50)
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    args = parser.parse_args()

    report, records, pair_rows = run_experiment(
        args.panel,
        args.taxonomy,
        args.pair_payload,
        args.polymarket_payload,
        args.split_seed,
        args.split_repetitions,
        args.minimum_fold_overlap,
        args.ec_weight,
        args.piecewise_threshold,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "summary.json"
    report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(args.output_dir / "fold_method_results.csv.gz", records)
    write_csv(args.output_dir / "pair_method_results.csv", pair_rows)
    print(
        json.dumps(
            {
                "output_dir": str(args.output_dir),
                "polymarket_model_pairs": report["audit"]["polymarket_model_pairs"],
                "model_model_pairs": report["audit"]["model_model_pairs"],
                "fold_method_rows": len(records),
                "pair_method_rows": len(pair_rows),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
