"""Export a compact site payload for freeze-exposed model/market correlation."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from analysis.pair_aggregation import family, sha256_file


PROVIDERS = {
    "GPT": "OpenAI",
    "Claude": "Anthropic",
    "Gemini": "Google",
    "Qwen": "Qwen",
    "DeepSeek": "DeepSeek",
    "Kimi": "Moonshot",
}


def build_payload(summary_path: Path, pair_path: Path) -> dict[str, Any]:
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    similarities = summary["similarity_summary"]["canonical_primary"]
    aggregate = next(
        row
        for row in summary["similarity_summary"]["aggregate"]
        if row["sample"] == "canonical_primary"
    )

    with pair_path.open(encoding="utf-8", newline="") as handle:
        pair_rows = list(csv.DictReader(handle))
    pair_index = {
        (row["canonical_model_version"], row["method"]): row
        for row in pair_rows
        if row["primary_configuration"] == "1"
    }

    points: list[dict[str, Any]] = []
    for row in similarities:
        canonical = row["canonical_model_version"]
        model_family = family(canonical)
        if model_family not in PROVIDERS:
            raise ValueError(f"unsupported canonical model family: {canonical}")
        anchor = pair_index[(canonical, "anchor")]
        partner = pair_index[(canonical, "partner")]
        if int(anchor["test_target_cells"]) != int(row["n"]) * 10:
            raise ValueError(f"cross-fit support mismatch for {canonical}")
        points.append(
            {
                "model": canonical,
                "exact_configuration": row["model_configuration"],
                "family": model_family,
                "provider": PROVIDERS[model_family],
                "n_common": int(row["n"]),
                "prediction_pearson": row["prediction_pearson"],
                "mean_absolute_difference": row["mean_absolute_difference"],
                "root_mean_squared_difference": row["root_mean_squared_difference"],
                "exact_copy_share": row["exact_copy_share"],
                "market_mean_probability": row["market_mean_probability"],
                "model_mean_probability": row["model_mean_probability"],
                "market_brier_index": float(anchor["brier_index"]),
                "model_brier_index": float(partner["brier_index"]),
                "model_gain_vs_market": float(partner["gain_vs_anchor"]),
            }
        )
    points.sort(
        key=lambda row: (
            -float(row["prediction_pearson"]),
            str(row["model"]).casefold(),
            str(row["model"]),
        )
    )
    if len(points) != summary["audit"]["primary_eligible_model_versions"]:
        raise ValueError("site correlation point count does not match experiment audit")
    if any("with freeze values" not in row["exact_configuration"].casefold() for row in points):
        raise ValueError("site correlation payload contains a non-freeze configuration")

    correlations = [float(row["prediction_pearson"]) for row in points]
    return {
        "schema_version": "1.0.0",
        "generated_at": summary["generated_at"],
        "title": "With-freeze model ↔ Polymarket correlation",
        "scope": (
            "One outcome-blind canonical configuration per explicit with-freeze "
            "model version, on identical non-imputed Polymarket event support."
        ),
        "metric": {
            "id": "prediction_pearson",
            "label": "Prediction Pearson correlation",
            "range": [-1, 1],
            "higher_means": "closer linear alignment with the same freeze-time market probability",
            "causal_warning": "Correlation measures similarity, not incremental forecasting value.",
        },
        "audit": {
            "model_count": len(points),
            "model_event_cells": aggregate["model_event_cells"],
            "support_weighted_prediction_pearson": aggregate[
                "support_weighted_prediction_pearson"
            ],
            "support_weighted_exact_copy_share": aggregate[
                "support_weighted_exact_copy_share"
            ],
            "support_weighted_mean_absolute_difference": aggregate[
                "support_weighted_mean_absolute_difference"
            ],
            "correlation_minimum": min(correlations),
            "correlation_maximum": max(correlations),
            "imputed_rows_excluded_all_configurations": summary["provenance"][
                "with_freeze_imputation_audit"
            ]["excluded_imputed_rows"],
            "all_configs_explicitly_with_freeze": summary["audit"][
                "all_selected_configs_explicitly_with_freeze"
            ],
        },
        "provenance": {
            "summary": str(summary_path),
            "summary_sha256": sha256_file(summary_path),
            "pair_results": str(pair_path),
            "pair_results_sha256": sha256_file(pair_path),
            "market_probability": summary["design"]["market_probability"],
            "imputation_policy": summary["design"]["imputation_policy"],
            "configuration_selection": summary["design"]["primary_selection"],
        },
        "points": points,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("data/derived/freeze_exposed_market_aggregation/summary.json"),
    )
    parser.add_argument(
        "--pair-results",
        type=Path,
        default=Path(
            "data/derived/freeze_exposed_market_aggregation/pair_method_results.csv"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "site/public/data/polymarket-aggregation/freeze-exposed-correlation.json"
        ),
    )
    args = parser.parse_args()
    payload = build_payload(args.summary, args.pair_results)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "models": payload["audit"]["model_count"],
                "model_event_cells": payload["audit"]["model_event_cells"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
