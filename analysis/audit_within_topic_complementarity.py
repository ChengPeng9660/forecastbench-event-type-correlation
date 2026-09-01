"""Independent numerical audit for the within-topic POG experiment.

This intentionally reimplements the split, POG, BI, and five pool formulas
without importing the production experiment module.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd


METHODS = ["simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional"]
TOLERANCE = 1e-9


def split_events(events, seed):
    values = []
    for source, event_id in events:
        token = f"{seed}|{source.casefold()}|{event_id}".encode()
        values.append(int.from_bytes(hashlib.sha256(token).digest()[:8], "big") % 2)
    return np.asarray(values, dtype=np.int8)


def brier_index(raw, offset):
    adjusted = float(np.mean(raw) + np.mean(offset))
    return 100 * (1 - math.sqrt(adjusted)) if adjusted >= 0 else float("nan")


def pools(first, second, outcome):
    delta = second - first
    alpha = []
    for positive in (True, False):
        mask = delta >= 0 if positive else delta < 0
        numerator = float(np.sum((outcome[mask] - first[mask]) * delta[mask]))
        denominator = float(np.sum(delta[mask] ** 2))
        alpha.append(float(np.clip(numerator / denominator, 0, 1)) if denominator else 0.0)
    clipped_first = np.clip(first, 1e-6, 1 - 1e-6)
    clipped_second = np.clip(second, 1e-6, 1 - 1e-6)
    odds = np.log(clipped_first / (1 - clipped_first)) + np.log(clipped_second / (1 - clipped_second))
    boundary = math.log(5)
    piece = np.choose(
        [odds <= -boundary, odds >= boundary],
        [odds + boundary / 2, odds - boundary / 2],
        default=odds / 2,
    )
    logistic = lambda value: 1 / (1 + np.exp(-value))
    directional = first + np.where(second >= first, alpha[0], alpha[1]) * (second - first)
    return np.column_stack([
        (first + second) / 2,
        logistic(odds / 2),
        logistic(0.56 * odds),
        logistic(piece),
        directional,
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-study", type=Path, required=True)
    parser.add_argument("--experiment", type=Path, required=True)
    parser.add_argument("--sample", type=int, default=256)
    args = parser.parse_args()
    source, experiment = args.source_study.resolve(), args.experiment.resolve()
    arrays = np.load(source / "data/panel.npz")
    prediction, outcome, offset = arrays["predictions"], arrays["outcome"], arrays["offset"]
    event, topic = arrays["event"], arrays["topic"]
    events = list(pd.read_csv(source / "data/events.csv", dtype=str, keep_default_na=False).itertuples(index=False, name=None))
    frame = pd.read_csv(experiment / "pair_topic_directions.csv.gz", dtype={"split": str})
    sample = frame.sample(min(args.sample, len(frame)), random_state=2026090102).sort_values(["i", "j", "split", "fold", "topic"])
    split_cache = {int(seed): split_events(events, int(seed))[event] for seed in sample.split.unique()}
    common_cache = {}
    maximum = 0.0
    compared = 0
    event_overlap_failures = 0
    support_failures = 0

    def check(observed, expected):
        nonlocal maximum, compared
        if not (np.isfinite(observed) and np.isfinite(expected)):
            if np.isnan(observed) and np.isnan(expected):
                return
            raise AssertionError(f"finite/undefined mismatch: {observed}, {expected}")
        maximum = max(maximum, abs(float(observed) - float(expected)))
        compared += 1

    for row in sample.itertuples(index=False):
        key = (row.i, row.j)
        if key not in common_cache:
            common_cache[key] = np.flatnonzero(np.isfinite(prediction[:, row.i]) & np.isfinite(prediction[:, row.j]))
        common = common_cache[key]
        direction = split_cache[int(row.split)]
        train = common[direction[common] == row.fold]
        test = common[direction[common] != row.fold]
        if np.intersect1d(np.unique(event[train]), np.unique(event[test])).size:
            event_overlap_failures += 1
        train_topic = train[topic[train] == row.topic]
        test_topic = test[topic[test] == row.topic]
        if len(np.unique(event[train_topic])) != row.train_topic_events or len(np.unique(event[test_topic])) != row.test_topic_events:
            support_failures += 1

        loss_a = (prediction[train_topic, row.i] - outcome[train_topic]) ** 2
        loss_b = (prediction[train_topic, row.j] - outcome[train_topic]) ** 2
        direct_pog = min(float(np.mean(loss_a)), float(np.mean(loss_b))) - float(np.mean(np.minimum(loss_a, loss_b)))
        denominator = float(np.mean((loss_a + loss_b) / 2))
        check(row.train_adjusted_pog, direct_pog)
        check(row.train_normalized_pog, direct_pog / denominator)
        check(row.train_a_rescue, float(np.mean(np.maximum(loss_b - loss_a, 0))))
        check(row.train_b_rescue, float(np.mean(np.maximum(loss_a - loss_b, 0))))
        topic_bi_a = brier_index(loss_a, offset[train_topic])
        topic_bi_b = brier_index(loss_b, offset[train_topic])
        check(row.train_topic_bi_a, topic_bi_a)
        check(row.train_topic_bi_b, topic_bi_b)
        check(row.train_topic_gap, abs(topic_bi_a - topic_bi_b))

        train_all_a = (prediction[train, row.i] - outcome[train]) ** 2
        train_all_b = (prediction[train, row.j] - outcome[train]) ** 2
        adjusted_a = float(np.mean(train_all_a + offset[train]))
        adjusted_b = float(np.mean(train_all_b + offset[train]))
        better, other = (row.i, row.j) if adjusted_a <= adjusted_b else (row.j, row.i)
        # Fit directional alphas on train, then apply all formulas to test probabilities.
        train_delta = prediction[train, other] - prediction[train, better]
        alpha = []
        for mask in (train_delta >= 0, train_delta < 0):
            numerator = float(np.sum((outcome[train][mask] - prediction[train, better][mask]) * train_delta[mask]))
            denominator_alpha = float(np.sum(train_delta[mask] ** 2))
            alpha.append(float(np.clip(numerator / denominator_alpha, 0, 1)) if denominator_alpha else 0.0)
        first, second = prediction[test, better], prediction[test, other]
        q0, q1 = np.clip(first, 1e-6, 1 - 1e-6), np.clip(second, 1e-6, 1 - 1e-6)
        odds = np.log(q0 / (1 - q0)) + np.log(q1 / (1 - q1))
        boundary = math.log(5)
        piece = np.where(odds <= -boundary, odds + boundary / 2, np.where(odds >= boundary, odds - boundary / 2, odds / 2))
        logistic = lambda value: 1 / (1 + np.exp(-value))
        test_predictions = np.column_stack([
            (first + second) / 2,
            logistic(odds / 2),
            logistic(0.56 * odds),
            logistic(piece),
            first + np.where(second >= first, alpha[0], alpha[1]) * (second - first),
        ])
        for method_index, method in enumerate(METHODS):
            raw = (test_predictions[:, method_index] - outcome[test]) ** 2
            check(getattr(row, f"{method}_overall_bi"), brier_index(raw, offset[test]))
            if row.test_topic_events >= 20:
                mask = topic[test] == row.topic
                topic_raw = (test_predictions[mask, method_index] - outcome[test[mask]]) ** 2
                check(getattr(row, f"{method}_topic_bi"), brier_index(topic_raw, offset[test[mask]]))

    audit = {
        "status": "PASS" if maximum < TOLERANCE and event_overlap_failures == 0 and support_failures == 0 else "FAIL",
        "implementation_independent": True,
        "sampled_pair_topic_directions": len(sample),
        "numeric_comparisons": compared,
        "maximum_absolute_error": maximum,
        "tolerance": TOLERANCE,
        "event_disjointness": "PASS" if event_overlap_failures == 0 else "FAIL",
        "support_reconstruction": "PASS" if support_failures == 0 else "FAIL",
        "pog_formula": "direct best-mean loss minus mean pointwise-min loss",
        "aggregation_formulas_reimplemented": METHODS,
    }
    (experiment / "independent_audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    print(json.dumps(audit, indent=2))
    if audit["status"] != "PASS":
        raise AssertionError(audit)


if __name__ == "__main__":
    main()
