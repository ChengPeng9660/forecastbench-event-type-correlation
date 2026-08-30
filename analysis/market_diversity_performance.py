"""Export exact-configuration market diversity versus performance data.

Every clean ForecastBench LLM configuration is kept as a separate observation.
Only the moving ``GPT-4o`` alias is pinned to ``GPT-4o-2024-05-13``; prompt and
information conditions are never collapsed.  Each model and Polymarket score is
computed on identical, non-imputed Polymarket target support.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Mapping

from analysis.metrics import brier_index, pearson_correlation
from analysis.polymarket_cleaning import exclude_imputed_polymarket_rows
from analysis.model_versions import split_model_version
from analysis.pair_aggregation import (
    KEY,
    adjusted_loss,
    dependence_support,
    official_mean,
    resolve_model_alias,
    sha256_file,
)
from analysis.polymarket_aggregation import BASELINE_NAME, build_freeze_panel, read_freeze_snapshots


MINIMUM_OVERLAP = 50


def exact_label(canonical: str, configuration: str) -> str:
    return f"{canonical} ({configuration})" if configuration else canonical


def prompt_metadata(configuration: str) -> tuple[str, str]:
    normalized = " ".join(configuration.casefold().split())
    if normalized.startswith("zero shot"):
        return "zero_shot", "Zero shot"
    if normalized.startswith("scratchpad"):
        return "scratchpad", "Scratchpad"
    return "unspecified", "Unspecified"


def information_metadata(configuration: str) -> tuple[str, str]:
    normalized = " ".join(configuration.casefold().split())
    has_freeze = "freeze values" in normalized
    has_news = "news" in normalized
    has_web = "web search" in normalized
    if has_web and has_freeze:
        return "web_search_freeze", "Web search + freeze"
    if has_web:
        return "web_search", "Web search"
    if has_news and has_freeze:
        return "news_freeze", "News + freeze"
    if has_news:
        return "news", "News"
    if has_freeze:
        return "freeze_values", "Freeze values"
    if not normalized or normalized in {"zero shot", "scratchpad"}:
        return "none", "No extra information"
    return "other", "Other"


def read_exact_panel(
    path: Path,
) -> tuple[
    dict[str, dict[tuple[str, ...], dict[str, str]]],
    dict[str, dict[str, str]],
    dict[str, Any],
]:
    panel: dict[str, dict[tuple[str, ...], dict[str, str]]] = defaultdict(dict)
    metadata: dict[str, dict[str, str]] = {}
    source_names: dict[str, set[str]] = defaultdict(set)
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
            raise ValueError(f"raw scored panel is missing fields: {sorted(missing)}")
        for raw in reader:
            source_name = raw["model_name"].strip()
            canonical, configuration = split_model_version(source_name)
            canonical = resolve_model_alias(canonical)
            name = exact_label(canonical, configuration)
            key = tuple(raw[field] for field in KEY)
            if key in panel[name]:
                raise ValueError(f"exact-configuration alias merge collision for {name}: {key}")
            row = dict(raw)
            row["model_name"] = name
            panel[name][key] = row
            source_names[name].add(source_name)
            current = metadata.setdefault(
                name,
                {
                    "canonical_model_version": canonical,
                    "exact_configuration": name,
                    "model_configuration": configuration,
                    "provider": raw["model_organization"].strip() or "Unknown",
                },
            )
            provider = raw["model_organization"].strip() or "Unknown"
            if current["provider"] != provider:
                raise ValueError(f"provider changed inside {name}: {current['provider']} vs {provider}")
    return dict(panel), metadata, {
        "raw_exact_configurations": len(panel),
        "canonical_model_versions": len({row["canonical_model_version"] for row in metadata.values()}),
        "alias_merged_configurations": {
            name: sorted(values) for name, values in source_names.items() if len(values) > 1
        },
    }


def probability_pearson(
    first: Mapping[tuple[str, ...], Mapping[str, str]],
    second: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
) -> float | None:
    values, reason = pearson_correlation(
        [float(first[key]["prediction"]) for key in keys],
        [float(second[key]["prediction"]) for key in keys],
    )
    return None if reason else values


def raw_brier(
    panel: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
) -> float:
    return sum(
        (float(panel[key]["prediction"]) - float(panel[key]["outcome"])) ** 2
        for key in keys
    ) / len(keys)


def adjusted_brier(
    panel: Mapping[tuple[str, ...], Mapping[str, str]],
    keys: list[tuple[str, ...]],
) -> float:
    return official_mean(
        (
            panel[key]["origin_type"],
            adjusted_loss(panel[key], float(panel[key]["prediction"])),
        )
        for key in keys
    )


def build_payload(
    panel_path: Path,
    taxonomy_path: Path,
    processed_root: Path,
    minimum_overlap: int = MINIMUM_OVERLAP,
) -> dict[str, Any]:
    panel, metadata, panel_audit = read_exact_panel(panel_path)
    panel, imputation_audit = exclude_imputed_polymarket_rows(panel, processed_root)
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    market_panel, match_audit = build_freeze_panel(panel, snapshots)

    points: list[dict[str, Any]] = []
    exclusions: dict[str, str] = {}
    for name in sorted(panel, key=lambda item: (metadata[item]["provider"], item.casefold(), item)):
        keys = sorted(set(panel[name]) & set(market_panel))
        if len(keys) < minimum_overlap:
            exclusions[name] = f"non-imputed common market support {len(keys)} < {minimum_overlap}"
            continue
        dependence = dependence_support(
            market_panel,
            panel[name],
            keys,
            near_bi_gap=2.0,
            high_loss_threshold=0.25,
        )
        model_adjusted = adjusted_brier(panel[name], keys)
        market_adjusted = adjusted_brier(market_panel, keys)
        model_bi, model_bi_reason = brier_index(model_adjusted)
        market_bi, market_bi_reason = brier_index(market_adjusted)
        if model_bi is None or market_bi is None:
            exclusions[name] = f"undefined BI: model={model_bi_reason}; market={market_bi_reason}"
            continue
        configuration = metadata[name]["model_configuration"]
        prompt_id, prompt_label = prompt_metadata(configuration)
        information_id, information_label = information_metadata(configuration)
        prediction_r = probability_pearson(market_panel, panel[name], keys)
        metrics = {
            metric: values["complementarity"]
            for metric, values in dependence["metrics"].items()
        }
        metrics["prediction_diversity"] = None if prediction_r is None else 1 - prediction_r
        points.append(
            {
                **metadata[name],
                "prompt_type": prompt_id,
                "prompt_label": prompt_label,
                "information_type": information_id,
                "information_label": information_label,
                "n_common": len(keys),
                "date_min": min(key[0][:10] for key in keys),
                "date_max": max(key[0][:10] for key in keys),
                "prediction_pearson": prediction_r,
                "diversity": metrics,
                "high_loss_diagnostics": dependence["high_loss_diagnostics"],
                "model": {
                    "raw_brier": raw_brier(panel[name], keys),
                    "adjusted_brier": model_adjusted,
                    "brier_index": model_bi,
                },
                "matched_market": {
                    "raw_brier": raw_brier(market_panel, keys),
                    "adjusted_brier": market_adjusted,
                    "brier_index": market_bi,
                },
            }
        )

    if not points:
        raise ValueError("no eligible exact configurations")
    points.sort(
        key=lambda row: (
            str(row["canonical_model_version"]).casefold(),
            str(row["canonical_model_version"]),
            str(row["information_type"]),
            str(row["prompt_type"]),
        )
    )
    information_counts = Counter(row["information_type"] for row in points)
    prompt_counts = Counter(row["prompt_type"] for row in points)
    provider_counts = Counter(row["provider"] for row in points)
    return {
        "schema_version": "1.0.0",
        "generated_at": "2026-08-27",
        "title": "Market diversity versus forecasting performance",
        "scope": (
            "All eligible exact clean-LLM configurations on non-imputed Polymarket rows. "
            "Model version aliases are merged, while information and prompt conditions remain separate."
        ),
        "metrics": {
            "total_variation": {
                "label": "Total variation (TV)",
                "axis": "Mean |p_model − p_market|",
                "formula": "mean(abs(p_model - p_market)) on original paired Bernoulli probabilities",
                "range": [0.0, 1.0],
                "higher_is_more_diverse": True,
            },
            "prediction_diversity": {
                "label": "Prediction diversity",
                "axis": "1 − prediction-level Pearson r",
                "higher_means": "less linear alignment with the freeze-time market probability",
            },
            "adjusted_pog": {
                "label": "Adjusted POG",
                "axis": "Adjusted pairwise oracle gain",
                "higher_means": "greater ex-post loss complementarity",
            },
            "high_loss_lift": {
                "label": "High-loss diversity",
                "axis": "1 − adjusted high-loss lift",
                "higher_means": "fewer severe errors occurring together",
            },
            "adjusted_loss_corr": {
                "label": "Adjusted-loss diversity",
                "axis": "− adjusted-loss Pearson correlation",
                "higher_means": "less aligned difficulty-adjusted losses",
            },
        },
        "outcomes": {
            "raw_brier": {
                "label": "Raw Brier Score",
                "axis": "Raw Brier Score (lower is better)",
                "higher_is_better": False,
            },
            "brier_index": {
                "label": "Brier Index",
                "axis": "Brier Index (higher is better)",
                "higher_is_better": True,
                "formula": "(1 - sqrt(adjusted Brier)) × 100",
            },
        },
        "encoding": {
            "color": "information_type",
            "shape": "prompt_type",
            "market_line": (
                "support-weighted mean of each selected configuration's matched-market score; "
                "each tooltip also reports its exact matched-market score"
            ),
        },
        "eligibility": {
            "minimum_overlap": minimum_overlap,
            "eligible_configurations": len(points),
            "excluded_configurations": exclusions,
        },
        "audit": {
            **panel_audit,
            "eligible_canonical_model_versions": len(
                {row["canonical_model_version"] for row in points}
            ),
            "eligible_exact_configurations": len(points),
            "information_counts": dict(sorted(information_counts.items())),
            "prompt_counts": dict(sorted(prompt_counts.items())),
            "provider_counts": dict(sorted(provider_counts.items())),
            "model_event_cells": sum(row["n_common"] for row in points),
            "all_scores_use_identical_pair_support": True,
            "imputation_audit": imputation_audit,
            "snapshot_audit": snapshot_audit,
            "match_audit": match_audit,
        },
        "provenance": {
            "panel": str(panel_path),
            "panel_sha256": sha256_file(panel_path),
            "taxonomy": str(taxonomy_path),
            "taxonomy_sha256": sha256_file(taxonomy_path),
            "join_key": "forecast_due_date + lowercase source=polymarket + event_id + horizon",
            "market_probability": "event_taxonomy.market_prob, audited from freeze_datetime_value",
        },
        "points": points,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument("--processed-root", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("site/public/data/polymarket-aggregation/market-diversity-performance.json"),
    )
    parser.add_argument("--minimum-overlap", type=int, default=MINIMUM_OVERLAP)
    args = parser.parse_args()
    payload = build_payload(args.panel, args.taxonomy, args.processed_root, args.minimum_overlap)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "eligible_configurations": payload["audit"]["eligible_exact_configurations"],
                "canonical_model_versions": payload["audit"]["eligible_canonical_model_versions"],
                "model_event_cells": payload["audit"]["model_event_cells"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
