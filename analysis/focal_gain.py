"""Build one-model complementarity versus EC aggregation-gain site data.

The input panel is the post-merge model-version panel.  For a fixed focal
model, every eligible GPT/Claude partner is evaluated on the exact pair-common
support.  The EC forecast is the symmetric odds pool

    sigmoid(0.56 * (logit(p_focal) + logit(p_partner))).

The chart outcome is the fractional reduction in official difficulty-adjusted
Brier loss relative to the fixed focal model, not relative to the hindsight
better constituent.
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

from analysis.high_loss_diagnostics import details_from_metric_row

KEY = ("date", "source", "event_id", "horizon")
PAIR_METRICS = (
    "adjusted_pog",
    "adjusted_high_loss_lift_025",
    "adjusted_loss_pearson_corr",
    "total_variation",
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


def ec_prediction(focal: float, partner: float, weight: float) -> float:
    return sigmoid(weight * (logit(focal) + logit(partner)))


def official_mean(rows: Iterable[tuple[str, float]]) -> float:
    grouped: dict[str, list[float]] = defaultdict(list)
    for origin, value in rows:
        grouped[origin].append(value)
    means = [sum(grouped[origin]) / len(grouped[origin]) for origin in ("Dataset", "Market") if grouped[origin]]
    if not means:
        raise ValueError("official mean requires Dataset or Market observations")
    return sum(means) / len(means)


def read_panel(path: Path, focal: str) -> tuple[dict[tuple[str, ...], dict[str, str]], dict[str, dict[tuple[str, ...], dict[str, str]]]]:
    focal_rows: dict[tuple[str, ...], dict[str, str]] = {}
    partners: dict[str, dict[tuple[str, ...], dict[str, str]]] = defaultdict(dict)
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {*KEY, "model_name", "prediction", "outcome", "origin_type", "question_fixed_effect", "normalization_term"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"merged panel missing fields: {sorted(missing)}")
        for row in reader:
            model = row["model_name"].strip()
            lowered = model.casefold()
            if model != focal and not (lowered.startswith("gpt") or lowered.startswith("claude")):
                continue
            key = tuple(row[field] for field in KEY)
            target = focal_rows if model == focal else partners[model]
            if key in target:
                raise ValueError(f"duplicate model-target row for {model}: {key}")
            target[key] = row
    if not focal_rows:
        raise ValueError(f"focal model not found: {focal}")
    return focal_rows, dict(partners)


def read_pair_metrics(path: Path, focal: str) -> dict[str, dict[str, str]]:
    open_file = gzip.open if path.suffix == ".gz" else open
    output: dict[str, dict[str, str]] = {}
    with open_file(path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("global_scope") != "official_full" or row.get("eligible") != "1":
                continue
            if focal not in (row["model_a"], row["model_b"]):
                continue
            partner = row["model_b"] if row["model_a"] == focal else row["model_a"]
            lowered = partner.casefold()
            if not (lowered.startswith("gpt") or lowered.startswith("claude")):
                continue
            output[partner] = row
    return output


def adjusted_loss(row: Mapping[str, str], prediction: float) -> float:
    outcome = float(row["outcome"])
    return (
        (prediction - outcome) ** 2
        - float(row["question_fixed_effect"])
        + float(row["normalization_term"])
    )


def build_payload(panel_path: Path, pair_path: Path, focal: str, weight: float) -> dict[str, Any]:
    focal_rows, partner_panels = read_panel(panel_path, focal)
    pair_metrics = read_pair_metrics(pair_path, focal)
    points: list[dict[str, Any]] = []

    for partner, metric_row in sorted(pair_metrics.items()):
        partner_rows = partner_panels.get(partner, {})
        common = sorted(set(focal_rows) & set(partner_rows))
        expected = int(metric_row["n_overlap"])
        if len(common) != expected:
            raise ValueError(f"pair support mismatch for {partner}: panel={len(common)}, metrics={expected}")

        focal_losses: list[tuple[str, float]] = []
        partner_losses: list[tuple[str, float]] = []
        aggregate_losses: list[tuple[str, float]] = []
        raw_focal: list[tuple[str, float]] = []
        raw_aggregate: list[tuple[str, float]] = []
        dates: set[str] = set()
        for key in common:
            a = focal_rows[key]
            b = partner_rows[key]
            if a["outcome"] != b["outcome"] or a["origin_type"] != b["origin_type"]:
                raise ValueError(f"misaligned pair rows for {partner}: {key}")
            origin = a["origin_type"]
            pa = float(a["prediction"])
            pb = float(b["prediction"])
            outcome = float(a["outcome"])
            aggregate = ec_prediction(pa, pb, weight)
            focal_losses.append((origin, adjusted_loss(a, pa)))
            partner_losses.append((origin, adjusted_loss(b, pb)))
            aggregate_losses.append((origin, adjusted_loss(a, aggregate)))
            raw_focal.append((origin, (pa - outcome) ** 2))
            raw_aggregate.append((origin, (aggregate - outcome) ** 2))
            dates.add(a["date"][:10])

        focal_brier = official_mean(focal_losses)
        partner_brier = official_mean(partner_losses)
        aggregate_brier = official_mean(aggregate_losses)
        focal_raw_brier = official_mean(raw_focal)
        aggregate_raw_brier = official_mean(raw_aggregate)
        if focal_brier <= 0 or focal_raw_brier <= 0:
            raise ValueError(f"non-positive focal Brier denominator for {partner}")

        pog = float(metric_row["adjusted_pog"])
        lift_text = metric_row["adjusted_high_loss_lift_025"].strip()
        lift = float(lift_text) if lift_text else None
        corr = float(metric_row["adjusted_loss_pearson_corr"])
        tv = float(metric_row["total_variation"])
        high_loss_diagnostics = details_from_metric_row(metric_row, reverse=metric_row["model_a"] != focal)
        points.append(
            {
                "partner": partner,
                "partner_family": "GPT" if partner.casefold().startswith("gpt") else "Claude",
                "n_overlap": len(common),
                "n_dates": len(dates),
                "date_min": min(dates),
                "date_max": max(dates),
                "near_bi": metric_row["near_bi"] == "1",
                "bi_gap": float(metric_row["bi_gap_common"]),
                "focal_adjusted_brier": focal_brier,
                "partner_adjusted_brier": partner_brier,
                "aggregate_adjusted_brier": aggregate_brier,
                "gain_fraction": (focal_brier - aggregate_brier) / focal_brier,
                "raw_gain_fraction": (focal_raw_brier - aggregate_raw_brier) / focal_raw_brier,
                "high_loss_diagnostics": high_loss_diagnostics,
                "metrics": {
                    "adjusted_pog": {"raw": pog, "complementarity": pog},
                    "high_loss_lift": {"raw": lift, "complementarity": None if lift is None else 1 - lift,
                                       "reason": high_loss_diagnostics["reason"]},
                    "adjusted_loss_corr": {"raw": corr, "complementarity": -corr},
                    "total_variation": {"raw": tv, "complementarity": tv},
                },
            }
        )

    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-30",
        "scope": "official_full",
        "focal_model": focal,
        "partner_scope": "GPT and Claude model versions only",
        "aggregation": {
            "id": "ec_w0.56",
            "label": "EC odds pool · w = 0.56",
            "weight": weight,
            "formula": "sigmoid(0.56 * (logit(p_focal) + logit(p_partner)))",
        },
        "outcome": {
            "id": "adjusted_brier_gain_fraction_vs_focal",
            "label": "EC gain fraction vs fixed focal model",
            "formula": "(focal_adjusted_brier - aggregate_adjusted_brier) / focal_adjusted_brier",
            "positive_means": "EC improves on the fixed focal model",
            "weighting": "equal-weight mean of Dataset and Market adjusted-Brier strata on pair-common support",
        },
        "near_bi": {
            "threshold_bi_points": 2.0,
            "definition": "absolute common-support Brier Index gap <= 2.0 points",
        },
        "metric_orientation": {
            "adjusted_pog": "raw value; higher means lower model dependence",
            "high_loss_lift": "1 - raw lift; higher means fewer joint high-loss errors than independence",
            "adjusted_loss_corr": "negative raw correlation; higher means less aligned adjusted losses",
            "total_variation": "mean absolute prediction-probability difference; higher means more diversity",
        },
        "provenance": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "pair_metrics": str(pair_path),
            "pair_metrics_sha256": sha256_file(pair_path),
            "merged_model_rule": "one outcome-blind representative configuration per exact model version",
        },
        "points": points,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel_model_versions.csv"))
    parser.add_argument("--pair-metrics", type=Path, default=Path("data/derived/global_baseline_pair_metrics.csv.gz"))
    parser.add_argument("--focal", default="GPT-4.1-2025-04-14")
    parser.add_argument("--weight", type=float, default=0.56)
    parser.add_argument("--output", type=Path, default=Path("site/public/data/focal-gain/gpt-4-1-2025-04-14.json"))
    args = parser.parse_args()
    payload = build_payload(args.panel, args.pair_metrics, args.focal, args.weight)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "points": len(payload["points"]), "near_bi_points": sum(point["near_bi"] for point in payload["points"])}, indent=2))


if __name__ == "__main__":
    main()
