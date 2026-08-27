"""Evaluate market aggregation for LLM configurations that saw freeze values.

The primary analysis selects one explicitly freeze-exposed ForecastBench
configuration per canonical model version using an outcome-blind preference
for zero-shot configurations.  A robustness analysis retains every eligible
freeze-exposed configuration.  A matched analysis compares the selected
freeze-exposed configuration with the released no-freeze canonical panel on
the exact same Polymarket events.

All fitted dependence-aware weights use the training fold only.  Evaluation
uses ten repeated, event-disjoint A/B splits in both directions.  The market
anchor is ForecastBench's question-set ``freeze_datetime_value``.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

from analysis.closed_form_aggregation import (
    ALL_METHODS,
    aggregate_pairs,
    evaluate_pair,
    forecast_diagnostics,
    method_summary,
    write_csv,
)
from analysis.model_versions import configuration_preference, split_model_version
from analysis.pair_aggregation import KEY, MODEL_ALIASES, event_fold, family, read_panel, sha256_file
from analysis.polymarket_cleaning import exclude_imputed_polymarket_rows
from analysis.polymarket_aggregation import BASELINE_NAME, build_freeze_panel, read_freeze_snapshots


FREEZE_TOKEN = "with freeze values"
EXPERIMENT = "polymarket_model"
EXPOSURE_EXPERIMENT = "same_version_freeze_exposure"


@dataclass
class ExactConfiguration:
    exact_name: str
    canonical_version: str
    organization: str
    configuration: str
    rows: dict[tuple[str, ...], dict[str, str]] = field(default_factory=dict)
    dates: set[str] = field(default_factory=set)


def is_freeze_exposed_configuration(configuration: str) -> bool:
    """Return true only for explicit ForecastBench freeze-value prompts."""

    return FREEZE_TOKEN in " ".join(configuration.casefold().split())


def _canonical_alias(version: str) -> str:
    return MODEL_ALIASES.get(version, version)


def _exact_label(canonical: str, configuration: str) -> str:
    return f"{canonical} ({configuration})" if configuration else canonical


def read_freeze_exposed_panel(
    path: Path,
) -> tuple[
    dict[str, dict[tuple[str, ...], dict[str, str]]],
    dict[str, ExactConfiguration],
    dict[str, Any],
]:
    """Read all exact six-family configurations that explicitly saw freeze values."""

    configurations: dict[str, ExactConfiguration] = {}
    input_rows = 0
    selected_rows = 0
    alias_rows: Counter[str] = Counter()
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            *KEY,
            "model_name",
            "model_organization",
            "prediction",
            "outcome",
            "origin_type",
            "question_fixed_effect",
            "normalization_term",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"raw scored panel missing fields: {sorted(missing)}")
        for row in reader:
            input_rows += 1
            source_name = row["model_name"].strip()
            version, configuration = split_model_version(source_name)
            if family(version) is None or not is_freeze_exposed_configuration(configuration):
                continue
            canonical = _canonical_alias(version)
            exact_name = _exact_label(canonical, configuration)
            if canonical != version:
                alias_rows[version] += 1
            state = configurations.get(exact_name)
            if state is None:
                state = ExactConfiguration(
                    exact_name=exact_name,
                    canonical_version=canonical,
                    organization=row["model_organization"].strip(),
                    configuration=configuration,
                )
                configurations[exact_name] = state
            elif state.canonical_version != canonical or state.configuration != configuration:
                raise ValueError(f"unstable exact configuration parsing for {source_name!r}")
            key = tuple(row[field] for field in KEY)
            if key in state.rows:
                raise ValueError(f"alias merge creates duplicate target for {exact_name}: {key}")
            resolved = dict(row)
            resolved["model_name"] = exact_name
            resolved["canonical_model_version"] = canonical
            resolved["model_configuration"] = configuration
            state.rows[key] = resolved
            state.dates.add(row["date"][:10])
            selected_rows += 1

    if not configurations:
        raise ValueError("no explicit with-freeze configurations found")
    panel = {name: state.rows for name, state in configurations.items()}
    return panel, configurations, {
        "input_rows": input_rows,
        "freeze_exposed_rows": selected_rows,
        "freeze_exposed_exact_configurations": len(configurations),
        "canonical_model_versions": len({state.canonical_version for state in configurations.values()}),
        "alias_rows": dict(sorted(alias_rows.items())),
        "configuration_counts": dict(
            sorted(Counter(state.configuration for state in configurations.values()).items())
        ),
    }


def select_primary_configurations(
    configurations: Mapping[str, ExactConfiguration],
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Select one outcome-blind freeze-exposed configuration per model version."""

    groups: dict[str, list[ExactConfiguration]] = defaultdict(list)
    for state in configurations.values():
        groups[state.canonical_version].append(state)
    selected: dict[str, str] = {}
    audit_rows: list[dict[str, Any]] = []
    for canonical, candidates in sorted(groups.items()):
        ordered = sorted(
            candidates,
            key=lambda state: (
                configuration_preference(state.configuration),
                -len(state.rows),
                state.exact_name.casefold(),
                state.exact_name,
            ),
        )
        selected[canonical] = ordered[0].exact_name
        for rank, state in enumerate(ordered, start=1):
            audit_rows.append(
                {
                    "canonical_model_version": canonical,
                    "exact_model_name": state.exact_name,
                    "model_organization": state.organization,
                    "model_configuration": state.configuration,
                    "selected": int(rank == 1),
                    "selection_rank": rank,
                    "selection_reason": (
                        "preferred_outcome_blind_freeze_configuration"
                        if rank == 1
                        else "same_model_version_nonrepresentative_freeze_configuration"
                    ),
                    "n_scored_rows": len(state.rows),
                    "n_dates": len(state.dates),
                    "date_min": min(state.dates),
                    "date_max": max(state.dates),
                }
            )
    return selected, audit_rows


