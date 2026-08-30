"""Evaluate every ordered pair of canonical without-freeze ForecastBench models.

Each eligible unordered pair is expanded into two ordered observations.  The
first model is always the fixed focal/base model, so every displayed gain uses
that model as its denominator.  Dependence signals and Directional CF weights
use one event-disjoint training fold; aggregation outcomes use the opposite
test fold.  Ten reproducible splits are evaluated in both directions.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any, Iterable

from analysis.closed_form_aggregation import (
    aggregate_pairs,
    correlation,
    evaluate_pair,
    write_csv,
)
from analysis.pair_aggregation import family, read_panel, sha256_file


EXPERIMENT = "fixed_focal_without_freeze"
METHODS = (
    "ec_w0_56",
    "simple_mean",
    "log_odds_mean",
    "piecewise_odds",
    "cf_directional",
    "best_single",
)
METRICS = ("adjusted_pog", "high_loss_lift", "adjusted_loss_corr", "total_variation")
PROVIDERS = {
    "GPT": "OpenAI",
    "Claude": "Anthropic",
    "Gemini": "Google",
    "Qwen": "Qwen",
    "DeepSeek": "DeepSeek",
    "Kimi": "Moonshot",
}
METHOD_METADATA = {
    "ec_w0_56": {
        "label": "EC · w = 0.56",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "sigmoid(0.56 × (logit(p_base) + logit(p_partner)))",
    },
    "simple_mean": {
        "label": "Simple Mean",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "(p_base + p_partner) / 2",
    },
    "log_odds_mean": {
        "label": "Log-odds Mean",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "sigmoid((logit(p_base) + logit(p_partner)) / 2)",
    },
    "piecewise_odds": {
        "label": "Piecewise Odds",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "threshold-5 piecewise transform of the summed base/partner logits",
    },
    "cf_directional": {
        "label": "Directional CF",
        "role": "Train-fold fitted closed-form pool",
        "outcome_blind_at_test": True,
        "formula": "direction-specific clipped C / D weight fitted around the fixed base",
    },
    "best_single": {
        "label": "Best Single",
        "role": "Hindsight benchmark; not deployable",
        "outcome_blind_at_test": False,
        "formula": "higher test-fold adjusted Brier Index of base and partner on identical support",
    },
}
DIVERSITY_METADATA = {
    "adjusted_pog": {
        "label": "Adjusted POG",
        "axis": "Adjusted pairwise oracle gain",
        "orientation": "higher means greater base–partner diversity",
    },
    "high_loss_lift": {
        "label": "High-loss Lift",
        "axis": "Complementarity orientation · 1 − high-loss lift",
        "orientation": "higher means greater base–partner diversity",
    },
    "adjusted_loss_corr": {
        "label": "Loss Correlation",
        "axis": "Complementarity orientation · − adjusted-loss correlation",
        "orientation": "higher means greater base–partner diversity",
    },
    "total_variation": {
        "label": "Total variation (TV)",
        "axis": "Mean absolute forecast difference · TV",
        "orientation": "higher means greater base–partner diversity",
    },
}


def read_panel_configuration_audit(path: Path, models: set[str]) -> dict[str, Any]:
    configurations: dict[str, set[str]] = {model: set() for model in models}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            model = row["model_name"].strip()
            if model in configurations:
                configurations[model].add(row.get("model_configuration", "").strip())
    freeze_models = sorted(
        model
        for model, values in configurations.items()
        if any("with freeze values" in value.casefold() for value in values)
    )
    return {
        "model_configurations": {
            model: sorted(values) for model, values in sorted(configurations.items())
        },
        "with_freeze_model_count": len(freeze_models),
        "with_freeze_models": freeze_models,
        "all_models_exclude_freeze_values": not freeze_models,
    }


def selected_pairs(pair_payload: dict[str, Any]) -> list[tuple[str, str]]:
    return [
        (point["model_a"], point["model_b"])
        for point in pair_payload["cross_fit"]["eligible_points"]
    ]


def aggregate_view(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return aggregate_pairs(rows)


def row_index(rows: Iterable[dict[str, Any]]) -> dict[tuple[str, str, str], dict[str, Any]]:
    return {
        (str(row["model_a"]), str(row["model_b"]), str(row["method"])): row
        for row in rows
    }


def fixed_view(
    index: dict[tuple[str, str, str], dict[str, Any]],
    base: str,
    partner: str,
) -> dict[str, Any]:
    anchor = index[(base, partner, "anchor")]
    partner_row = index[(base, partner, "partner")]
    base_brier = float(anchor["adjusted_brier"])
    partner_brier = float(partner_row["adjusted_brier"])
    aggregation: dict[str, dict[str, Any]] = {}
    for method in METHODS:
        row = index[(base, partner, method)]
        method_brier = float(row["adjusted_brier"])
        aggregation[method] = {
            "brier_index": float(row["brier_index"]),
            "gain_vs_base": float(row["gain_vs_anchor"]),
            "gain_vs_partner": (
                (partner_brier - method_brier) / partner_brier
                if partner_brier > 0 else None
            ),
            "gain_vs_best_single": float(row["gain_vs_best_single"]),
            "test_target_cells": int(row["test_target_cells"]),
        }
    return {
        "base_name": base,
        "partner_name": partner,
        "base_brier_index": float(anchor["brier_index"]),
        "partner_brier_index": float(partner_row["brier_index"]),
        "partner_gain_vs_base": (
            (base_brier - partner_brier) / base_brier if base_brier > 0 else None
        ),
        "train_diversity": {
            metric: anchor[f"train_{metric}_complementarity"] for metric in METRICS
        },
        "train_bi_gap": float(anchor["train_bi_gap"]),
        "train_near_bi_share": float(anchor["train_near_bi_share"]),
        "near_bi": float(anchor["train_bi_gap"]) <= 2.0,
        "train_target_cells": int(anchor["train_target_cells"]),
        "test_target_cells": int(anchor["test_target_cells"]),
        "aggregation": aggregation,
    }


def summarize_method(points: list[dict[str, Any]], method: str) -> dict[str, Any]:
    scores = [point["combined"]["aggregation"][method] for point in points]
    support = sum(score["test_target_cells"] for score in scores)

    def weighted(field: str) -> float | None:
        values = [
            (score[field], score["test_target_cells"])
            for score in scores
            if score[field] is not None
        ]
        total = sum(weight for _, weight in values)
        return sum(value * weight for value, weight in values) / total if total else None

    return {
        "method": method,
        "ordered_pair_count": len(scores),
        "test_target_cells": support,
        "support_weighted_brier_index": weighted("brier_index"),
        "support_weighted_gain_vs_base": weighted("gain_vs_base"),
        "support_weighted_gain_vs_partner": weighted("gain_vs_partner"),
        "support_weighted_gain_vs_best_single": weighted("gain_vs_best_single"),
        "positive_vs_base_pairs": sum(score["gain_vs_base"] > 0 for score in scores),
    }


def focal_correlation_summary(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    focal_models = sorted({point["base_model"] for point in points}, key=str.casefold)
    for base in focal_models:
        focal = [point for point in points if point["base_model"] == base]
        for method in METHODS:
            for metric in METRICS:
                x = [point["combined"]["train_diversity"][metric] for point in focal]
                y = [point["combined"]["aggregation"][method]["gain_vs_base"] for point in focal]
                near = [point for point in focal if point["combined"]["near_bi"]]
                output.append(
                    {
                        "base_model": base,
                        "method": method,
                        "metric": metric,
                        "ordered_pair_count": len(focal),
                        "defined_pair_count": sum(
                            first is not None and second is not None
                            and math.isfinite(first) and math.isfinite(second)
                            for first, second in zip(x, y)
                        ),
                        "pearson": correlation(x, y),
                        "spearman": correlation(x, y, spearman=True),
                        "near_bi_pair_count": len(near),
                        "near_bi_pearson": correlation(
                            [point["combined"]["train_diversity"][metric] for point in near],
                            [point["combined"]["aggregation"][method]["gain_vs_base"] for point in near],
                        ),
                    }
                )
    return output


def run_experiment(
    panel_path: Path,
    pair_payload_path: Path,
    split_seed: int = 20260825,
    split_repetitions: int = 10,
    minimum_fold_overlap: int = 50,
    ec_weight: float = 0.56,
    piecewise_threshold: float = 5.0,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    split_seeds = [split_seed + offset for offset in range(split_repetitions)]
    panel, alias_audit = read_panel(panel_path)
    pair_payload = json.loads(pair_payload_path.read_text(encoding="utf-8"))
    pairs = selected_pairs(pair_payload)
    methods_to_keep = {"anchor", "partner", *METHODS}
    fold_rows: list[dict[str, Any]] = []
    for first, second in pairs:
        for base, partner in ((first, second), (second, first)):
            rows = evaluate_pair(
                EXPERIMENT,
                base,
                partner,
                panel[base],
                panel[partner],
                split_seeds,
                minimum_fold_overlap,
                ec_weight,
                piecewise_threshold,
            )
            fold_rows.extend(row for row in rows if row["method"] in methods_to_keep)

    combined_rows = aggregate_view(fold_rows)
    direction_rows = {
        direction: aggregate_view(
            [row for row in fold_rows if row["train_fold"] == train_fold]
        )
        for direction, train_fold in (("a_to_b", "A"), ("b_to_a", "B"))
    }
    combined_index = row_index(combined_rows)
    direction_indexes = {
        direction: row_index(rows) for direction, rows in direction_rows.items()
    }
    ordered_pairs = [
        ordered
        for first, second in pairs
        for ordered in ((first, second), (second, first))
    ]
    points: list[dict[str, Any]] = []
    for base, partner in ordered_pairs:
        base_family = family(base)
        partner_family = family(partner)
        if base_family not in PROVIDERS or partner_family not in PROVIDERS:
            raise ValueError(f"unsupported fixed-focal pair: {base} -> {partner}")
        combined = fixed_view(combined_index, base, partner)
        points.append(
            {
                "base_model": base,
                "base_family": base_family,
                "base_provider": PROVIDERS[base_family],
                "partner_model": partner,
                "partner_family": partner_family,
                "partner_provider": PROVIDERS[partner_family],
                "pair_group": combined_index[(base, partner, "anchor")]["pair_group"],
                "n_common": int(combined["test_target_cells"]) // split_repetitions,
                "combined": combined,
                "directions": {
                    direction: fixed_view(index, base, partner)
                    for direction, index in direction_indexes.items()
                },
            }
        )
    points.sort(
        key=lambda point: (
            point["base_provider"].casefold(),
            point["base_model"].casefold(),
            point["partner_provider"].casefold(),
            point["partner_model"].casefold(),
        )
    )
    config_audit = read_panel_configuration_audit(panel_path, set(panel))
    if not config_audit["all_models_exclude_freeze_values"]:
        raise ValueError("canonical panel contains with-freeze configurations")
    site_payload = {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-27",
        "title": "Fixed focal without-freeze model aggregation",
        "scope": (
            "Every eligible ordered pair uses two canonical merged model versions that "
            "were not given ForecastBench freeze values. The selected focal model remains "
            "the base and gain denominator for every partner."
        ),
        "evaluation": {
            "design": "ten-repeat event-disjoint two-fold cross-fit in both directions",
            "split_seeds": split_seeds,
            "fold_views": {
                "combined": "ten A→B and ten B→A evaluations pooled",
                "a_to_b": "A-train diversity and B-test aggregation outcome",
                "b_to_a": "B-train diversity and A-test aggregation outcome",
            },
            "near_bi_threshold": 2.0,
            "diversity_metrics": DIVERSITY_METADATA,
            "methods": METHOD_METADATA,
            "summary_combined": [summarize_method(points, method) for method in METHODS],
            "focal_correlation_summary": focal_correlation_summary(points),
        },
        "audit": {
            "model_count": len(panel),
            "unordered_pair_count": len(pairs),
            "ordered_pair_count": len(points),
            "fold_directions_per_ordered_pair": 2 * split_repetitions,
            "retained_fold_method_rows": len(fold_rows),
            "pair_method_rows": len(combined_rows),
            "all_models_exclude_freeze_values": config_audit[
                "all_models_exclude_freeze_values"
            ],
            "with_freeze_model_count": config_audit["with_freeze_model_count"],
            "near_bi_ordered_pair_count": sum(
                point["combined"]["near_bi"] for point in points
            ),
            "minimum_common_support": min(point["n_common"] for point in points),
            "model_alias_audit": alias_audit,
            "model_configurations": config_audit["model_configurations"],
        },
        "provenance": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "pair_payload": str(pair_payload_path),
            "pair_payload_sha256": sha256_file(pair_payload_path),
            "pair_eligibility": "reuse the released six-family cross-fit eligible pair universe",
            "fixed_base_policy": "the selected focal model is always the anchor; no train-fold model selection",
            "leakage_controls": {
                "diversity": "training fold only",
                "near_bi": "training-fold BI gap only",
                "directional_cf_weights": "training fold only",
                "aggregation_outcome": "opposite test fold only",
            },
        },
        "points": points,
    }
    report = {
        "schema_version": "1.0.0",
        "generated_at": site_payload["generated_at"],
        "design": site_payload["evaluation"],
        "audit": site_payload["audit"],
        "provenance": site_payload["provenance"],
    }
    return report, fold_rows, combined_rows, site_payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--panel",
        type=Path,
        default=Path("data/build/scored_panel_model_versions.csv"),
    )
    parser.add_argument(
        "--pair-payload",
        type=Path,
        default=Path("site/public/data/pair-aggregation/all-six-family-pairs.json"),
    )
    parser.add_argument("--split-seed", type=int, default=20260825)
    parser.add_argument("--split-repetitions", type=int, default=10)
    parser.add_argument("--minimum-fold-overlap", type=int, default=50)
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/derived/fixed_focal_without_freeze"),
    )
    parser.add_argument(
        "--site-output",
        type=Path,
        default=Path(
            "site/public/data/pair-aggregation/fixed-focal-without-freeze.json"
        ),
    )
    args = parser.parse_args()
    report, fold_rows, pair_rows, site_payload = run_experiment(
        args.panel,
        args.pair_payload,
        split_seed=args.split_seed,
        split_repetitions=args.split_repetitions,
        minimum_fold_overlap=args.minimum_fold_overlap,
        ec_weight=args.ec_weight,
        piecewise_threshold=args.piecewise_threshold,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "summary.json").write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(args.output_dir / "fold_method_results.csv.gz", fold_rows)
    write_csv(args.output_dir / "pair_method_results.csv", pair_rows)
    args.site_output.parent.mkdir(parents=True, exist_ok=True)
    args.site_output.write_text(
        json.dumps(site_payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "models": report["audit"]["model_count"],
                "unordered_pairs": report["audit"]["unordered_pair_count"],
                "ordered_pairs": report["audit"]["ordered_pair_count"],
                "fold_method_rows": len(fold_rows),
                "site_output": str(args.site_output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
