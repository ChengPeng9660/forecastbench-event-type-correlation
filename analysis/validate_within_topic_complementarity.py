"""Descriptive robustness checks for within-topic POG complementarity.

No p-values are produced because split directions and pair rows reuse events.
The checks ask whether training POG adds descriptive signal after explicit
ability/support controls and whether top-POG lift is directionally stable.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd


METHODS = ["simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional"]
SCOPES = ["all", "different_model_version", "matched_conditions"]
METRICS = ["normalized_pog", "adjusted_pog"]
OUTCOMES = ["topic", "overall"]
EPS = 1e-10


def finite(value):
    return float(value) if value is not None and np.isfinite(value) else None


def corr(first, second):
    pair = pd.DataFrame({"first": first, "second": second}).replace([np.inf, -np.inf], np.nan).dropna()
    if len(pair) < 2 or pair["first"].nunique() < 2 or pair["second"].nunique() < 2:
        return None
    a = pair["first"].to_numpy(); b = pair["second"].to_numpy()
    a = a - a.mean(); b = b - b.mean()
    denominator = math.sqrt(float(a @ a) * float(b @ b))
    return float(a @ b / denominator) if denominator else None


def scope(frame, name):
    if name == "all":
        return frame
    if name == "different_model_version":
        return frame[~frame.same_model_version.eq(True)]
    if name == "matched_conditions":
        return frame[frame.same_prompt.eq(True) & frame.same_information.eq(True)]
    raise ValueError(name)


def top_ids(frame, metric_column):
    ranked = frame[["id", metric_column]].replace([np.inf, -np.inf], np.nan).dropna()
    ranked = ranked.sort_values([metric_column, "id"], ascending=[False, True])
    count = max(1, math.ceil(len(ranked) / 4)) if len(ranked) else 0
    return set(ranked.head(count).id), count


def r_squared(outcome, design):
    coefficients, *_ = np.linalg.lstsq(design, outcome, rcond=None)
    residual = outcome - design @ coefficients
    total = outcome - outcome.mean()
    denominator = float(total @ total)
    return 1 - float(residual @ residual) / denominator if denominator > 0 else float("nan"), coefficients


def regression(frame, metric_column, gain_column):
    columns = [
        "train_mean_bi", "train_topic_mean_bi", "train_overall_gap",
        "train_topic_gap", "log_train_topic_events", metric_column, gain_column,
        "topic", "direction",
    ]
    data = frame[columns].replace([np.inf, -np.inf], np.nan).dropna()
    if len(data) < 20:
        return {"regression_n": len(data), "standardized_pog_beta": None, "base_r2": None, "pog_incremental_r2": None}
    numeric_controls = [
        "train_mean_bi", "train_topic_mean_bi", "train_overall_gap",
        "train_topic_gap", "log_train_topic_events",
    ]
    controls = []
    for column in numeric_controls:
        values = data[column].to_numpy(dtype=float)
        standard = values.std()
        controls.append((values - values.mean()) / standard if standard > 0 else np.zeros(len(values)))
    categories = pd.get_dummies(data[["topic", "direction"]], drop_first=True, dtype=float).to_numpy()
    base = np.column_stack([np.ones(len(data)), *controls, categories])
    y = data[gain_column].to_numpy(dtype=float)
    y_standard = y.std()
    y = (y - y.mean()) / y_standard if y_standard > 0 else y - y.mean()
    x = data[metric_column].to_numpy(dtype=float)
    x_standard = x.std()
    x = (x - x.mean()) / x_standard if x_standard > 0 else np.zeros(len(x))
    base_r2, _ = r_squared(y, base)
    full_r2, coefficients = r_squared(y, np.column_stack([base, x]))
    return {
        "regression_n": len(data),
        "standardized_pog_beta": finite(coefficients[-1]),
        "base_r2": finite(base_r2),
        "pog_incremental_r2": finite(full_r2 - base_r2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", type=Path, required=True)
    args = parser.parse_args()
    experiment = args.experiment.resolve()
    frame = pd.read_csv(experiment / "pair_topic_directions.csv.gz", dtype={"split": str})
    frame["train_topic_mean_bi"] = (frame.train_topic_bi_a + frame.train_topic_bi_b) / 2
    frame["log_train_topic_events"] = np.log(frame.train_topic_events)
    frame["direction"] = frame.split.astype(str) + ":" + frame.fold.astype(str)
    main_frame = frame[
        (frame.train_overall_gap <= 3 + 1e-12)
        & (frame.train_topic_gap <= 1 + 1e-12)
        & (frame.train_topic_events >= 30)
    ]

    validations = []
    direction_rows = []
    topic_rows = []
    for scope_name in SCOPES:
        scoped = scope(main_frame, scope_name)
        for method in METHODS:
            for outcome in OUTCOMES:
                gain = f"{method}_{outcome}_gain_best_bi"
                for metric in METRICS:
                    metric_column = f"train_{metric}"
                    defined = scoped[["id", metric_column, gain]].replace([np.inf, -np.inf], np.nan).dropna()
                    ids, top_count = top_ids(scoped, metric_column)
                    top = defined[defined.id.isin(ids)]
                    direction_lifts = []
                    for direction, group in scoped.groupby("direction", sort=True):
                        local_ids, local_count = top_ids(group, metric_column)
                        local_defined = group[["id", metric_column, gain]].replace([np.inf, -np.inf], np.nan).dropna()
                        local_top = local_defined[local_defined.id.isin(local_ids)]
                        all_mean = float(local_defined[gain].mean()) if len(local_defined) else np.nan
                        top_mean = float(local_top[gain].mean()) if len(local_top) else np.nan
                        lift = top_mean - all_mean if np.isfinite([top_mean, all_mean]).all() else np.nan
                        direction_lifts.append(lift)
                        direction_rows.append({
                            "pair_scope": scope_name, "method": method, "outcome": outcome,
                            "metric": metric, "direction": direction, "n": len(group),
                            "n_defined": len(local_defined), "top_quartile_n": local_count,
                            "top_quartile_n_defined": len(local_top), "mean_gain_bi": finite(all_mean),
                            "top_quartile_mean_gain_bi": finite(top_mean), "top_minus_all_gain_bi": finite(lift),
                        })
                    ability = {
                        "overall_mean_bi_correlation": corr(scoped[metric_column], scoped.train_mean_bi),
                        "topic_mean_bi_correlation": corr(scoped[metric_column], scoped.train_topic_mean_bi),
                        "overall_gap_correlation": corr(scoped[metric_column], scoped.train_overall_gap),
                        "topic_gap_correlation": corr(scoped[metric_column], scoped.train_topic_gap),
                    }
                    reg = regression(scoped, metric_column, gain)
                    finite_lifts = [value for value in direction_lifts if np.isfinite(value)]
                    validations.append({
                        "pair_scope": scope_name, "method": method, "outcome": outcome, "metric": metric,
                        "n": len(scoped), "n_defined": len(defined), "top_quartile_n": top_count,
                        "top_quartile_n_defined": len(top),
                        "mean_gain_bi": finite(defined[gain].mean() if len(defined) else np.nan),
                        "top_quartile_mean_gain_bi": finite(top[gain].mean() if len(top) else np.nan),
                        "top_quartile_beats_both_rate": finite(top[gain].gt(EPS).mean() if len(top) else np.nan),
                        "positive_top_minus_all_directions": sum(value > EPS for value in finite_lifts),
                        "defined_directions": len(finite_lifts),
                        "mean_top_minus_all_gain_bi": finite(np.mean(finite_lifts) if finite_lifts else np.nan),
                        **ability,
                        **reg,
                    })
                    for topic_name, group in scoped.groupby("topic", sort=True):
                        local_ids, local_count = top_ids(group, metric_column)
                        local_defined = group[["id", metric_column, gain]].replace([np.inf, -np.inf], np.nan).dropna()
                        local_top = local_defined[local_defined.id.isin(local_ids)]
                        topic_rows.append({
                            "pair_scope": scope_name, "method": method, "outcome": outcome,
                            "metric": metric, "topic": topic_name, "n": len(group),
                            "n_defined": len(local_defined), "top_quartile_n": local_count,
                            "top_quartile_n_defined": len(local_top),
                            "mean_gain_bi": finite(local_defined[gain].mean() if len(local_defined) else np.nan),
                            "top_quartile_mean_gain_bi": finite(local_top[gain].mean() if len(local_top) else np.nan),
                        })

    payload = {
        "schema_version": 1,
        "status": "PASS",
        "interpretation": "descriptive; repeated events and pairs are not independent",
        "main_controls": {"overall_train_bi_gap": 3, "topic_train_bi_gap": 1, "minimum_train_topic_events": 30},
        "validations": validations,
        "directions": direction_rows,
        "topics": topic_rows,
    }
    (experiment / "validation.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(json.dumps({"validations": len(validations), "directions": len(direction_rows), "topics": len(topic_rows)}, indent=2))


if __name__ == "__main__":
    main()
