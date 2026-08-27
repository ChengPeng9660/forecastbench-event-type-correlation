"""Evaluate upper-left exact configurations in model-to-model pools.

This module produces the two Site blocks requested for the market-performance
study:

* ``fixed`` uses the 18 exact configurations that were stable in the upper-left
  quadrant in at least 16 of the 20 previously released cross-fit directions.
  It scores every eligible model pair once on their common Polymarket support.
* ``crossfit`` repeats an event-disjoint 50/50 split ten times.  In each
  direction, the training fold alone selects the upper-left configurations;
  pair diversity is measured on train and aggregation BI on the opposite test
  fold.  A/B then swap and pair results are averaged across all eligible
  directions.

The user-requested market reference is deliberately *unmatched*: each block
compares pair BI with the direct mean Polymarket BI for the corresponding full
evaluation sample, rather than intersecting market observations with each
model pair.  The payload labels this limitation explicitly.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import pstdev
from typing import Any, Iterable, Mapping

from analysis.closed_form_aggregation import single_brier, write_csv
from analysis.freeze_exposed_market_aggregation import exclude_imputed_polymarket_rows
from analysis.market_diversity_performance import (
    adjusted_brier,
    information_metadata,
    probability_pearson,
    prompt_metadata,
    read_exact_panel,
)
from analysis.metrics import brier_index, pearson_correlation
from analysis.pair_aggregation import (
    dependence_support,
    event_fold,
    score_aggregation_support,
    sha256_file,
)
from analysis.polymarket_aggregation import build_freeze_panel, read_freeze_snapshots


METHODS = ("simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds")
METHOD_LABELS = {
    "simple_mean": "Simple Mean",
    "log_odds_mean": "Log-odds Mean",
    "ec_w0_56": "EC · w = 0.56",
    "piecewise_odds": "Piecewise Odds",
}
METRICS = (
    "prediction_diversity",
    "adjusted_pog",
    "high_loss_diversity",
    "adjusted_loss_diversity",
)

# Fixed from the released ``plot_upper_left`` candidate-frequency artifact:
# selected in at least 16 of 20 train-fold directions.  Exact information and
# prompt conditions are intentionally preserved.
FIXED_UPPER_LEFT_CONFIGURATIONS = (
    "Claude-3-7-Sonnet-20250219 (scratchpad with freeze values)",
    "Claude-3-7-Sonnet-20250219 (zero shot with freeze values)",
    "Claude-Haiku-4-5-20251001 (zero shot with freeze values)",
    "Claude-Opus-4-1-20250805 (zero shot with freeze values)",
    "Claude-Sonnet-4-5-20250929 (zero shot with freeze values)",
    "DeepSeek-R1 (scratchpad with freeze values)",
    "DeepSeek-R1 (zero shot with freeze values)",
    "DeepSeek-V3 (zero shot with freeze values)",
    "GPT-5-2025-08-07 (zero shot with freeze values)",
    "GPT-5.1-2025-11-13 (zero shot with freeze values)",
    "Gemini-3-Pro-Preview (zero shot with freeze values)",
    "Grok-4-0709 (zero shot with freeze values)",
    "Grok-4-1-Fast-Reasoning (zero shot with freeze values)",
    "Grok-4-Fast-Reasoning (zero shot with freeze values)",
    "Kimi-K2-Instruct (zero shot with freeze values)",
    "O3-2025-04-16 (zero shot with freeze values)",
    "O3-Mini-2025-01-31 (zero shot with freeze values)",
    "Qwen3-235B-A22B-Fp8-Tput (zero shot with freeze values)",
)


def _bi(value: float, label: str) -> float:
    result, reason = brier_index(value)
    if result is None:
        raise ValueError(f"undefined BI for {label}: {reason}")
    return result


def _mean(values: Iterable[float]) -> float:
    materialized = list(values)
    if not materialized:
        raise ValueError("mean requires at least one value")
    return sum(materialized) / len(materialized)


def _percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("percentile requires values")
    if len(ordered) == 1:
        return ordered[0]
    position = quantile * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def _diversity(
    first: Mapping[tuple[str, ...], Mapping[str, str]],
    second: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
) -> dict[str, float | None]:
    prediction_r, prediction_reason = pearson_correlation(
        [float(first[key]["prediction"]) for key in keys],
        [float(second[key]["prediction"]) for key in keys],
    )
    dependence = dependence_support(first, second, keys, 2.0, 0.25)
    return {
        "prediction_diversity": None if prediction_reason else 1 - prediction_r,
        "adjusted_pog": dependence["metrics"]["adjusted_pog"]["complementarity"],
        "high_loss_diversity": dependence["metrics"]["high_loss_lift"]["complementarity"],
        "adjusted_loss_diversity": dependence["metrics"]["adjusted_loss_corr"]["complementarity"],
    }


def _metadata(name: str, source: Mapping[str, Mapping[str, str]]) -> dict[str, str]:
    configuration = source[name]["model_configuration"]
    prompt_id, prompt_label = prompt_metadata(configuration)
    information_id, information_label = information_metadata(configuration)
    return {
        "name": name,
        "canonical_model_version": source[name]["canonical_model_version"],
        "provider": source[name]["provider"],
        "prompt_type": prompt_id,
        "prompt_label": prompt_label,
        "information_type": information_id,
        "information_label": information_label,
    }


def _market_bi(
    market_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
    label: str,
) -> float:
    return _bi(single_brier(market_panel, keys), label)


def fixed_block(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    metadata: Mapping[str, Mapping[str, str]],
    market_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    minimum_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    missing = [name for name in FIXED_UPPER_LEFT_CONFIGURATIONS if name not in panel]
    if missing:
        raise ValueError(f"fixed upper-left configurations missing from panel: {missing}")
    market_keys = sorted(market_panel)
    market_bi = _market_bi(market_panel, market_keys, "fixed overall market")
    rows: list[dict[str, Any]] = []
    excluded: dict[str, str] = {}
    for first, second in combinations(FIXED_UPPER_LEFT_CONFIGURATIONS, 2):
        keys = sorted(
            key for key in set(panel[first]) & set(panel[second])
            if key[1].casefold() == "polymarket" and key in market_panel
        )
        pair_id = f"{first} × {second}"
        if len(keys) < minimum_overlap:
            excluded[pair_id] = f"pair support {len(keys)} < {minimum_overlap}"
            continue
        diversity = _diversity(panel[first], panel[second], keys)
        scores = score_aggregation_support(
            panel[first], panel[second], keys, ec_weight, piecewise_threshold
        )
        for method in METHODS:
            method_bi = scores["brier_index"][method]
            rows.append(
                {
                    "pair_id": pair_id,
                    "model_a": first,
                    "model_b": second,
                    "method": method,
                    "method_label": METHOD_LABELS[method],
                    "n_pair": len(keys),
                    "date_min": min(key[0][:10] for key in keys),
                    "date_max": max(key[0][:10] for key in keys),
                    "diversity": diversity,
                    "aggregation_bi": method_bi,
                    "market_bi": market_bi,
                    "aggregation_minus_market_bi": method_bi - market_bi,
                    "beats_market": method_bi > market_bi,
                }
            )
    return {
        "title": "Fixed upper-left configurations",
        "description": (
            "The 18 exact configurations that were stable in the upper-left selection are "
            "fixed before this analysis. Every eligible pair is scored once on common "
            "Polymarket pair support with an available freeze-time market probability."
        ),
        "models": [_metadata(name, metadata) for name in FIXED_UPPER_LEFT_CONFIGURATIONS],
        "market": {
            "brier_index": market_bi,
            "n": len(market_keys),
            "date_min": min(key[0][:10] for key in market_keys),
            "date_max": max(key[0][:10] for key in market_keys),
            "support": "overall Polymarket support; not pair matched",
        },
        "eligible_pairs": len({row["pair_id"] for row in rows}),
        "excluded_pairs": excluded,
        "rows": rows,
    }, rows


def _select_train_upper_left(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    metadata: Mapping[str, Mapping[str, str]],
    market_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    seed: int,
    train_fold: str,
    minimum_overlap: int,
) -> tuple[list[str], dict[str, float], list[dict[str, Any]]]:
    candidates: list[dict[str, Any]] = []
    for name, rows in panel.items():
        keys = sorted(
            key for key in set(rows) & set(market_panel)
            if event_fold(key[1], key[2], seed) == train_fold
        )
        if len(keys) < minimum_overlap:
            continue
        prediction_r = probability_pearson(rows, market_panel, keys)
        if prediction_r is None:
            continue
        model_bi = _bi(adjusted_brier(rows, keys), f"train model {name}")
        candidates.append(
            {
                "name": name,
                "provider": metadata[name]["provider"],
                "n_train_market": len(keys),
                "market_prediction_diversity": 1 - prediction_r,
                "train_bi": model_bi,
            }
        )
    diversity_q25 = _percentile(
        [row["market_prediction_diversity"] for row in candidates], 0.25
    )
    bi_q75 = _percentile([row["train_bi"] for row in candidates], 0.75)
    selected = [
        row["name"] for row in candidates
        if row["market_prediction_diversity"] <= diversity_q25
        and row["train_bi"] >= bi_q75
    ]
    return sorted(selected), {
        "prediction_diversity_q25": diversity_q25,
        "brier_index_q75": bi_q75,
    }, candidates


def crossfit_block(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    metadata: Mapping[str, Mapping[str, str]],
    market_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    split_seeds: list[int],
    minimum_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    evaluations: list[dict[str, Any]] = []
    selections: list[dict[str, Any]] = []
    for repetition, seed in enumerate(split_seeds, start=1):
        for train_fold, test_fold in (("A", "B"), ("B", "A")):
            selected, thresholds, candidates = _select_train_upper_left(
                panel, metadata, market_panel, seed, train_fold, minimum_overlap
            )
            test_market_keys = sorted(
                key for key in market_panel
                if event_fold(key[1], key[2], seed) == test_fold
            )
            market_bi = _market_bi(
                market_panel, test_market_keys, f"crossfit market {seed} {test_fold}"
            )
            selection_id = f"r{repetition}:{train_fold}->{test_fold}"
            selections.append(
                {
                    "selection_id": selection_id,
                    "repetition": repetition,
                    "seed": seed,
                    "train_fold": train_fold,
                    "test_fold": test_fold,
                    "eligible_candidates": len(candidates),
                    "selected_count": len(selected),
                    "selected_models": selected,
                    "thresholds": thresholds,
                    "test_market_bi": market_bi,
                    "test_market_n": len(test_market_keys),
                }
            )
            for first, second in combinations(selected, 2):
                train_keys = sorted(
                    key for key in set(panel[first]) & set(panel[second])
                    if key[1].casefold() == "polymarket" and key in market_panel
                    and event_fold(key[1], key[2], seed) == train_fold
                )
                test_keys = sorted(
                    key for key in set(panel[first]) & set(panel[second])
                    if key[1].casefold() == "polymarket" and key in market_panel
                    and event_fold(key[1], key[2], seed) == test_fold
                )
                if min(len(train_keys), len(test_keys)) < minimum_overlap:
                    continue
                diversity = _diversity(panel[first], panel[second], train_keys)
                scores = score_aggregation_support(
                    panel[first], panel[second], test_keys, ec_weight, piecewise_threshold
                )
                pair_id = f"{first} × {second}"
                for method in METHODS:
                    method_bi = scores["brier_index"][method]
                    evaluations.append(
                        {
                            "pair_id": pair_id,
                            "model_a": first,
                            "model_b": second,
                            "method": method,
                            "method_label": METHOD_LABELS[method],
                            "selection_id": selection_id,
                            "repetition": repetition,
                            "seed": seed,
                            "train_fold": train_fold,
                            "test_fold": test_fold,
                            "n_train": len(train_keys),
                            "n_test": len(test_keys),
                            "train_diversity": diversity,
                            "test_aggregation_bi": method_bi,
                            "test_market_bi": market_bi,
                            "test_aggregation_minus_market_bi": method_bi - market_bi,
                            "test_beats_market": method_bi > market_bi,
                        }
                    )

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in evaluations:
        grouped[(row["pair_id"], row["method"])].append(row)
    rows: list[dict[str, Any]] = []
    for (_, method), records in sorted(grouped.items()):
        first = records[0]["model_a"]
        second = records[0]["model_b"]
        aggregation_values = [row["test_aggregation_bi"] for row in records]
        market_values = [row["test_market_bi"] for row in records]
        aggregation_mean = _mean(aggregation_values)
        market_mean = _mean(market_values)
        by_direction = {
            "a_to_b": [row for row in records if row["train_fold"] == "A"],
            "b_to_a": [row for row in records if row["train_fold"] == "B"],
        }

        def direction_summary(direction: str) -> dict[str, float | int | None]:
            selected_records = by_direction[direction]
            if not selected_records:
                return {
                    "count": 0,
                    "aggregation_bi": None,
                    "market_bi": None,
                    "aggregation_minus_market_bi": None,
                    "beat_market_share": None,
                }
            direction_aggregation = _mean(
                row["test_aggregation_bi"] for row in selected_records
            )
            direction_market = _mean(row["test_market_bi"] for row in selected_records)
            return {
                "count": len(selected_records),
                "aggregation_bi": direction_aggregation,
                "market_bi": direction_market,
                "aggregation_minus_market_bi": direction_aggregation - direction_market,
                "beat_market_share": sum(
                    row["test_beats_market"] for row in selected_records
                ) / len(selected_records),
            }
        diversity = {
            metric: (
                _mean(
                    row["train_diversity"][metric]
                    for row in records
                    if row["train_diversity"][metric] is not None
                )
                if any(row["train_diversity"][metric] is not None for row in records)
                else None
            )
            for metric in METRICS
        }
        rows.append(
            {
                "pair_id": records[0]["pair_id"],
                "model_a": first,
                "model_b": second,
                "method": method,
                "method_label": METHOD_LABELS[method],
                "evaluation_count": len(records),
                "maximum_evaluations": len(split_seeds) * 2,
                "a_to_b": direction_summary("a_to_b"),
                "b_to_a": direction_summary("b_to_a"),
                "mean_n_train": _mean(row["n_train"] for row in records),
                "mean_n_test": _mean(row["n_test"] for row in records),
                "mean_train_diversity": diversity,
                "aggregation_bi": aggregation_mean,
                "aggregation_bi_sd": pstdev(aggregation_values),
                "market_bi": market_mean,
                "market_bi_sd": pstdev(market_values),
                "aggregation_minus_market_bi": aggregation_mean - market_mean,
                "beats_market": aggregation_mean > market_mean,
                "beat_market_share": sum(row["test_beats_market"] for row in records)
                / len(records),
            }
        )

    selected_names = sorted(
        {name for selection in selections for name in selection["selected_models"]}
    )
    return {
        "title": "Train-selected upper-left configurations",
        "description": (
            "Ten deterministic random event splits, evaluated in both directions. "
            "Each training fold selects its own upper-left configurations; pair diversity "
            "is measured on train and aggregation BI on the opposite test fold."
        ),
        "models": [_metadata(name, metadata) for name in selected_names],
        "split_repetitions": len(split_seeds),
        "directions_per_repetition": 2,
        "maximum_pair_evaluations": len(split_seeds) * 2,
        "selection_rule": (
            "train model-market prediction diversity <= fold q25 and train model BI >= fold q75"
        ),
        "eligible_pairs": len({row["pair_id"] for row in rows}),
        "selection_runs": selections,
        "rows": rows,
    }, evaluations, rows


def _csv_rows(rows: list[dict[str, Any]], diversity_field: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in rows:
        diversity = row[diversity_field]
        flattened = {key: value for key, value in row.items() if key != diversity_field}
        flattened.update({f"diversity_{metric}": diversity.get(metric) for metric in METRICS})
        output.append(flattened)
    return output


def build_payload(
    panel_path: Path,
    taxonomy_path: Path,
    processed_root: Path,
    split_seed: int = 20260825,
    split_repetitions: int = 10,
    minimum_overlap: int = 50,
    ec_weight: float = 0.56,
    piecewise_threshold: float = 5.0,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    panel, metadata, panel_audit = read_exact_panel(panel_path)
    panel, imputation_audit = exclude_imputed_polymarket_rows(panel, processed_root)
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    market_panel, match_audit = build_freeze_panel(panel, snapshots)
    fixed, fixed_rows = fixed_block(
        panel, metadata, market_panel, minimum_overlap, ec_weight, piecewise_threshold
    )
    split_seeds = [split_seed + offset for offset in range(split_repetitions)]
    crossfit, evaluation_rows, crossfit_rows = crossfit_block(
        panel,
        metadata,
        market_panel,
        split_seeds,
        minimum_overlap,
        ec_weight,
        piecewise_threshold,
    )
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-27",
        "title": "Upper-left model-pair aggregation",
        "scope": (
            "Exact ForecastBench configurations on non-imputed Polymarket events with an "
            "available freeze-time market probability; "
            "prompt and information conditions remain distinct."
        ),
        "methods": [{"id": method, "label": METHOD_LABELS[method]} for method in METHODS],
        "metrics": {
            "prediction_diversity": {
                "label": "Prediction diversity",
                "axis": "1 − prediction-level Pearson r",
            },
            "adjusted_pog": {
                "label": "Adjusted POG",
                "axis": "Adjusted pairwise oracle gain",
            },
            "high_loss_diversity": {
                "label": "High-loss diversity",
                "axis": "1 − adjusted high-loss lift",
            },
            "adjusted_loss_diversity": {
                "label": "Adjusted-loss diversity",
                "axis": "− adjusted-loss Pearson correlation",
            },
        },
        "market_reference": {
            "comparison": "direct mean market BI",
            "pair_matched_support": False,
            "interpretation": (
                "Descriptive comparison with the overall evaluation-sample Polymarket BI; "
                "not an identical-support head-to-head test."
            ),
        },
        "fixed": fixed,
        "crossfit": crossfit,
        "audit": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "taxonomy": str(taxonomy_path),
            "taxonomy_sha256": sha256_file(taxonomy_path),
            "processed_root": str(processed_root),
            "minimum_pair_fold_overlap": minimum_overlap,
            "split_seeds": split_seeds,
            "split_unit": "lowercase source + event_id; every date and horizon remains in one fold",
            "split_directions": ["A->B", "B->A"],
            "selection_uses_test_outcomes": False,
            "pair_aggregation_uses_test_outcomes": False,
            "fixed_configuration_count": len(FIXED_UPPER_LEFT_CONFIGURATIONS),
            "fixed_pair_method_rows": len(fixed_rows),
            "crossfit_fold_method_rows": len(evaluation_rows),
            "crossfit_averaged_pair_method_rows": len(crossfit_rows),
            "panel_audit": panel_audit,
            "imputation_audit": imputation_audit,
            "snapshot_audit": snapshot_audit,
            "match_audit": match_audit,
        },
    }, fixed_rows, evaluation_rows, crossfit_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument("--processed-root", type=Path, required=True)
    parser.add_argument("--split-seed", type=int, default=20260825)
    parser.add_argument("--split-repetitions", type=int, default=10)
    parser.add_argument("--minimum-overlap", type=int, default=50)
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "site/public/data/pair-aggregation/upper-left-model-pairs.json"
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/derived/upper_left_model_pair_aggregation"),
    )
    args = parser.parse_args()
    payload, fixed_rows, evaluation_rows, crossfit_rows = build_payload(
        args.panel,
        args.taxonomy,
        args.processed_root,
        args.split_seed,
        args.split_repetitions,
        args.minimum_overlap,
        args.ec_weight,
        args.piecewise_threshold,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "summary.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(args.output_dir / "fixed_pair_methods.csv", _csv_rows(fixed_rows, "diversity"))
    write_csv(
        args.output_dir / "crossfit_fold_methods.csv.gz",
        _csv_rows(evaluation_rows, "train_diversity"),
    )
    write_csv(
        args.output_dir / "crossfit_pair_method_averages.csv",
        _csv_rows(crossfit_rows, "mean_train_diversity"),
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "fixed_configurations": payload["audit"]["fixed_configuration_count"],
                "fixed_pairs": payload["fixed"]["eligible_pairs"],
                "crossfit_pair_method_rows": payload["audit"][
                    "crossfit_averaged_pair_method_rows"
                ],
                "crossfit_fold_method_rows": payload["audit"][
                    "crossfit_fold_method_rows"
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