def eligible_configurations(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    split_seeds: list[int],
    minimum_overlap: int,
    minimum_fold_overlap: int,
) -> tuple[list[str], dict[str, str], dict[str, int]]:
    eligible: list[str] = []
    exclusions: dict[str, str] = {}
    overlaps: dict[str, int] = {}
    for name in sorted(panel, key=lambda value: (family(value) or "", value.casefold(), value)):
        common = set(panel[name]) & set(freeze_panel)
        overlaps[name] = len(common)
        if len(common) < minimum_overlap:
            exclusions[name] = f"common Polymarket support {len(common)} < {minimum_overlap}"
            continue
        smallest = min(
            min(
                sum(event_fold(key[1], key[2], seed) == fold for key in common)
                for fold in ("A", "B")
            )
            for seed in split_seeds
        )
        if smallest < minimum_fold_overlap:
            exclusions[name] = (
                f"minimum repeated fold support {smallest} < {minimum_fold_overlap}"
            )
            continue
        eligible.append(name)
    return eligible, exclusions, overlaps


def similarity_diagnostics(
    market: Mapping[tuple[str, ...], Mapping[str, str]],
    model: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: Iterable[tuple[str, ...]],
) -> dict[str, float | int | None]:
    ordered = list(keys)
    if not ordered:
        raise ValueError("similarity diagnostics require nonempty support")
    market_values = [float(market[key]["prediction"]) for key in ordered]
    model_values = [float(model[key]["prediction"]) for key in ordered]
    market_mean = sum(market_values) / len(market_values)
    model_mean = sum(model_values) / len(model_values)
    numerator = sum(
        (first - market_mean) * (second - model_mean)
        for first, second in zip(market_values, model_values)
    )
    first_scale = math.sqrt(sum((value - market_mean) ** 2 for value in market_values))
    second_scale = math.sqrt(sum((value - model_mean) ** 2 for value in model_values))
    differences = [second - first for first, second in zip(market_values, model_values)]
    return {
        "n": len(ordered),
        "prediction_pearson": numerator / (first_scale * second_scale)
        if first_scale and second_scale
        else None,
        "mean_absolute_difference": sum(abs(value) for value in differences) / len(differences),
        "root_mean_squared_difference": math.sqrt(
            sum(value * value for value in differences) / len(differences)
        ),
        "exact_copy_share": sum(abs(value) <= 1e-12 for value in differences) / len(differences),
        "market_mean_probability": market_mean,
        "model_mean_probability": model_mean,
    }


