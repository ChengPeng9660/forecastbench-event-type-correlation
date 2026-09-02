"""Prophet Arena-style 10-bin ECE for the published complementarity panel.

The calibration diagnostic deliberately uses raw probabilities and binary
outcomes.  It does not use ForecastBench's question fixed effects or BI
normalization.  Every calculation is restricted to the exact common rows and
fixed train/test direction already used by the complementarity experiment.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, MutableMapping, Sequence


NUM_BINS = 10
CALIBRATION_DEFINITION = {
    "metric": "expected_calibration_error",
    "label": "ECE",
    "implementation": "prophet-arena-engine-2.2.0-compatible",
    "probability_bins": NUM_BINS,
    "binning": "uniform_equal_width_over_[0,1]",
    "boundaries": "left_closed_right_open_except_last_closed",
    "aggregation": "pooled_common_probability_outcome_pairs",
    "row_weighting": "uniform",
    "uses_question_fixed_effect": False,
    "uses_brier_index_normalization": False,
    "lower_is_better": True,
}


def expected_calibration_error(
    probabilities: Sequence[float],
    outcomes: Sequence[float],
    *,
    num_bins: int = NUM_BINS,
) -> float | None:
    """Return the pooled-pair empirical ECE used by Arena engine 2.2.0.

    Bin assignment follows the released engine exactly: round ``p * B`` to
    nine decimal places before flooring, then clamp probability 1 to the last
    bin.  The rounding keeps decimal boundary forecasts such as 0.3 in
    ``[0.3, 0.4)`` rather than letting binary float noise move them left.
    """

    import numpy as np

    if not isinstance(num_bins, int) or num_bins < 1:
        raise ValueError("num_bins must be a positive integer")
    probability = np.asarray(probabilities, dtype=float)
    outcome = np.asarray(outcomes, dtype=float)
    if probability.shape != outcome.shape:
        raise ValueError("probabilities and outcomes must have the same shape")
    if probability.ndim != 1:
        raise ValueError("ECE inputs must be one-dimensional")
    if not probability.size:
        return None
    if not np.isfinite(probability).all() or not np.isfinite(outcome).all():
        raise ValueError("ECE inputs must be finite")
    if (probability < 0).any() or (probability > 1).any():
        raise ValueError("probabilities must lie in [0, 1]")
    if not np.isin(outcome, [0.0, 1.0]).all():
        raise ValueError("outcomes must be binary")

    bin_index = np.minimum(
        np.floor(np.round(probability * num_bins, 9)).astype(int),
        num_bins - 1,
    )
    counts = np.bincount(bin_index, minlength=num_bins).astype(float)
    probability_sum = np.bincount(bin_index, weights=probability, minlength=num_bins)
    outcome_sum = np.bincount(bin_index, weights=outcome, minlength=num_bins)
    occupied = counts > 0
    confidence = probability_sum[occupied] / counts[occupied]
    accuracy = outcome_sum[occupied] / counts[occupied]
    return float(
        ((counts[occupied] / probability.size) * abs(confidence - accuracy)).sum()
    )


def _event_split(events: Iterable[tuple[str, str]], seed: int):
    import numpy as np

    return np.asarray([
        int.from_bytes(
            hashlib.sha256(f"{seed}|{source.casefold()}|{event_id}".encode()).digest()[:8],
            "big",
        ) % 2
        for source, event_id in events
    ], dtype=int)


def _pool_predictions(p0, p1, alpha_up: float, alpha_down: float):
    import numpy as np

    p0, p1 = np.asarray(p0), np.asarray(p1)
    q0, q1 = np.clip(p0, 1e-6, 1 - 1e-6), np.clip(p1, 1e-6, 1 - 1e-6)
    summed_log_odds = np.log(q0 / (1 - q0)) + np.log(q1 / (1 - q1))
    boundary = math.log(5)
    piecewise = np.where(
        summed_log_odds <= -boundary,
        summed_log_odds + boundary / 2,
        np.where(
            summed_log_odds >= boundary,
            summed_log_odds - boundary / 2,
            summed_log_odds / 2,
        ),
    )
    sigmoid = lambda value: 1 / (1 + np.exp(-value))
    directional = p0 + np.where(
        p1 >= p0, alpha_up, alpha_down
    ) * (p1 - p0)
    return np.column_stack([
        (p0 + p1) / 2,
        sigmoid(summed_log_odds / 2),
        sigmoid(.56 * summed_log_odds),
        sigmoid(piecewise),
        directional,
    ])


def _adjusted_bi(predictions, outcome, offset):
    import numpy as np

    values = np.asarray(predictions)
    if values.ndim == 1:
        values = values[:, None]
    adjusted = np.mean((values - outcome[:, None]) ** 2, axis=0) + float(np.mean(offset))
    return 100 * (1 - np.sqrt(adjusted))


def _calibration_bundle(
    train_prediction,
    test_prediction,
    train_outcome,
    test_outcome,
    method_predictions,
    method_ids: Sequence[str],
) -> dict[str, Any]:
    return {
        "train_a": expected_calibration_error(train_prediction[:, 0], train_outcome),
        "train_b": expected_calibration_error(train_prediction[:, 1], train_outcome),
        "test_a": expected_calibration_error(test_prediction[:, 0], test_outcome),
        "test_b": expected_calibration_error(test_prediction[:, 1], test_outcome),
        "methods": {
            method: expected_calibration_error(method_predictions[:, index], test_outcome)
            for index, method in enumerate(method_ids)
        },
    }


def add_primary_calibration(
    study: Path,
    primary_rows: Sequence[Mapping[str, str]],
    profiles: MutableMapping[tuple[str, str], list[dict[str, Any]]],
    method_ids: Sequence[str],
    *,
    seed: int,
    train_fold: int,
) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, Any]]:
    """Attach overall and category ECE to the frozen primary pair views."""

    import numpy as np

    panel = np.load(study / "data/panel.npz")
    probability = panel["predictions"]
    outcome = panel["outcome"]
    offset = panel["offset"]
    event_index = panel["event"]
    labels = {dimension: panel[dimension] for dimension in ("topic", "source")}
    models = json.loads((study / "data/models.json").read_text())
    model_index = {model: index for index, model in enumerate(models)}
    events: list[tuple[str, str]] = []
    with (study / "data/events.csv").open(newline="") as handle:
        for row in csv.DictReader(handle):
            events.append((row["source"], row["event_id"]))
    split = _event_split(events, seed)[event_index]

    views_by_pair: dict[tuple[str, str], list[Mapping[str, str]]] = defaultdict(list)
    for row in primary_rows:
        views_by_pair[(row["model_a"], row["model_b"])].append(row)

    overall: dict[tuple[str, str], dict[str, Any]] = {}
    max_overall_bi_error = 0.0
    max_profile_bi_error = 0.0
    profile_rows = 0
    for pair_number, ((model_a, model_b), views) in enumerate(views_by_pair.items(), start=1):
        i, j = model_index[model_a], model_index[model_b]
        common = np.flatnonzero(np.isfinite(probability[:, i]) & np.isfinite(probability[:, j]))
        train = common[split[common] == train_fold]
        test = common[split[common] != train_fold]
        if not len(train) or not len(test):
            raise ValueError(f"primary calibration pair has empty support: {model_a} / {model_b}")

        source_row = views[0]
        train_a_b = probability[train][:, [i, j]]
        test_a_b = probability[test][:, [i, j]]
        train_bi = _adjusted_bi(train_a_b, outcome[train], offset[train])
        base, partner = (i, j) if train_bi[0] >= train_bi[1] else (j, i)
        alpha_up = float(source_row["alpha_up"])
        alpha_down = float(source_row["alpha_down"])
        method_predictions = _pool_predictions(
            probability[test, base], probability[test, partner], alpha_up, alpha_down
        )
        method_bi = _adjusted_bi(method_predictions, outcome[test], offset[test])
        expected_method_bi = np.asarray([
            float(source_row[f"{method}_bi"]) for method in method_ids
        ])
        max_overall_bi_error = max(
            max_overall_bi_error,
            float(np.max(abs(method_bi - expected_method_bi))),
        )

        calibration = _calibration_bundle(
            train_a_b,
            test_a_b,
            outcome[train],
            outcome[test],
            method_predictions,
            method_ids,
        )
        overall[(model_a, model_b)] = calibration

        for view in views:
            dimension = view["dimension"]
            key = (dimension, view["pair_id"])
            for profile in profiles.get(key, []):
                group = profile["group"]
                train_mask = labels[dimension][train] == group
                test_mask = labels[dimension][test] == group
                if not train_mask.any():
                    raise ValueError(f"profile has no training rows: {key} / {group}")
                profile_method_predictions = method_predictions[test_mask]
                profile["calibration"] = _calibration_bundle(
                    train_a_b[train_mask],
                    test_a_b[test_mask],
                    outcome[train][train_mask],
                    outcome[test][test_mask],
                    profile_method_predictions,
                    method_ids,
                ) if test_mask.any() else {
                    "train_a": expected_calibration_error(
                        train_a_b[train_mask, 0], outcome[train][train_mask]
                    ),
                    "train_b": expected_calibration_error(
                        train_a_b[train_mask, 1], outcome[train][train_mask]
                    ),
                    "test_a": None,
                    "test_b": None,
                    "methods": {method: None for method in method_ids},
                }
                if test_mask.any():
                    profile_method_bi = _adjusted_bi(
                        profile_method_predictions,
                        outcome[test][test_mask],
                        offset[test][test_mask],
                    )
                    expected_profile_bi = np.asarray([
                        float(profile["methods"][method])
                        for method in method_ids
                    ])
                    finite = np.isfinite(expected_profile_bi)
                    if finite.any():
                        max_profile_bi_error = max(
                            max_profile_bi_error,
                            float(np.max(abs(profile_method_bi[finite] - expected_profile_bi[finite]))),
                        )
                profile_rows += 1

        if pair_number % 2_000 == 0:
            print(
                f"calibration pairs {pair_number:,}/{len(views_by_pair):,}",
                flush=True,
            )

    tolerance = 1e-9
    if max(max_overall_bi_error, max_profile_bi_error) >= tolerance:
        raise ValueError(
            "calibration reconstruction did not reproduce the frozen BI "
            f"(overall={max_overall_bi_error}, profile={max_profile_bi_error})"
        )
    return overall, {
        "status": "PASS",
        "definition": CALIBRATION_DEFINITION,
        "pair_views": len(primary_rows),
        "unique_pairs": len(overall),
        "profile_rows": profile_rows,
        "max_overall_bi_reconstruction_error": max_overall_bi_error,
        "max_profile_bi_reconstruction_error": max_profile_bi_error,
        "reconstruction_tolerance": tolerance,
    }
