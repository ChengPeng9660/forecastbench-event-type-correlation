"""Training-only uncertainty screen for category complementarity.

The existing experiment chooses the largest positive and negative category BI
gaps on the training fold.  This module keeps the experiment and every
aggregation formula unchanged, but quantifies how much of each training gap
survives event-clustered sampling uncertainty.  Test outcomes are never read by
the screen.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import NormalDist
from typing import Any, Mapping, MutableMapping, Sequence


CONFIDENCE_LEVEL = 0.90
STRICT_MARGIN_BI = 1.0
Z_VALUE = NormalDist().inv_cdf(0.5 + CONFIDENCE_LEVEL / 2)

STABILITY_DEFINITION = {
    "metric": "event_clustered_category_bi_edge",
    "label": "Stable category edge",
    "confidence_level": CONFIDENCE_LEVEL,
    "z_value": Z_VALUE,
    "interval": "two_sided_delta_method",
    "cluster_unit": "event",
    "primary_rule": "both_opposite_category_edge_lower_bounds_above_0_bi",
    "strict_rule": f"both_opposite_category_edge_lower_bounds_above_{STRICT_MARGIN_BI:g}_bi",
    "strict_margin_bi": STRICT_MARGIN_BI,
    "selection_split": "training_only",
    "uses_test_outcomes": False,
    "changes_aggregation": False,
}


def _event_split(events: Sequence[tuple[str, str]], seed: int):
    import numpy as np

    return np.asarray([
        int.from_bytes(
            hashlib.sha256(f"{seed}|{source.casefold()}|{event_id}".encode()).digest()[:8],
            "big",
        ) % 2
        for source, event_id in events
    ], dtype=int)


def event_clustered_bi_gap(
    prediction_a,
    prediction_b,
    outcome,
    offset,
    event,
) -> dict[str, float | int | None]:
    """Return BI(A)-BI(B) and its event-clustered delta-method SE.

    Uniform target-row weighting matches the published complementarity study.
    The question fixed effect and normalization term remain inside each
    adjusted loss.  The event cluster keeps repeated target rows from being
    treated as independent observations.
    """

    import numpy as np

    first = np.asarray(prediction_a, dtype=float)
    second = np.asarray(prediction_b, dtype=float)
    resolved = np.asarray(outcome, dtype=float)
    adjustment = np.asarray(offset, dtype=float)
    clusters = np.asarray(event)
    if not (first.shape == second.shape == resolved.shape == adjustment.shape == clusters.shape):
        raise ValueError("stable-gap inputs must have the same shape")
    if first.ndim != 1:
        raise ValueError("stable-gap inputs must be one-dimensional")
    if not first.size:
        return {"gap_bi": None, "se_bi": None, "events": 0}
    if not all(np.isfinite(values).all() for values in (first, second, resolved, adjustment)):
        raise ValueError("stable-gap inputs must be finite")

    loss_a = (first - resolved) ** 2 + adjustment
    loss_b = (second - resolved) ** 2 + adjustment
    mean_a, mean_b = float(loss_a.mean()), float(loss_b.mean())
    if mean_a <= 0 or mean_b <= 0:
        return {
            "gap_bi": None,
            "se_bi": None,
            "events": int(np.unique(clusters).size),
        }

    bi_a = 100 * (1 - math.sqrt(mean_a))
    bi_b = 100 * (1 - math.sqrt(mean_b))
    gap = bi_a - bi_b
    influence = (
        (-50 / math.sqrt(mean_a)) * (loss_a - mean_a)
        - (-50 / math.sqrt(mean_b)) * (loss_b - mean_b)
    )
    _, inverse = np.unique(clusters, return_inverse=True)
    cluster_count = int(inverse.max()) + 1
    if cluster_count < 2:
        standard_error = None
    else:
        cluster_sums = np.bincount(inverse, weights=influence) / first.size
        standard_error = math.sqrt(
            cluster_count / (cluster_count - 1) * float(cluster_sums @ cluster_sums)
        )
    return {"gap_bi": gap, "se_bi": standard_error, "events": cluster_count}


def _interval(result: Mapping[str, float | int | None]) -> dict[str, float | int | None]:
    gap, standard_error = result["gap_bi"], result["se_bi"]
    if not isinstance(gap, (int, float)) or not isinstance(standard_error, (int, float)):
        return {
            **result,
            "ci_low_bi": None,
            "ci_high_bi": None,
            "lcb_for_a_bi": None,
            "lcb_for_b_bi": None,
        }
    radius = Z_VALUE * standard_error
    return {
        **result,
        "ci_low_bi": gap - radius,
        "ci_high_bi": gap + radius,
        "lcb_for_a_bi": gap - radius,
        "lcb_for_b_bi": -gap - radius,
    }


def _best_edge(
    profiles: Sequence[Mapping[str, Any]],
    key: str,
) -> Mapping[str, Any] | None:
    defined = [
        profile for profile in profiles
        if isinstance(profile.get("stability", {}).get(key), (int, float))
    ]
    return max(
        defined,
        key=lambda profile: (profile["stability"][key], str(profile["group"])),
        default=None,
    )


def add_primary_stability(
    study: Path,
    primary_rows: Sequence[Mapping[str, str]],
    profiles: MutableMapping[tuple[str, str], list[dict[str, Any]]],
    *,
    seed: int,
    train_fold: int,
) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, Any]]:
    """Attach training-only stable category edges to primary pair views."""

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

    stable: dict[tuple[str, str], dict[str, Any]] = {}
    max_gap_error = 0.0
    profile_rows = 0
    for model_a_b, views in views_by_pair.items():
        model_a, model_b = model_a_b
        i, j = model_index[model_a], model_index[model_b]
        common = np.flatnonzero(np.isfinite(probability[:, i]) & np.isfinite(probability[:, j]))
        train = common[split[common] == train_fold]
        overall = _interval(event_clustered_bi_gap(
            probability[train, i], probability[train, j], outcome[train], offset[train], event_index[train]
        ))

        for view in views:
            dimension = view["dimension"]
            key = (dimension, view["pair_id"])
            pair_profiles = profiles.get(key, [])
            for profile in pair_profiles:
                mask = labels[dimension][train] == profile["group"]
                result = _interval(event_clustered_bi_gap(
                    probability[train[mask], i],
                    probability[train[mask], j],
                    outcome[train[mask]],
                    offset[train[mask]],
                    event_index[train[mask]],
                ))
                profile["stability"] = result
                if isinstance(result["gap_bi"], (int, float)):
                    published_gap = profile["train_bi_a"] - profile["train_bi_b"]
                    max_gap_error = max(max_gap_error, abs(result["gap_bi"] - published_gap))
                profile_rows += 1

            edge_a = _best_edge(pair_profiles, "lcb_for_a_bi")
            edge_b = _best_edge(pair_profiles, "lcb_for_b_bi")
            score = None
            if edge_a is not None and edge_b is not None and edge_a["group"] != edge_b["group"]:
                score = min(
                    edge_a["stability"]["lcb_for_a_bi"],
                    edge_b["stability"]["lcb_for_b_bi"],
                )
            stable[key] = {
                "score_bi": score,
                "group_a": edge_a["group"] if edge_a is not None else None,
                "group_b": edge_b["group"] if edge_b is not None else None,
                "edge_a_lcb_bi": edge_a["stability"]["lcb_for_a_bi"] if edge_a is not None else None,
                "edge_b_lcb_bi": edge_b["stability"]["lcb_for_b_bi"] if edge_b is not None else None,
                "primary_eligible": isinstance(score, (int, float)) and score > 0,
                "strict_eligible": isinstance(score, (int, float)) and score > STRICT_MARGIN_BI,
                "overall_gap_signed_bi": overall["gap_bi"],
                "overall_gap_se_bi": overall["se_bi"],
                "overall_ci_low_bi": overall["ci_low_bi"],
                "overall_ci_high_bi": overall["ci_high_bi"],
                "overall_equivalent_gap_3": (
                    isinstance(overall["ci_low_bi"], (int, float))
                    and overall["ci_low_bi"] >= -3
                    and overall["ci_high_bi"] <= 3
                ),
                "overall_equivalent_gap_5": (
                    isinstance(overall["ci_low_bi"], (int, float))
                    and overall["ci_low_bi"] >= -5
                    and overall["ci_high_bi"] <= 5
                ),
            }

    tolerance = 1e-9
    if max_gap_error >= tolerance:
        raise ValueError(f"stable category BI gaps do not reconstruct ({max_gap_error})")
    if len(stable) != len(primary_rows):
        raise ValueError("stable screen did not produce one result per primary dimension view")
    primary_count = sum(bool(result["primary_eligible"]) for result in stable.values())
    strict_count = sum(bool(result["strict_eligible"]) for result in stable.values())
    return stable, {
        "status": "PASS",
        "definition": STABILITY_DEFINITION,
        "pair_views": len(stable),
        "profile_rows": profile_rows,
        "primary_eligible_views_before_ui_controls": primary_count,
        "strict_eligible_views_before_ui_controls": strict_count,
        "max_profile_bi_gap_reconstruction_error": max_gap_error,
        "reconstruction_tolerance": tolerance,
    }