def add_model_reference_fields(pair_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    partner_brier = {
        row["pair_id"]: row["adjusted_brier"]
        for row in pair_rows
        if row["method"] == "partner"
    }
    for row in pair_rows:
        model_brier = partner_brier[row["pair_id"]]
        row["model_adjusted_brier"] = model_brier
        row["gain_vs_model"] = (
            (model_brier - row["adjusted_brier"]) / model_brier if model_brier > 0 else None
        )
    return pair_rows


def summarize_sample(
    rows: list[dict[str, Any]],
    sample: str,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for method in ALL_METHODS:
        selected = [row for row in rows if row["method"] == method]
        if not selected:
            continue
        weights = [row["test_target_cells"] for row in selected]
        total = sum(weights)

        def weighted(field: str) -> float:
            return sum(row[field] * weight for row, weight in zip(selected, weights)) / total

        pooled_method_brier = weighted("adjusted_brier")
        pooled_market_brier = weighted("anchor_adjusted_brier")
        pooled_best_brier = weighted("best_single_adjusted_brier")

        output.append(
            {
                "sample": sample,
                "method": method,
                "pair_count": len(selected),
                "pair_event_cells": total,
                "support_weighted_brier_index": weighted("brier_index"),
                "support_weighted_gain_vs_market": weighted("gain_vs_anchor"),
                "support_weighted_gain_vs_model": weighted("gain_vs_model"),
                "support_weighted_gain_vs_best_single": weighted("gain_vs_best_single"),
                "pooled_gain_vs_market": (
                    (pooled_market_brier - pooled_method_brier) / pooled_market_brier
                    if pooled_market_brier > 0
                    else None
                ),
                "pooled_gain_vs_best_single": (
                    (pooled_best_brier - pooled_method_brier) / pooled_best_brier
                    if pooled_best_brier > 0
                    else None
                ),
                "macro_gain_vs_market": sum(row["gain_vs_anchor"] for row in selected)
                / len(selected),
                "positive_vs_market_share": sum(row["gain_vs_anchor"] > 0 for row in selected)
                / len(selected),
                "positive_vs_best_single_share": sum(
                    row["gain_vs_best_single"] > 0 for row in selected
                )
                / len(selected),
            }
        )
    return output


def summarize_repetitions(
    fold_rows: list[dict[str, Any]],
    sample: str,
    primary_only: bool,
) -> list[dict[str, Any]]:
    """Pool both directions within each repetition without reusing test outcomes."""

    output: list[dict[str, Any]] = []
    for repetition in sorted({int(row["repetition"]) for row in fold_rows}):
        for method in ALL_METHODS:
            selected = [
                row
                for row in fold_rows
                if int(row["repetition"]) == repetition
                and row["method"] == method
                and (not primary_only or bool(row["primary_configuration"]))
            ]
            if not selected:
                continue
            total = sum(row["n_test"] for row in selected)

            def weighted(field: str) -> float:
                return sum(row[field] * row["n_test"] for row in selected) / total

            method_brier = weighted("adjusted_brier")
            market_brier = weighted("anchor_adjusted_brier")
            output.append(
                {
                    "sample": sample,
                    "repetition": repetition,
                    "method": method,
                    "pair_count": len({row["pair_id"] for row in selected}),
                    "test_target_cells": total,
                    "brier_index": weighted("brier_index"),
                    "pooled_gain_vs_market": (
                        (market_brier - method_brier) / market_brier
                        if market_brier > 0
                        else None
                    ),
                }
            )
    return output


def summarize_similarity_rows(
    rows: list[dict[str, Any]],
    sample: str,
) -> dict[str, Any]:
    """Return macro and support-weighted forecast/market similarity diagnostics."""

    if not rows:
        raise ValueError("similarity summary requires nonempty rows")
    fields = (
        "prediction_pearson",
        "mean_absolute_difference",
        "root_mean_squared_difference",
        "exact_copy_share",
    )
    total = sum(row["n"] for row in rows)
    output: dict[str, Any] = {
        "sample": sample,
        "model_count": len(rows),
        "model_event_cells": total,
    }
    for field in fields:
        defined = [row for row in rows if row[field] is not None]
        output[f"macro_{field}"] = sum(row[field] for row in defined) / len(defined)
        defined_total = sum(row["n"] for row in defined)
        output[f"support_weighted_{field}"] = (
            sum(row[field] * row["n"] for row in defined) / defined_total
        )
    return output


def summarize_train_near_bi_folds(
    fold_rows: list[dict[str, Any]],
    sample: str,
) -> list[dict[str, Any]]:
    """Summarize only folds selected as Near-BI using their training half."""

    output: list[dict[str, Any]] = []
    for method in ALL_METHODS:
        selected = [
            row
            for row in fold_rows
            if row["primary_configuration"]
            and row["train_near_bi"]
            and row["method"] == method
        ]
        if not selected:
            continue
        weights = [row["n_test"] for row in selected]
        total = sum(weights)

        def weighted(field: str) -> float:
            return sum(row[field] * weight for row, weight in zip(selected, weights)) / total

        method_brier = weighted("adjusted_brier")
        market_brier = weighted("anchor_adjusted_brier")
        best_brier = weighted("best_single_adjusted_brier")
        output.append(
            {
                "sample": sample,
                "method": method,
                "pair_count": len({row["pair_id"] for row in selected}),
                "selected_fold_records": len(selected),
                "pair_event_cells": total,
                "support_weighted_brier_index": weighted("brier_index"),
                "support_weighted_gain_vs_market": weighted("gain_vs_anchor"),
                "support_weighted_gain_vs_best_single": weighted("gain_vs_best_single"),
                "pooled_gain_vs_market": (
                    (market_brier - method_brier) / market_brier if market_brier > 0 else None
                ),
                "pooled_gain_vs_best_single": (
                    (best_brier - method_brier) / best_brier if best_brier > 0 else None
                ),
                "positive_vs_market_share": sum(row["gain_vs_anchor"] > 0 for row in selected)
                / len(selected),
                "positive_vs_best_single_share": sum(
                    row["gain_vs_best_single"] > 0 for row in selected
                )
                / len(selected),
            }
        )
    return output


def _evaluate_names(
    names: Iterable[str],
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    split_seeds: list[int],
    minimum_fold_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    fold_rows: list[dict[str, Any]] = []
    similarities: list[dict[str, Any]] = []
    for name in names:
        common = sorted(set(panel[name]) & set(freeze_panel))
        fold_rows.extend(
            evaluate_pair(
                EXPERIMENT,
                BASELINE_NAME,
                name,
                freeze_panel,
                panel[name],
                split_seeds,
                minimum_fold_overlap,
                ec_weight,
                piecewise_threshold,
            )
        )
        similarities.append(
            {
                "model_configuration": name,
                "canonical_model_version": split_model_version(name)[0],
                **similarity_diagnostics(freeze_panel, panel[name], common),
            }
        )
    return fold_rows, similarities


def matched_comparison(
    primary_by_canonical: Mapping[str, str],
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    freeze_config_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    nofreeze_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    split_seeds: list[int],
    minimum_overlap: int,
    minimum_fold_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, str]]:
    fold_rows: list[dict[str, Any]] = []
    similarity_rows: list[dict[str, Any]] = []
    exclusions: dict[str, str] = {}
    for canonical, freeze_name in sorted(primary_by_canonical.items()):
        if canonical not in nofreeze_panel:
            exclusions[canonical] = "no matching no-freeze canonical model"
            continue
        triple = sorted(
            set(freeze_panel) & set(freeze_config_panel[freeze_name]) & set(nofreeze_panel[canonical])
        )
        if len(triple) < minimum_overlap:
            exclusions[canonical] = f"matched triple support {len(triple)} < {minimum_overlap}"
            continue
        smallest = min(
            min(
                sum(event_fold(key[1], key[2], seed) == fold for key in triple)
                for fold in ("A", "B")
            )
            for seed in split_seeds
        )
        if smallest < minimum_fold_overlap:
            exclusions[canonical] = (
                f"minimum repeated matched fold support {smallest} < {minimum_fold_overlap}"
            )
            continue
        market_slice = {key: freeze_panel[key] for key in triple}
        freeze_slice = {key: freeze_config_panel[freeze_name][key] for key in triple}
        nofreeze_slice = {key: nofreeze_panel[canonical][key] for key in triple}
        for exposure, label, model_slice in (
            ("no_freeze", f"{canonical} [no freeze]", nofreeze_slice),
            ("with_freeze", f"{canonical} [with freeze]", freeze_slice),
        ):
            rows = evaluate_pair(
                EXPERIMENT,
                BASELINE_NAME,
                label,
                market_slice,
                model_slice,
                split_seeds,
                minimum_fold_overlap,
                ec_weight,
                piecewise_threshold,
            )
            for row in rows:
                row["canonical_model_version"] = canonical
                row["freeze_exposure"] = exposure
                row["source_model_configuration"] = freeze_name if exposure == "with_freeze" else canonical
            fold_rows.extend(rows)
            similarity_rows.append(
                {
                    "canonical_model_version": canonical,
                    "freeze_exposure": exposure,
                    "source_model_configuration": freeze_name if exposure == "with_freeze" else canonical,
                    **similarity_diagnostics(market_slice, model_slice, triple),
                }
            )

    pairs = add_model_reference_fields(aggregate_pairs(fold_rows))
    metadata = {
        row["pair_id"]: (
            row["canonical_model_version"],
            row["freeze_exposure"],
            row["source_model_configuration"],
        )
        for row in fold_rows
    }
    for row in pairs:
        canonical, exposure, source = metadata[row["pair_id"]]
        row["canonical_model_version"] = canonical
        row["freeze_exposure"] = exposure
        row["source_model_configuration"] = source
    return pairs, similarity_rows, exclusions


def same_version_freeze_exposure_comparison(
    eligible_names: Iterable[str],
    configurations: Mapping[str, ExactConfiguration],
    freeze_panel: Mapping[tuple[str, ...], Mapping[str, str]],
    freeze_config_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    nofreeze_panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    split_seeds: list[int],
    minimum_overlap: int,
    minimum_fold_overlap: int,
    ec_weight: float,
    piecewise_threshold: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, str]]:
    """Evaluate with-freeze partners against fixed same-version no-freeze bases."""

    fold_rows: list[dict[str, Any]] = []
    exclusions: dict[str, str] = {}
    for freeze_name in sorted(eligible_names):
        canonical = configurations[freeze_name].canonical_version
        if canonical not in nofreeze_panel:
            exclusions[freeze_name] = "no matching no-freeze canonical model"
            continue
        common = sorted(
            set(freeze_panel)
            & set(freeze_config_panel[freeze_name])
            & set(nofreeze_panel[canonical])
        )
        if len(common) < minimum_overlap:
            exclusions[freeze_name] = f"same-version support {len(common)} < {minimum_overlap}"
            continue
        smallest = min(
            min(
                sum(event_fold(key[1], key[2], seed) == fold for key in common)
                for fold in ("A", "B")
            )
            for seed in split_seeds
        )
        if smallest < minimum_fold_overlap:
            exclusions[freeze_name] = (
                f"minimum repeated same-version fold support {smallest} < "
                f"{minimum_fold_overlap}"
            )
            continue
        base_name = f"{canonical} (without freeze values)"
        base_slice = {key: nofreeze_panel[canonical][key] for key in common}
        partner_slice = {key: freeze_config_panel[freeze_name][key] for key in common}
        rows = evaluate_pair(
            EXPOSURE_EXPERIMENT,
            base_name,
            freeze_name,
            base_slice,
            partner_slice,
            split_seeds,
            minimum_fold_overlap,
            ec_weight,
            piecewise_threshold,
        )
        for row in rows:
            row["canonical_model_version"] = canonical
            row["base_model_configuration"] = canonical
            row["partner_model_configuration"] = configurations[freeze_name].configuration
        fold_rows.extend(rows)

    pair_rows = add_model_reference_fields(aggregate_pairs(fold_rows))
    metadata = {
        row["pair_id"]: (
            row["canonical_model_version"],
            row["base_model_configuration"],
            row["partner_model_configuration"],
        )
        for row in fold_rows
    }
    for row in pair_rows:
        canonical, base_configuration, partner_configuration = metadata[row["pair_id"]]
        row["canonical_model_version"] = canonical
        row["base_model_configuration"] = base_configuration
        row["partner_model_configuration"] = partner_configuration
    return fold_rows, pair_rows, exclusions


def matched_method_differences(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed = {
        (row["canonical_model_version"], row["freeze_exposure"], row["method"]): row
        for row in rows
    }
    output: list[dict[str, Any]] = []
    canonicals = sorted({row["canonical_model_version"] for row in rows})
    for canonical in canonicals:
        for method in ALL_METHODS:
            nofreeze = indexed[(canonical, "no_freeze", method)]
            freeze = indexed[(canonical, "with_freeze", method)]
            output.append(
                {
                    "canonical_model_version": canonical,
                    "method": method,
                    "test_target_cells_each": freeze["test_target_cells"],
                    "no_freeze_gain_vs_market": nofreeze["gain_vs_anchor"],
                    "with_freeze_gain_vs_market": freeze["gain_vs_anchor"],
                    "freeze_minus_no_freeze_gain_vs_market": (
                        freeze["gain_vs_anchor"] - nofreeze["gain_vs_anchor"]
                    ),
                    "no_freeze_gain_vs_best_single": nofreeze["gain_vs_best_single"],
                    "with_freeze_gain_vs_best_single": freeze["gain_vs_best_single"],
                    "freeze_minus_no_freeze_gain_vs_best_single": (
                        freeze["gain_vs_best_single"] - nofreeze["gain_vs_best_single"]
                    ),
                    "no_freeze_brier_index": nofreeze["brier_index"],
                    "with_freeze_brier_index": freeze["brier_index"],
                }
            )
    return output


def run_experiment(
    raw_panel_path: Path,
    canonical_panel_path: Path,
    taxonomy_path: Path,
    processed_root: Path,
    split_seed: int = 20260825,
    split_repetitions: int = 10,
    minimum_overlap: int = 50,
    minimum_fold_overlap: int = 50,
    ec_weight: float = 0.56,
    piecewise_threshold: float = 5.0,
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    split_seeds = [split_seed + offset for offset in range(split_repetitions)]
    raw_panel, configurations, raw_audit = read_freeze_exposed_panel(raw_panel_path)
    primary_by_canonical, selection_audit = select_primary_configurations(configurations)
    nofreeze_panel, nofreeze_alias_audit = read_panel(canonical_panel_path)
    raw_panel, freeze_imputation_audit = exclude_imputed_polymarket_rows(
        raw_panel, processed_root
    )
    nofreeze_panel, nofreeze_imputation_audit = exclude_imputed_polymarket_rows(
        nofreeze_panel, processed_root
    )
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    freeze_panel, match_audit = build_freeze_panel(raw_panel, snapshots)
    eligible, exclusions, overlaps = eligible_configurations(
        raw_panel,
        freeze_panel,
        split_seeds,
        minimum_overlap,
        minimum_fold_overlap,
    )
    primary_names = [
        name for canonical, name in sorted(primary_by_canonical.items()) if name in eligible
    ]

    fold_rows, similarity_rows = _evaluate_names(
        eligible,
        raw_panel,
        freeze_panel,
        split_seeds,
        minimum_fold_overlap,
        ec_weight,
        piecewise_threshold,
    )
    pair_rows = add_model_reference_fields(aggregate_pairs(fold_rows))
    primary_set = set(primary_names)
    for row in pair_rows:
        row["canonical_model_version"] = configurations[row["model_b"]].canonical_version
        row["model_configuration"] = configurations[row["model_b"]].configuration
        row["primary_configuration"] = int(row["model_b"] in primary_set)
    for row in fold_rows:
        row["canonical_model_version"] = configurations[row["model_b"]].canonical_version
        row["model_configuration"] = configurations[row["model_b"]].configuration
        row["primary_configuration"] = int(row["model_b"] in primary_set)

    primary_rows = [row for row in pair_rows if row["primary_configuration"]]
    summaries = [
        *summarize_sample(primary_rows, "canonical_primary"),
        *summarize_sample(pair_rows, "all_configurations"),
        *summarize_train_near_bi_folds(
            fold_rows,
            "canonical_primary_train_near_bi_folds",
        ),
    ]

    matched_rows, matched_similarity, matched_exclusions = matched_comparison(
        {canonical: name for canonical, name in primary_by_canonical.items() if name in primary_set},
        freeze_panel,
        raw_panel,
        nofreeze_panel,
        split_seeds,
        minimum_overlap,
        minimum_fold_overlap,
        ec_weight,
        piecewise_threshold,
    )
    matched_differences = matched_method_differences(matched_rows)
    matched_summary: list[dict[str, Any]] = []
    for exposure in ("no_freeze", "with_freeze"):
        matched_summary.extend(
            summarize_sample(
                [row for row in matched_rows if row["freeze_exposure"] == exposure],
                f"matched_{exposure}",
            )
        )

    exposure_fold_rows, exposure_pair_rows, exposure_exclusions = (
        same_version_freeze_exposure_comparison(
            eligible,
            configurations,
            freeze_panel,
            raw_panel,
            nofreeze_panel,
            split_seeds,
            minimum_overlap,
            minimum_fold_overlap,
            ec_weight,
            piecewise_threshold,
        )
    )
    exposure_summary = summarize_sample(
        exposure_pair_rows,
        "same_version_no_freeze_base",
    )

    similarity_by_name = {row["model_configuration"]: row for row in similarity_rows}
    report = {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-26",
        "research_question": (
            "Do LLM configurations explicitly shown ForecastBench freeze values add "
            "out-of-sample information when aggregated again with the same frozen market probability?"
        ),
        "design": {
            "evaluation": "ten-repeat two-fold event-disjoint cross-fit in both directions",
            "split_seeds": split_seeds,
            "market_anchor": BASELINE_NAME,
            "market_probability": "ForecastBench question-set freeze_datetime_value",
            "primary_selection": (
                "one explicit with-freeze configuration per canonical model version; "
                "prefer zero shot, then least-augmented zero shot, then scratchpad"
            ),
            "robustness": "all eligible exact with-freeze configurations",
            "matched_comparison": (
                "selected with-freeze and released no-freeze canonical forecasts evaluated on "
                "identical market/model/model triple support"
            ),
            "same_version_no_freeze_base": (
                "each eligible exact with-freeze configuration is paired with its canonical "
                "without-freeze forecast as a fixed base on identical audited Polymarket support"
            ),
            "leakage_control": (
                "all fitted weights and dependence diagnostics use train events only; "
                "opposite-fold outcomes are used only for scoring"
            ),
            "imputation_policy": (
                "exclude Polymarket rows backed only by original ForecastBench "
                "forecasts marked imputed=true"
            ),
        },
        "audit": {
            **raw_audit,
            "eligible_exact_configurations": len(eligible),
            "primary_eligible_model_versions": len(primary_names),
            "matched_model_versions": len({row["canonical_model_version"] for row in matched_rows}),
            "fold_records_per_pair_method": 2 * split_repetitions,
            "fold_method_rows": len(fold_rows),
            "pair_method_rows": len(pair_rows),
            "primary_pair_method_rows": len(primary_rows),
            "matched_pair_method_rows": len(matched_rows),
            "same_version_no_freeze_base_configurations": len(
                {row["model_b"] for row in exposure_fold_rows}
            ),
            "same_version_no_freeze_base_model_versions": len(
                {row["canonical_model_version"] for row in exposure_fold_rows}
            ),
            "same_version_no_freeze_base_fold_method_rows": len(exposure_fold_rows),
            "same_version_no_freeze_base_pair_method_rows": len(exposure_pair_rows),
            "primary_train_near_bi_pair_fold_records": sum(
                row["primary_configuration"]
                and row["train_near_bi"]
                and row["method"] == "anchor"
                for row in fold_rows
            ),
            "primary_pairs_ever_train_near_bi": len(
                {
                    row["pair_id"]
                    for row in fold_rows
                    if row["primary_configuration"] and row["train_near_bi"]
                }
            ),
            "all_selected_configs_explicitly_with_freeze": all(
                is_freeze_exposed_configuration(configurations[name].configuration)
                for name in primary_names
            ),
        },
        "provenance": {
            "raw_panel": str(raw_panel_path),
            "raw_panel_sha256": sha256_file(raw_panel_path),
            "canonical_no_freeze_panel": str(canonical_panel_path),
            "canonical_no_freeze_panel_sha256": sha256_file(canonical_panel_path),
            "taxonomy": str(taxonomy_path),
            "taxonomy_sha256": sha256_file(taxonomy_path),
            "processed_root": str(processed_root),
            "join_key": "forecast_due_date + lowercase source=polymarket + event_id",
            "freeze_field_mapping": (
                "event_taxonomy.market_prob is the audited rename of freeze_datetime_value"
            ),
            "snapshot_audit": snapshot_audit,
            "match_audit": match_audit,
            "nofreeze_alias_audit": nofreeze_alias_audit,
            "with_freeze_imputation_audit": freeze_imputation_audit,
            "no_freeze_imputation_audit": nofreeze_imputation_audit,
        },
        "eligibility": {
            "minimum_overlap": minimum_overlap,
            "minimum_fold_overlap": minimum_fold_overlap,
            "eligible_exact_configurations": eligible,
            "primary_eligible_configurations": primary_names,
            "excluded_exact_configurations": exclusions,
            "common_support": overlaps,
            "matched_exclusions": matched_exclusions,
            "same_version_no_freeze_base_exclusions": exposure_exclusions,
        },
        "selection_audit": selection_audit,
        "method_summary": [*summaries, *matched_summary, *exposure_summary],
        "repetition_summary": summarize_repetitions(
            fold_rows,
            "canonical_primary",
            primary_only=True,
        ),
        "similarity_summary": {
            "canonical_primary": [similarity_by_name[name] for name in primary_names],
            "all_configurations": similarity_rows,
            "matched": matched_similarity,
            "aggregate": [
                summarize_similarity_rows(
                    [similarity_by_name[name] for name in primary_names],
                    "canonical_primary",
                ),
                summarize_similarity_rows(
                    [
                        row
                        for row in matched_similarity
                        if row["freeze_exposure"] == "no_freeze"
                    ],
                    "matched_no_freeze",
                ),
                summarize_similarity_rows(
                    [
                        row
                        for row in matched_similarity
                        if row["freeze_exposure"] == "with_freeze"
                    ],
                    "matched_with_freeze",
                ),
            ],
        },
        "matched_method_differences": matched_differences,
    }
    return (
        report,
        fold_rows,
        pair_rows,
        matched_rows,
        exposure_fold_rows,
        exposure_pair_rows,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-panel", type=Path, default=Path("data/build/scored_panel.csv"))
    parser.add_argument(
        "--canonical-panel",
        type=Path,
        default=Path("data/build/scored_panel_model_versions.csv"),
    )
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument(
        "--processed-root",
        required=True,
        type=Path,
        help="Original ForecastBench processed JSON root used to exclude imputed rows.",
    )
    parser.add_argument("--split-seed", type=int, default=20260825)
    parser.add_argument("--split-repetitions", type=int, default=10)
    parser.add_argument("--minimum-overlap", type=int, default=50)
    parser.add_argument("--minimum-fold-overlap", type=int, default=50)
    parser.add_argument("--ec-weight", type=float, default=0.56)
    parser.add_argument("--piecewise-threshold", type=float, default=5.0)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/derived/freeze_exposed_market_aggregation"),
    )
    args = parser.parse_args()
    (
        report,
        fold_rows,
        pair_rows,
        matched_rows,
        exposure_fold_rows,
        exposure_pair_rows,
    ) = run_experiment(
        raw_panel_path=args.raw_panel,
        canonical_panel_path=args.canonical_panel,
        taxonomy_path=args.taxonomy,
        processed_root=args.processed_root,
        split_seed=args.split_seed,
        split_repetitions=args.split_repetitions,
        minimum_overlap=args.minimum_overlap,
        minimum_fold_overlap=args.minimum_fold_overlap,
        ec_weight=args.ec_weight,
        piecewise_threshold=args.piecewise_threshold,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = args.output_dir / "summary.json"
    fold_path = args.output_dir / "fold_method_results.csv.gz"
    pair_path = args.output_dir / "pair_method_results.csv"
    matched_path = args.output_dir / "matched_pair_method_results.csv"
    exposure_fold_path = args.output_dir / "without_freeze_base_fold_method_results.csv.gz"
    exposure_pair_path = args.output_dir / "without_freeze_base_pair_method_results.csv"
    summary_path.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(fold_path, fold_rows)
    write_csv(pair_path, pair_rows)
    write_csv(matched_path, matched_rows)
    write_csv(exposure_fold_path, exposure_fold_rows)
    write_csv(exposure_pair_path, exposure_pair_rows)
    print(
        json.dumps(
            {
                "summary": str(summary_path),
                "fold_results": str(fold_path),
                "pair_results": str(pair_path),
                "matched_results": str(matched_path),
                "without_freeze_base_fold_results": str(exposure_fold_path),
                "without_freeze_base_pair_results": str(exposure_pair_path),
                **report["audit"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
