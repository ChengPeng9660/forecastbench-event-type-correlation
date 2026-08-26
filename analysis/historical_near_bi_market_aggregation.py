"""Evaluate market aggregation after forward-time historical Near-BI selection.

For each forecast date and freeze-exposed model, the selection rule uses only
common model/Polymarket forecasts whose outcomes had resolved strictly before
that date.  A model-date is eligible when it has at least ``minimum_history``
such targets and its historical BI is within ``near_bi_gap`` points of the
market.  Fixed aggregation rules are then evaluated on the current date.

Original processed ForecastBench JSON is reopened both to remove imputed
forecasts and to recover resolution dates absent from the released scored CSV.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

from analysis.closed_form_aggregation import single_brier, write_csv
from analysis.freeze_exposed_market_aggregation import (
    exclude_imputed_polymarket_rows,
    read_freeze_exposed_panel,
    select_primary_configurations,
)
from analysis.metrics import brier_index
from analysis.pair_aggregation import adjusted_loss, official_mean, predictions, sha256_file
from analysis.polymarket_aggregation import BASELINE_NAME, build_freeze_panel, read_freeze_snapshots
from analysis.scoring import normalize_id


METHODS = (
    "anchor",
    "partner",
    "ec_w0_56",
    "simple_mean",
    "log_odds_mean",
    "piecewise_odds",
)
DEFAULT_THRESHOLDS = (0.5, 1.0, 2.0, 3.0, 5.0)


def attach_resolution_dates(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    processed_root: Path,
) -> tuple[dict[str, dict[tuple[str, ...], dict[str, str]]], dict[str, Any]]:
    """Attach strict date-only resolution metadata from non-imputed source rows."""

    requested: dict[tuple[str, str], set[tuple[str, ...]]] = defaultdict(set)
    for rows in panel.values():
        for key, row in rows.items():
            if key[1].casefold() != "polymarket":
                continue
            for source_file in row["source_file"].split(";"):
                if source_file:
                    requested[(key[0], source_file)].add(key)

    recovered: dict[tuple[str, ...], set[str]] = defaultdict(set)
    matched_raw_rows = 0
    for (date, source_file), target_keys in sorted(requested.items()):
        source_path = processed_root / date / source_file
        if not source_path.is_file():
            raise FileNotFoundError(f"processed ForecastBench source is missing: {source_path}")
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        for raw_row in payload.get("forecasts", []):
            if str(raw_row.get("source", "")).strip().casefold() != "polymarket":
                continue
            if bool(raw_row.get("imputed")):
                continue
            key = (date, "polymarket", normalize_id(raw_row.get("id")), "")
            if key not in target_keys:
                continue
            resolution = str(raw_row.get("resolution_date", ""))[:10]
            if len(resolution) != 10:
                raise ValueError(f"missing resolution date for {key} in {source_path}")
            recovered[key].add(resolution)
            matched_raw_rows += 1

    output: dict[str, dict[tuple[str, ...], dict[str, str]]] = {}
    target_rows = 0
    for name, rows in panel.items():
        resolved_rows: dict[tuple[str, ...], dict[str, str]] = {}
        for key, row in rows.items():
            copied = dict(row)
            if key[1].casefold() == "polymarket":
                dates = recovered.get(key, set())
                if len(dates) != 1:
                    raise ValueError(
                        f"resolution-date recovery for {key} returned {sorted(dates)!r}"
                    )
                copied["resolution_date"] = next(iter(dates))
                target_rows += 1
            resolved_rows[key] = copied
        output[name] = resolved_rows

    return output, {
        "processed_source_files_read": len(requested),
        "matched_raw_non_imputed_rows": matched_raw_rows,
        "scored_polymarket_rows_with_resolution_date": target_rows,
        "unique_round_event_resolution_dates": len(recovered),
        "resolution_rule": "history requires resolution_date < current forecast_due_date",
    }


def _score_support(
    market: Mapping[tuple[str, ...], Mapping[str, str]],
    model: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: Iterable[tuple[str, ...]],
    ec_weight: float,
    piecewise_threshold: float,
) -> dict[str, dict[str, float]]:
    losses: dict[str, list[tuple[str, float]]] = {method: [] for method in METHODS}
    ordered = list(keys)
    if not ordered:
        raise ValueError("cannot score empty current-date support")
    for key in ordered:
        market_row = market[key]
        model_row = model[key]
        p_market = float(market_row["prediction"])
        p_model = float(model_row["prediction"])
        origin = market_row["origin_type"]
        losses["anchor"].append((origin, adjusted_loss(market_row, p_market)))
        losses["partner"].append((origin, adjusted_loss(market_row, p_model)))
        for method, prediction in predictions(
            p_market,
            p_model,
            ec_weight,
            piecewise_threshold,
        ).items():
            losses[method].append((origin, adjusted_loss(market_row, prediction)))

    briers = {method: official_mean(values) for method, values in losses.items()}
    output: dict[str, dict[str, float]] = {}
    for method, loss in briers.items():
        index, reason = brier_index(loss)
        if index is None:
            raise ValueError(f"undefined current-date BI for {method}: {reason}")
        output[method] = {
            "adjusted_brier": loss,
            "brier_index": index,
            "gain_vs_market": (
                (briers["anchor"] - loss) / briers["anchor"]
                if briers["anchor"] > 0
                else float("nan")
            ),
            "gain_vs_model": (
                (briers["partner"] - loss) / briers["partner"]
                if briers["partner"] > 0
                else float("nan")
            ),
        }
    return output


def forward_time_records(
    names: Iterable[str],
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    market: Mapping[tuple[str, ...], Mapping[str, str]],
    canonical_by_name: Mapping[str, str],
    minimum_history: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> list[dict[str, Any]]:
    """Build outcome-safe model-date records before applying a BI threshold."""

    records: list[dict[str, Any]] = []
    for name in names:
        common = sorted(set(panel[name]) & set(market))
        for current_date in sorted({key[0] for key in common}):
            history = [
                key
                for key in common
                if key[0] < current_date
                and panel[name][key]["resolution_date"] < current_date
            ]
            if len(history) < minimum_history:
                continue
            current = [key for key in common if key[0] == current_date]
            market_history_loss = single_brier(market, history)
            model_history_loss = single_brier(panel[name], history)
            market_history_bi, market_reason = brier_index(market_history_loss)
            model_history_bi, model_reason = brier_index(model_history_loss)
            if market_history_bi is None or model_history_bi is None:
                raise ValueError(
                    "undefined historical BI for "
                    f"{name} on {current_date}: market={market_reason}, model={model_reason}"
                )
            scores = _score_support(
                market,
                panel[name],
                current,
                ec_weight,
                piecewise_threshold,
            )
            for method in METHODS:
                records.append(
                    {
                        "model_configuration": name,
                        "canonical_model_version": canonical_by_name[name],
                        "forecast_date": current_date,
                        "history_target_count": len(history),
                        "history_date_min": min(key[0] for key in history),
                        "history_date_max": max(key[0] for key in history),
                        "history_resolution_date_max": max(
                            panel[name][key]["resolution_date"] for key in history
                        ),
                        "history_market_adjusted_brier": market_history_loss,
                        "history_model_adjusted_brier": model_history_loss,
                        "history_market_bi": market_history_bi,
                        "history_model_bi": model_history_bi,
                        "history_bi_gap": abs(market_history_bi - model_history_bi),
                        "current_target_count": len(current),
                        "method": method,
                        "adjusted_brier": scores[method]["adjusted_brier"],
                        "brier_index": scores[method]["brier_index"],
                        "market_adjusted_brier": scores["anchor"]["adjusted_brier"],
                        "model_adjusted_brier": scores["partner"]["adjusted_brier"],
                        "gain_vs_market": scores[method]["gain_vs_market"],
                        "gain_vs_model": scores[method]["gain_vs_model"],
                    }
                )
    return records


def summarize_methods(
    records: list[dict[str, Any]],
    thresholds: Iterable[float],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for threshold in thresholds:
        for method in METHODS:
            selected = [
                row
                for row in records
                if row["method"] == method and row["history_bi_gap"] <= threshold
            ]
            if not selected:
                continue
            total = sum(row["current_target_count"] for row in selected)

            def weighted(field: str) -> float:
                return sum(
                    row[field] * row["current_target_count"] for row in selected
                ) / total

            method_loss = weighted("adjusted_brier")
            market_loss = weighted("market_adjusted_brier")
            model_loss = weighted("model_adjusted_brier")
            pooled_bi, reason = brier_index(method_loss)
            if pooled_bi is None:
                raise ValueError(f"undefined pooled BI for {method}: {reason}")
            output.append(
                {
                    "history_bi_gap_threshold": threshold,
                    "method": method,
                    "selected_model_dates": len(selected),
                    "selected_models": len(
                        {row["canonical_model_version"] for row in selected}
                    ),
                    "test_pair_event_cells": total,
                    "support_weighted_brier_index": weighted("brier_index"),
                    "support_weighted_gain_vs_market": weighted("gain_vs_market"),
                    "support_weighted_gain_vs_model": weighted("gain_vs_model"),
                    "pooled_adjusted_brier": method_loss,
                    "pooled_brier_index": pooled_bi,
                    "pooled_gain_vs_market": (
                        (market_loss - method_loss) / market_loss
                        if market_loss > 0
                        else None
                    ),
                    "pooled_gain_vs_model": (
                        (model_loss - method_loss) / model_loss
                        if model_loss > 0
                        else None
                    ),
                    "positive_model_date_share_vs_market": sum(
                        row["gain_vs_market"] > 0 for row in selected
                    )
                    / len(selected),
                    "positive_model_date_share_vs_model": sum(
                        row["gain_vs_model"] > 0 for row in selected
                    )
                    / len(selected),
                }
            )
    return output


def summarize_models(
    records: list[dict[str, Any]],
    threshold: float,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    models = sorted(
        {
            row["canonical_model_version"]
            for row in records
            if row["history_bi_gap"] <= threshold
        }
    )
    for model in models:
        for method in METHODS:
            selected = [
                row
                for row in records
                if row["canonical_model_version"] == model
                and row["method"] == method
                and row["history_bi_gap"] <= threshold
            ]
            if not selected:
                continue
            total = sum(row["current_target_count"] for row in selected)

            def weighted(field: str) -> float:
                return sum(
                    row[field] * row["current_target_count"] for row in selected
                ) / total

            output.append(
                {
                    "history_bi_gap_threshold": threshold,
                    "canonical_model_version": model,
                    "method": method,
                    "selected_dates": len(selected),
                    "test_pair_event_cells": total,
                    "support_weighted_brier_index": weighted("brier_index"),
                    "support_weighted_gain_vs_market": weighted("gain_vs_market"),
                    "support_weighted_gain_vs_model": weighted("gain_vs_model"),
                    "positive_date_share_vs_market": sum(
                        row["gain_vs_market"] > 0 for row in selected
                    )
                    / len(selected),
                }
            )
    return output


def summarize_dates(
    records: list[dict[str, Any]],
    threshold: float,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    dates = sorted(
        {
            row["forecast_date"]
            for row in records
            if row["history_bi_gap"] <= threshold
        }
    )
    for date in dates:
        for method in METHODS:
            selected = [
                row
                for row in records
                if row["forecast_date"] == date
                and row["method"] == method
                and row["history_bi_gap"] <= threshold
            ]
            total = sum(row["current_target_count"] for row in selected)

            def weighted(field: str) -> float:
                return sum(
                    row[field] * row["current_target_count"] for row in selected
                ) / total

            method_loss = weighted("adjusted_brier")
            market_loss = weighted("market_adjusted_brier")
            output.append(
                {
                    "history_bi_gap_threshold": threshold,
                    "forecast_date": date,
                    "method": method,
                    "selected_models": len(selected),
                    "test_pair_event_cells": total,
                    "support_weighted_gain_vs_market": weighted("gain_vs_market"),
                    "pooled_gain_vs_market": (
                        (market_loss - method_loss) / market_loss
                        if market_loss > 0
                        else None
                    ),
                }
            )
    return output


def run_experiment(
    raw_panel_path: Path,
    taxonomy_path: Path,
    processed_root: Path,
    minimum_history: int = 50,
    near_bi_gap: float = 2.0,
    thresholds: tuple[float, ...] = DEFAULT_THRESHOLDS,
    minimum_total_overlap: int = 50,
    ec_weight: float = 0.56,
    piecewise_threshold: float = 5.0,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    raw_panel, configurations, raw_audit = read_freeze_exposed_panel(raw_panel_path)
    primary_by_canonical, selection_audit = select_primary_configurations(configurations)
    primary_panel = {
        name: raw_panel[name] for name in primary_by_canonical.values()
    }
    primary_panel, imputation_audit = exclude_imputed_polymarket_rows(
        primary_panel,
        processed_root,
    )
    primary_panel, resolution_audit = attach_resolution_dates(
        primary_panel,
        processed_root,
    )
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    market, match_audit = build_freeze_panel(primary_panel, snapshots)

    overlaps = {
        name: len(set(rows) & set(market)) for name, rows in primary_panel.items()
    }
    names = sorted(
        [name for name, overlap in overlaps.items() if overlap >= minimum_total_overlap],
        key=lambda name: (
            configurations[name].canonical_version.casefold(),
            configurations[name].canonical_version,
        ),
    )
    canonical_by_name = {
        name: configurations[name].canonical_version for name in names
    }
    records = forward_time_records(
        names,
        primary_panel,
        market,
        canonical_by_name,
        minimum_history,
        ec_weight,
        piecewise_threshold,
    )
    method_summary = summarize_methods(records, thresholds)
    model_summary = summarize_models(records, near_bi_gap)
    date_summary = summarize_dates(records, near_bi_gap)
    selected_near_bi = [
        row
        for row in records
        if row["method"] == "anchor" and row["history_bi_gap"] <= near_bi_gap
    ]

    report = {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-26",
        "research_question": (
            "Does aggregating Polymarket with freeze-exposed models improve future "
            "forecasts when model eligibility is based only on historically resolved "
            "Near-BI performance?"
        ),
        "design": {
            "selection": (
                "at each forecast date, retain a model only if its historical BI gap "
                f"versus Polymarket is <= {near_bi_gap} on at least {minimum_history} "
                "common targets resolved strictly before that date"
            ),
            "history_resolution_boundary": (
                "resolution_date < current forecast_due_date; same-day resolutions excluded"
            ),
            "primary_near_bi_gap": near_bi_gap,
            "minimum_history": minimum_history,
            "threshold_sensitivity": list(thresholds),
            "minimum_total_overlap": minimum_total_overlap,
            "aggregation_methods": list(METHODS),
            "ec_weight": ec_weight,
            "piecewise_threshold": piecewise_threshold,
            "imputation_policy": imputation_audit["policy"],
            "leakage_control": (
                "current-date outcomes are never used for model selection or prediction; "
                "they are used only for current-date scoring"
            ),
        },
        "audit": {
            **raw_audit,
            "primary_configurations_before_overlap": len(primary_panel),
            "primary_configurations_total_overlap_eligible": len(names),
            "model_date_records_with_minimum_history": len(records) // len(METHODS),
            "models_with_minimum_history": len(
                {row["canonical_model_version"] for row in records}
            ),
            "selected_near_bi_model_dates": len(selected_near_bi),
            "selected_near_bi_models": len(
                {row["canonical_model_version"] for row in selected_near_bi}
            ),
            "selected_near_bi_forecast_dates": len(
                {row["forecast_date"] for row in selected_near_bi}
            ),
            "selected_near_bi_test_pair_event_cells": sum(
                row["current_target_count"] for row in selected_near_bi
            ),
        },
        "provenance": {
            "raw_panel": str(raw_panel_path),
            "raw_panel_sha256": sha256_file(raw_panel_path),
            "taxonomy": str(taxonomy_path),
            "taxonomy_sha256": sha256_file(taxonomy_path),
            "processed_root": str(processed_root),
            "market_anchor": BASELINE_NAME,
            "market_probability": "ForecastBench freeze_datetime_value",
            "join_key": "forecast_due_date + lowercase source=polymarket + event_id",
            "imputation_audit": imputation_audit,
            "resolution_audit": resolution_audit,
            "snapshot_audit": snapshot_audit,
            "match_audit": match_audit,
        },
        "eligibility": {
            "eligible_primary_configurations": names,
            "common_support": overlaps,
            "selection_audit": selection_audit,
        },
        "method_summary": method_summary,
        "primary_model_summary": model_summary,
        "primary_date_summary": date_summary,
    }
    return report, records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-panel", type=Path, default=Path("data/build/scored_panel.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument("--processed-root", required=True, type=Path)
    parser.add_argument("--minimum-history", type=int, default=50)
    parser.add_argument("--near-bi-gap", type=float, default=2.0)
    parser.add_argument("--minimum-total-overlap", type=int, default=50)
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/derived/historical_near_bi_market_aggregation"),
    )
    args = parser.parse_args()
    report, records = run_experiment(
        raw_panel_path=args.raw_panel,
        taxonomy_path=args.taxonomy,
        processed_root=args.processed_root,
        minimum_history=args.minimum_history,
        near_bi_gap=args.near_bi_gap,
        minimum_total_overlap=args.minimum_total_overlap,
        ec_weight=args.ec_weight,
        piecewise_threshold=args.piecewise_threshold,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = args.output_dir / "summary.json"
    detail_path = args.output_dir / "model_date_method_results.csv"
    summary_path.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(detail_path, records)
    print(
        json.dumps(
            {
                "summary": str(summary_path),
                "detail": str(detail_path),
                **report["audit"],
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
