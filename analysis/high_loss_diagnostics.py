"""Count and fold-coverage diagnostics for the existing strict-threshold lift.

These helpers do not smooth, clip, or replace the lift estimator. In particular,
a weighted mean of fold ratios is not a ratio of pooled counts.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from typing import Any, Iterable, Mapping, Sequence


def high_loss_details(first: Sequence[float], second: Sequence[float], threshold: float = 0.25) -> dict[str, Any]:
    if not first or len(first) != len(second):
        raise ValueError("high-loss diagnostics require equal nonempty vectors")
    if not math.isfinite(threshold) or not all(math.isfinite(x) for x in (*first, *second)):
        raise ValueError("high-loss inputs and threshold must be finite")
    a, b = [x > threshold for x in first], [x > threshold for x in second]
    n, na, nb = len(a), sum(a), sum(b)
    nab = sum(x and y for x, y in zip(a, b))
    reason = ("both_marginal_high_loss_rates_zero" if not na and not nb else
              "model_a_marginal_high_loss_rate_zero" if not na else
              "model_b_marginal_high_loss_rate_zero" if not nb else "")
    return {"threshold": threshold, "n_targets": n, "high_count_a": na, "high_count_b": nb,
            "joint_high_count": nab, "expected_joint_count": na * nb / n, "reason": reason}


def decode_diagnostics(value: Any) -> dict[str, Any] | None:
    if value is None or value == "":
        return None
    return json.loads(value) if isinstance(value, str) else dict(value)


def fold_diagnostics(
    values: Iterable[float | None], weights: Iterable[int], *,
    reasons: Iterable[str] | None = None,
    details: Iterable[Mapping[str, Any] | None] | None = None,
    aggregation: str = "train-target-weighted mean of fold lifts",
) -> dict[str, Any]:
    values, weights = list(values), list(weights)
    reasons = list(reasons) if reasons is not None else [""] * len(values)
    details = list(details) if details is not None else [None] * len(values)
    if not (len(values) == len(weights) == len(reasons) == len(details)):
        raise ValueError("high-loss fold diagnostic arrays must align")
    valid = [value is not None and math.isfinite(value) for value in values]
    counts = Counter(reason or "undefined_in_saved_fold" for reason, ok in zip(reasons, valid) if not ok)
    available = [row for row in details if row is not None]
    count_fields = {"high_count_a", "high_count_b", "joint_high_count", "expected_joint_count"}
    complete_counts = (len(available) == len(values) and bool(values)
                       and all(count_fields <= row.keys() for row in available))
    output = {
        "threshold": 0.25, "aggregation": aggregation,
        "included_fold_count": len(values), "defined_fold_count": sum(valid),
        "undefined_fold_count": len(values) - sum(valid),
        "train_target_cells": sum(weights),
        "valid_train_target_cells": sum(weight for weight, ok in zip(weights, valid) if ok),
        "reason": "one_or_more_included_fold_lifts_undefined" if not all(valid) else "",
        "reason_counts": dict(counts), "count_diagnostics_available": complete_counts,
        "counts_are_repeated_training_exposures": True,
    }
    if complete_counts:
        output.update({"high_count_a": sum(row["high_count_a"] for row in available),
                       "high_count_b": sum(row["high_count_b"] for row in available),
                       "joint_high_count": sum(row["joint_high_count"] for row in available),
                       "expected_joint_count": math.fsum(row["expected_joint_count"] for row in available),
                       "min_high_count_a": min(row["high_count_a"] for row in available),
                       "min_high_count_b": min(row["high_count_b"] for row in available),
                       "min_joint_high_count": min(row["joint_high_count"] for row in available),
                       "zero_joint_fold_count": sum(row["joint_high_count"] == 0 for row in available)})
    return output


def oriented_diagnostics(value: Mapping[str, Any], reverse: bool) -> dict[str, Any]:
    result = dict(value)
    if reverse:
        for a, b in (("high_count_a", "high_count_b"), ("min_high_count_a", "min_high_count_b")):
            if a in result and b in result:
                result[a], result[b] = result[b], result[a]
        swapped = {
            "model_a_marginal_high_loss_rate_zero": "model_b_marginal_high_loss_rate_zero",
            "model_b_marginal_high_loss_rate_zero": "model_a_marginal_high_loss_rate_zero",
        }
        if "reason" in result:
            result["reason"] = swapped.get(result["reason"], result["reason"])
        if "reason_counts" in result:
            result["reason_counts"] = {swapped.get(reason, reason): count
                                       for reason, count in result["reason_counts"].items()}
    return result


def details_from_metric_row(row: Mapping[str, Any], *, reverse: bool = False) -> dict[str, Any]:
    """Restore exact integer counts from the retained CSV rates without refitting."""
    n = int(row["n_overlap"])
    output = {"threshold": 0.25, "n_targets": n, "reason": row.get("lift_reason", "") or ""}
    a, b, joint = (row.get(field) for field in ("high_loss_rate_a_025", "high_loss_rate_b_025", "joint_high_loss_count_025"))
    if any(value is None or value == "" for value in (a, b, joint)):
        return oriented_diagnostics({**output, "count_diagnostics_available": False}, reverse)
    na, nb, nab = round(float(a) * n), round(float(b) * n), int(float(joint))
    if not (0 <= nab <= min(na, nb) <= max(na, nb) <= n):
        raise ValueError("invalid saved high-loss counts")
    output.update(high_count_a=na, high_count_b=nb, joint_high_count=nab,
                  expected_joint_count=na * nb / n if n else None, count_diagnostics_available=True)
    return oriented_diagnostics(output, reverse)
