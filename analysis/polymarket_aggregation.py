"""Build the Polymarket-freeze aggregation benchmark used by the Site.

For every eligible merged GPT, Claude, Gemini, Qwen, DeepSeek, and Kimi
version, this module pairs the model forecast with Polymarket's probability at
the ForecastBench freeze snapshot.  The freeze probability is read from the
audited taxonomy column ``market_prob``, which is the preserved
``freeze_datetime_value`` from the official question-set snapshot.

The same outcome-blind pooling rules and ten-repeat event-disjoint cross-fit
used by the model-pair benchmark are applied here.  Test outcomes never affect
the freeze forecast, a pooling prediction, the train-fold dependence signal,
or train-fold Near-BI eligibility.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any, Mapping

from analysis.pair_aggregation import (
    KEY,
    METHODS,
    aggregate_cross_fit_records,
    dependence_support,
    event_fold,
    family,
    percentile,
    read_panel,
    score_aggregation_support,
    sha256_file,
)
from analysis.polymarket_cleaning import exclude_imputed_polymarket_rows


BASELINE_NAME = "Polymarket Freeze"
def _finite_probability(value: str, *, key: tuple[str, str, str]) -> float:
    try:
        probability = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid freeze probability for {key}: {value!r}") from error
    if not math.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError(f"freeze probability outside [0, 1] for {key}: {probability}")
    return probability


def read_freeze_snapshots(path: Path) -> tuple[dict[tuple[str, str, str], dict[str, str]], dict[str, Any]]:
    snapshots: dict[tuple[str, str, str], dict[str, str]] = {}
    valid_probabilities = 0
    invalid_probability_keys: list[tuple[str, str, str]] = []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"date", "source", "event_id", "market_prob", "freeze_datetime", "question_text", "url"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"taxonomy missing freeze fields: {sorted(missing)}")
        for row in reader:
            if row["source"].strip().casefold() != "polymarket":
                continue
            key = (row["date"][:10], "polymarket", row["event_id"])
            if key in snapshots:
                raise ValueError(f"duplicate Polymarket freeze snapshot: {key}")
            snapshots[key] = dict(row)
            try:
                _finite_probability(row["market_prob"], key=key)
                valid_probabilities += 1
            except ValueError:
                invalid_probability_keys.append(key)
    if not snapshots:
        raise ValueError("taxonomy contains no Polymarket freeze snapshots")
    freeze_dates = [datetime.fromisoformat(row["freeze_datetime"]).date() for row in snapshots.values()]
    due_dates = [date.fromisoformat(key[0]) for key in snapshots]
    lags = sorted((due - freeze).days for due, freeze in zip(due_dates, freeze_dates))
    return snapshots, {
        "polymarket_snapshot_rows": len(snapshots),
        "valid_probability_rows": valid_probabilities,
        "invalid_probability_rows": len(invalid_probability_keys),
        "invalid_probability_examples": [list(key) for key in invalid_probability_keys[:5]],
        "unique_market_ids": len({key[2] for key in snapshots}),
        "freeze_to_due_lag_days": {
            "minimum": min(lags),
            "median": percentile([float(value) for value in lags], 0.5),
            "maximum": max(lags),
        },
    }


def build_freeze_panel(
    model_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    snapshots: Mapping[tuple[str, str, str], Mapping[str, str]],
) -> tuple[dict[tuple[str, ...], dict[str, str]], dict[str, Any]]:
    templates: dict[tuple[str, ...], dict[str, str]] = {}
    consistency_fields = ("outcome", "origin_type", "question_fixed_effect", "normalization_term")
    for rows in model_panel.values():
        for key, row in rows.items():
            if key[1].casefold() != "polymarket":
                continue
            previous = templates.get(key)
            if previous is not None:
                if any(previous[field] != row[field] for field in consistency_fields):
                    raise ValueError(f"inconsistent scored target metadata for {key}")
                continue
            templates[key] = dict(row)

    output: dict[tuple[str, ...], dict[str, str]] = {}
    missing_snapshots: list[tuple[str, ...]] = []
    freeze_datetimes: list[str] = []
    for key, template in sorted(templates.items()):
        snapshot_key = (key[0][:10], "polymarket", key[2])
        snapshot = snapshots.get(snapshot_key)
        if snapshot is None:
            missing_snapshots.append(key)
            continue
        resolved = dict(template)
        resolved["model_name"] = BASELINE_NAME
        resolved["prediction"] = str(_finite_probability(snapshot["market_prob"], key=snapshot_key))
        output[key] = resolved
        freeze_datetimes.append(snapshot["freeze_datetime"])

    if missing_snapshots:
        raise ValueError(
            f"missing freeze snapshots for {len(missing_snapshots)} scored Polymarket targets; "
            f"first={missing_snapshots[0]}"
        )
    if not output:
        raise ValueError("no scored Polymarket targets matched freeze snapshots")
    return output, {
        "scored_polymarket_round_events": len(output),
        "unique_market_ids": len({key[2] for key in output}),
        "forecast_dates": len({key[0][:10] for key in output}),
        "date_min": min(key[0][:10] for key in output),
        "date_max": max(key[0][:10] for key in output),
        "freeze_datetime_min": min(freeze_datetimes),
        "freeze_datetime_max": max(freeze_datetimes),
        "matched_freeze_values": len(output),
        "missing_freeze_values": 0,
    }


def add_reference_gains(point: dict[str, Any]) -> dict[str, Any]:
    briers = point["adjusted_brier"]
    baseline_brier = briers["model_a"]
    model_brier = briers["model_b"]
    point["gain_fraction_vs_polymarket"] = {
        method: (baseline_brier - briers[method]) / baseline_brier if baseline_brier > 0 else None
        for method in METHODS
    }
    point["gain_fraction_vs_model"] = {
        method: (model_brier - briers[method]) / model_brier if model_brier > 0 else None
        for method in METHODS
    }
    return point


def eligible_models(
    model_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    split_seeds: list[int],
    minimum_overlap: int,
    minimum_fold_overlap: int,
) -> tuple[list[str], dict[str, str], dict[str, int]]:
    eligible: list[str] = []
    reasons: dict[str, str] = {}
    overlaps: dict[str, int] = {}
    for model in sorted(model_panel, key=lambda value: (family(value) or "", value.casefold(), value)):
        common = set(model_panel[model]) & set(freeze_panel)
        overlaps[model] = len(common)
        if len(common) < minimum_overlap:
            reasons[model] = f"common Polymarket support {len(common)} < {minimum_overlap}"
            continue
        fold_counts = [
            {
                fold: sum(event_fold(key[1], key[2], seed) == fold for key in common)
                for fold in ("A", "B")
            }
            for seed in split_seeds
        ]
        smallest = min(min(counts.values()) for counts in fold_counts)
        if smallest < minimum_fold_overlap:
            reasons[model] = f"minimum repeated fold support {smallest} < {minimum_fold_overlap}"
            continue
        eligible.append(model)
    return eligible, reasons, overlaps


def point_from_support(
    model: str,
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    model_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
    ec_weight: float,
    piecewise_threshold: float,
    near_bi_gap: float,
    high_loss_threshold: float,
) -> dict[str, Any]:
    dependence = dependence_support(
        freeze_panel,
        model_panel,
        keys,
        near_bi_gap,
        high_loss_threshold,
    )
    aggregation = score_aggregation_support(
        freeze_panel,
        model_panel,
        keys,
        ec_weight,
        piecewise_threshold,
    )
    return add_reference_gains(
        {
            "model_a": BASELINE_NAME,
            "model_b": model,
            "family_a": "Polymarket",
            "family_b": family(model),
            "pair_group": (family(model) or "unknown").casefold(),
            "n_overlap": len(keys),
            "n_dates": aggregation["n_dates"],
            "date_min": aggregation["date_min"],
            "date_max": aggregation["date_max"],
            "near_bi": dependence["near_bi"],
            "bi_gap": dependence["bi_gap"],
            "metrics": dependence["metrics"],
            "adjusted_brier": aggregation["adjusted_brier"],
            "brier_index": aggregation["brier_index"],
            "best_single_side": aggregation["best_single_side"],
            "gain_fraction_vs_best_single": aggregation["gain_fraction_vs_best_single"],
            "past_only_diagnostic": aggregation["past_only_diagnostic"],
        }
    )


def summarize_points(
    eligible_points: list[dict[str, Any]],
    near_bi_points: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    groups = ("all", "gpt", "claude", "gemini", "qwen", "deepseek", "kimi")
    for group in groups:
        for sample, points in (("eligible", eligible_points), ("near_bi", near_bi_points)):
            selected = points if group == "all" else [point for point in points if point["pair_group"] == group]
            for method in METHODS:
                valid = [point for point in selected if point["gain_fraction_vs_polymarket"].get(method) is not None]
                weights = [point["n_overlap"] for point in valid]
                total = sum(weights)

                def weighted(field: str) -> float | None:
                    if not total:
                        return None
                    return sum(point[field][method] * weight for point, weight in zip(valid, weights)) / total

                baseline_gains = [point["gain_fraction_vs_polymarket"][method] for point in valid]
                model_gains = [point["gain_fraction_vs_model"][method] for point in valid]
                best_gains = [point["gain_fraction_vs_best_single"][method] for point in valid]
                rows.append(
                    {
                        "pair_group": group,
                        "sample": sample,
                        "method": method,
                        "pair_count": len(valid),
                        "pair_event_cells": total,
                        "support_weighted_brier_index": (
                            sum(point["brier_index"][method] * weight for point, weight in zip(valid, weights)) / total
                            if total else None
                        ),
                        "support_weighted_gain_vs_polymarket": weighted("gain_fraction_vs_polymarket"),
                        "support_weighted_gain_vs_model": weighted("gain_fraction_vs_model"),
                        "support_weighted_gain_vs_best_single": weighted("gain_fraction_vs_best_single"),
                        "positive_vs_polymarket_pairs": sum(value > 0 for value in baseline_gains),
                        "positive_vs_polymarket_share": (
                            sum(value > 0 for value in baseline_gains) / len(baseline_gains) if baseline_gains else None
                        ),
                        "positive_vs_model_pairs": sum(value > 0 for value in model_gains),
                        "positive_vs_model_share": (
                            sum(value > 0 for value in model_gains) / len(model_gains) if model_gains else None
                        ),
                        "macro_gain_vs_polymarket": (
                            sum(baseline_gains) / len(baseline_gains) if baseline_gains else None
                        ),
                        "macro_gain_vs_model": sum(model_gains) / len(model_gains) if model_gains else None,
                        "macro_gain_vs_best_single": sum(best_gains) / len(best_gains) if best_gains else None,
                    }
                )
    return rows


def build_cross_fit(
    model_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    models: list[str],
    base_points: list[dict[str, Any]],
    split_seeds: list[int],
    minimum_fold_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
    near_bi_gap: float,
    high_loss_threshold: float,
) -> dict[str, Any]:
    base_by_model = {point["model_b"]: point for point in base_points}
    eligible_points: list[dict[str, Any]] = []
    near_bi_points: list[dict[str, Any]] = []
    directional = {
        "a_to_b": {"eligible_points": [], "near_bi_points": []},
        "b_to_a": {"eligible_points": [], "near_bi_points": []},
    }
    all_events: set[tuple[str, str]] = set()
    pair_fold_records = 0
    near_bi_fold_records = 0
    minimum_train: int | None = None
    minimum_test: int | None = None

    for model in models:
        common = sorted(set(freeze_panel) & set(model_panel[model]))
        all_events.update((key[1].casefold(), key[2]) for key in common)
        records: list[dict[str, Any]] = []
        for repetition, seed in enumerate(split_seeds, start=1):
            split = {"A": [], "B": []}
            for key in common:
                split[event_fold(key[1], key[2], seed)].append(key)
            for train_fold, test_fold in (("A", "B"), ("B", "A")):
                train_keys = split[train_fold]
                test_keys = split[test_fold]
                if min(len(train_keys), len(test_keys)) < minimum_fold_overlap:
                    raise ValueError(
                        f"Polymarket cross-fit support below {minimum_fold_overlap} for {model} at seed {seed}"
                    )
                train = dependence_support(
                    freeze_panel,
                    model_panel[model],
                    train_keys,
                    near_bi_gap,
                    high_loss_threshold,
                )
                test = score_aggregation_support(
                    freeze_panel,
                    model_panel[model],
                    test_keys,
                    ec_weight,
                    piecewise_threshold,
                )
                record = {
                    "fold_id": f"split_{repetition:02d}_seed_{seed}__{train_fold}_train__{test_fold}_test",
                    "split_repetition": repetition,
                    "split_seed": seed,
                    "train_fold": train_fold,
                    "test_fold": test_fold,
                    "model_a": BASELINE_NAME,
                    "model_b": model,
                    "family_a": "Polymarket",
                    "family_b": family(model),
                    "pair_group": (family(model) or "unknown").casefold(),
                    "n_train": len(train_keys),
                    "n_test": len(test_keys),
                    "n_train_events": len({key[2] for key in train_keys}),
                    "n_test_events": len({key[2] for key in test_keys}),
                    "train_near_bi": train["near_bi"],
                    "train_bi_gap": train["bi_gap"],
                    "train_model_a_bi": train["model_a_bi"],
                    "train_model_b_bi": train["model_b_bi"],
                    "metrics": train["metrics"],
                    **test,
                }
                records.append(record)
                pair_fold_records += 1
                near_bi_fold_records += int(record["train_near_bi"])
                minimum_train = min(minimum_train or len(train_keys), len(train_keys))
                minimum_test = min(minimum_test or len(test_keys), len(test_keys))

        base = base_by_model[model]
        combined = add_reference_gains(aggregate_cross_fit_records(base, records, "eligible"))
        eligible_points.append(combined)
        qualifying = [record for record in records if record["train_near_bi"]]
        if qualifying:
            near_bi_points.append(
                add_reference_gains(aggregate_cross_fit_records(base, qualifying, "near_bi"))
            )
        for direction_id, train_fold in (("a_to_b", "A"), ("b_to_a", "B")):
            direction_records = [record for record in records if record["train_fold"] == train_fold]
            directional[direction_id]["eligible_points"].append(
                add_reference_gains(aggregate_cross_fit_records(base, direction_records, "eligible"))
            )
            qualifying_direction = [record for record in direction_records if record["train_near_bi"]]
            if qualifying_direction:
                directional[direction_id]["near_bi_points"].append(
                    add_reference_gains(
                        aggregate_cross_fit_records(base, qualifying_direction, "near_bi")
                    )
                )

    assignment_lines = [
        f"{seed}\t{source}\t{event_id}\t{event_fold(source, event_id, seed)}"
        for seed in split_seeds
        for source, event_id in sorted(all_events)
    ]
    assignment_sha = hashlib.sha256(("\n".join(assignment_lines) + "\n").encode()).hexdigest()
    a_counts = [
        sum(event_fold(source, event_id, seed) == "A" for source, event_id in all_events)
        for seed in split_seeds
    ]
    b_counts = [len(all_events) - count for count in a_counts]
    return {
        "schema_version": "1.0.0",
        "evaluation": "ten-repeat two-fold event-level cross-fit",
        "split": {
            "seed": split_seeds[0],
            "seeds": split_seeds,
            "repetitions": len(split_seeds),
            "unit": "Polymarket event_id; every recurring round for one market stays in one fold",
            "assignment": "SHA-256(seed|polymarket|event_id) parity",
            "assignment_sha256": assignment_sha,
            "folds": ["A_train__B_test", "B_train__A_test"],
            "minimum_train_target_rows": minimum_fold_overlap,
            "minimum_test_target_rows": minimum_fold_overlap,
        },
        "leakage_controls": {
            "freeze_probability": "fixed before forecast due date; independent of event outcome",
            "dependence_signal": "train fold only",
            "near_bi": "train-fold BI gap only",
            "aggregation_score": "opposite test fold only",
            "event_disjoint": True,
            "outcomes_used_to_form_current_pool": False,
            "best_single_role": "test-fold hindsight benchmark only; never used to form a pool",
        },
        "audit": {
            "unique_events": len(all_events),
            "fold_a_events_by_repetition": a_counts,
            "fold_b_events_by_repetition": b_counts,
            "pair_fold_records": pair_fold_records,
            "eligible_pairs": len(eligible_points),
            "near_bi_pairs_any_train_fold": len(near_bi_points),
            "near_bi_fold_records": near_bi_fold_records,
            "minimum_observed_train_rows": minimum_train,
            "minimum_observed_test_rows": minimum_test,
        },
        "summary": summarize_points(eligible_points, near_bi_points),
        "eligible_points": eligible_points,
        "near_bi_points": near_bi_points,
        "directional_points": directional,
    }


def build_payload(
    panel_path: Path,
    taxonomy_path: Path,
    processed_root: Path,
    ec_weight: float = 0.56,
    piecewise_threshold: float = 5.0,
    split_seed: int = 20260825,
    split_repetitions: int = 10,
    minimum_overlap: int = 50,
    minimum_fold_overlap: int = 50,
) -> dict[str, Any]:
    split_seeds = [split_seed + offset for offset in range(split_repetitions)]
    model_panel, alias_audit = read_panel(panel_path)
    model_panel, imputation_audit = exclude_imputed_polymarket_rows(
        model_panel, processed_root
    )
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    freeze_panel, match_audit = build_freeze_panel(model_panel, snapshots)
    models, exclusions, overlaps = eligible_models(
        model_panel,
        freeze_panel,
        split_seeds,
        minimum_overlap,
        minimum_fold_overlap,
    )
    points: list[dict[str, Any]] = []
    for model in models:
        common = sorted(set(freeze_panel) & set(model_panel[model]))
        points.append(
            point_from_support(
                model,
                freeze_panel,
                model_panel[model],
                common,
                ec_weight,
                piecewise_threshold,
                near_bi_gap=2.0,
                high_loss_threshold=0.25,
            )
        )
    cross_fit = build_cross_fit(
        model_panel,
        freeze_panel,
        models,
        points,
        split_seeds,
        minimum_fold_overlap,
        ec_weight,
        piecewise_threshold,
        near_bi_gap=2.0,
        high_loss_threshold=0.25,
    )
    model_lists = {
        f"{candidate.casefold()}_models": sorted(model for model in models if family(model) == candidate)
        for candidate in ("GPT", "Claude", "Gemini", "Qwen", "DeepSeek", "Kimi")
    }
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-26",
        "scope": "non-imputed official_source_polymarket rows with a valid freeze-time probability",
        "baseline": {
            "id": "polymarket_freeze",
            "label": BASELINE_NAME,
            "probability_field": "market_prob",
            "upstream_field": "freeze_datetime_value",
            "timestamp_field": "freeze_datetime",
            "timing": "ForecastBench question-set freeze snapshot, normally 9-10 days before forecast due date",
            "outcome_blind": True,
        },
        "model_scope": {
            "definition": "eligible exact merged GPT, Claude, Gemini, Qwen, DeepSeek, and Kimi versions",
            **model_lists,
        },
        "pair_scope": {
            "eligible_pair_count": len(points),
            "near_bi_pair_count": sum(point["near_bi"] for point in points),
            "minimum_overlap": minimum_overlap,
            "minimum_fold_overlap": minimum_fold_overlap,
            "common_support": "Polymarket Freeze and each model use identical source=polymarket round-events",
            "excluded_models": exclusions,
            "model_common_support": overlaps,
        },
        "methods": {
            "ec_w0_56": {
                "label": "EC · w = 0.56",
                "formula": "sigmoid(0.56 * (logit(p_freeze) + logit(p_model)))",
                "outcome_blind": True,
            },
            "simple_mean": {
                "label": "Simple Mean",
                "formula": "(p_freeze + p_model) / 2",
                "outcome_blind": True,
            },
            "log_odds_mean": {
                "label": "Log-odds Mean",
                "formula": "sigmoid((logit(p_freeze) + logit(p_model)) / 2)",
                "outcome_blind": True,
            },
            "piecewise_odds": {
                "label": "Piecewise Odds",
                "formula": "threshold-5 piecewise transform of logit(p_freeze) + logit(p_model)",
                "threshold": piecewise_threshold,
                "outcome_blind": True,
            },
            "best_single": {
                "label": "Best Single",
                "formula": "lower adjusted Brier of Polymarket Freeze and model on identical support",
                "outcome_blind": False,
                "role": "hindsight benchmark; not deployable",
            },
            "past_only_best_single": {
                "label": "Past-only Best Single",
                "formula": "select the constituent with lower adjusted Brier on earlier common forecast dates",
                "outcome_blind": True,
                "role": "round-ordered diagnostic",
                "resolution_aware": False,
            },
        },
        "outcomes": {
            "primary": "absolute aggregation Brier Index; higher is better",
            "gain_vs_polymarket": "(polymarket_adjusted_brier - method_adjusted_brier) / polymarket_adjusted_brier",
            "gain_vs_model": "(model_adjusted_brier - method_adjusted_brier) / model_adjusted_brier",
            "gain_vs_best_single": "(best_single_adjusted_brier - method_adjusted_brier) / best_single_adjusted_brier",
            "score_weighting": "mean adjusted Brier on exact common Polymarket targets",
        },
        "brier_index": {
            "formula": "(1 - sqrt(adjusted_brier)) * 100",
            "higher_is_better": True,
            "cross_fit_aggregation": "test-support-weighted mean of fold-level BI across 10 random A/B repetitions and both directions",
        },
        "near_bi": {
            "threshold_bi_points": 2.0,
            "definition": "absolute train/common-support BI gap between Polymarket Freeze and model <= 2.0 points",
        },
        "provenance": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "taxonomy": str(taxonomy_path),
            "taxonomy_sha256": sha256_file(taxonomy_path),
            "freeze_field_mapping": "event_taxonomy.market_prob is the audited rename of question-set freeze_datetime_value",
            "join_key": "forecast_due_date + lowercase source=polymarket + event_id",
            "model_alias_audit": alias_audit,
            "imputation_audit": imputation_audit,
            "snapshot_audit": snapshot_audit,
            "match_audit": match_audit,
        },
        "summary": summarize_points(points, [point for point in points if point["near_bi"]]),
        "points": points,
        "cross_fit": cross_fit,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel_model_versions.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument("--processed-root", type=Path, required=True)
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument("--split-seed", type=int, default=20260825)
    parser.add_argument("--split-repetitions", type=int, default=10)
    parser.add_argument("--minimum-overlap", type=int, default=50)
    parser.add_argument("--minimum-fold-overlap", type=int, default=50)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("site/public/data/polymarket-aggregation/freeze-baseline.json"),
    )
    args = parser.parse_args()
    payload = build_payload(
        panel_path=args.panel,
        taxonomy_path=args.taxonomy,
        processed_root=args.processed_root,
        ec_weight=args.ec_weight,
        piecewise_threshold=args.piecewise_threshold,
        split_seed=args.split_seed,
        split_repetitions=args.split_repetitions,
        minimum_overlap=args.minimum_overlap,
        minimum_fold_overlap=args.minimum_fold_overlap,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "eligible_pairs": payload["pair_scope"]["eligible_pair_count"],
                "near_bi_pairs": payload["pair_scope"]["near_bi_pair_count"],
                "freeze_match": payload["provenance"]["match_audit"],
                "cross_fit": payload["cross_fit"]["audit"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
