"""Export a compact site payload for freeze-exposed model/market correlation."""

from __future__ import annotations

import argparse
import csv
import json
import math
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

AGGREGATION_METHODS = (
    "ec_w0_56",
    "simple_mean",
    "log_odds_mean",
    "piecewise_odds",
    "cf_directional",
    "best_single",
)

AGGREGATION_METHOD_METADATA = {
    "ec_w0_56": {
        "label": "EC · w = 0.56",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "sigmoid(0.56 × (logit(p_market) + logit(p_model)))",
    },
    "simple_mean": {
        "label": "Simple Mean",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "(p_market + p_model) / 2",
    },
    "log_odds_mean": {
        "label": "Log-odds Mean",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "sigmoid((logit(p_market) + logit(p_model)) / 2)",
    },
    "piecewise_odds": {
        "label": "Piecewise Odds",
        "role": "Outcome-blind fixed pool",
        "outcome_blind_at_test": True,
        "formula": "threshold-5 piecewise transform of the summed market/model logits",
    },
    "cf_directional": {
        "label": "Directional CF",
        "role": "Train-fold fitted closed-form pool",
        "outcome_blind_at_test": True,
        "formula": "direction-specific clipped C / D weight fitted on the training fold",
    },
    "best_single": {
        "label": "Best Single",
        "role": "Hindsight benchmark; not deployable",
        "outcome_blind_at_test": False,
        "formula": "lower test-fold adjusted Brier of market and model on identical support",
    },
}


def _normalized_configuration(configuration: str) -> str:
    return " ".join(configuration.casefold().split())


def is_news_free_freeze_configuration(configuration: str) -> bool:
    """Return true for explicit freeze-value prompts without news augmentation."""

    normalized = _normalized_configuration(configuration)
    return "with freeze values" in normalized and "news" not in normalized


def prompt_type(configuration: str) -> str:
    normalized = _normalized_configuration(configuration)
    if "scratchpad" in normalized:
        return "scratchpad"
    if "zero shot" in normalized:
        return "zero_shot"
    raise ValueError(f"unsupported freeze prompt type: {configuration!r}")


def summarize_aggregation(
    points: list[dict[str, Any]], method: str
) -> dict[str, Any]:
    scores = [(row, row["aggregation"][method]) for row in points]
    support = sum(score["test_target_cells"] for _, score in scores)
    if not support:
        raise ValueError(f"aggregation summary has no support for {method}")

    def weighted(field: str) -> float:
        return sum(
            score[field] * score["test_target_cells"] for _, score in scores
        ) / support

    return {
        "method": method,
        "pair_count": len(scores),
        "test_target_cells": support,
        "support_weighted_brier_index": weighted("brier_index"),
        "support_weighted_gain_vs_market": weighted("gain_vs_market"),
        "support_weighted_gain_vs_model": weighted("gain_vs_model"),
        "positive_vs_market_pairs": sum(
            score["gain_vs_market"] > 0 for _, score in scores
        ),
    }


def build_payload(summary_path: Path, pair_path: Path) -> dict[str, Any]:
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    candidate_similarities = summary["similarity_summary"]["all_configurations"]
    non_freeze = [
        row
        for row in candidate_similarities
        if "with freeze values"
        not in _normalized_configuration(row["model_configuration"])
    ]
    if non_freeze:
        raise ValueError("all-configuration sample contains a non-freeze configuration")
    excluded_news = [
        row
        for row in candidate_similarities
        if "news" in _normalized_configuration(row["model_configuration"])
    ]
    excluded_news_candidates = sum(
        "news" in _normalized_configuration(row["model_configuration"])
        for row in summary.get("selection_audit", [])
    )
    similarities = [
        row
        for row in candidate_similarities
        if is_news_free_freeze_configuration(row["model_configuration"])
    ]
    if not similarities:
        raise ValueError("no news-free with-freeze configurations available for site export")

    with pair_path.open(encoding="utf-8", newline="") as handle:
        pair_rows = list(csv.DictReader(handle))
    pair_index = {
        (row["model_b"], row["method"]): row
        for row in pair_rows
    }

    points: list[dict[str, Any]] = []
    for row in similarities:
        canonical = row["canonical_model_version"]
        model_family = family(canonical)
        if model_family not in PROVIDERS:
            raise ValueError(f"unsupported canonical model family: {canonical}")
        exact_configuration = row["model_configuration"]
        anchor = pair_index[(exact_configuration, "anchor")]
        partner = pair_index[(exact_configuration, "partner")]
        if int(anchor["test_target_cells"]) != int(row["n"]) * 10:
            raise ValueError(f"cross-fit support mismatch for {exact_configuration}")
        prompt = prompt_type(anchor["model_configuration"])
        aggregation: dict[str, dict[str, Any]] = {}
        for method in AGGREGATION_METHODS:
            method_row = pair_index[(exact_configuration, method)]
            if method_row["test_target_cells"] != anchor["test_target_cells"]:
                raise ValueError(
                    f"aggregation support mismatch for {exact_configuration}: {method}"
                )
            aggregation[method] = {
                "brier_index": float(method_row["brier_index"]),
                "gain_vs_market": float(method_row["gain_vs_anchor"]),
                "gain_vs_model": float(method_row["gain_vs_model"]),
                "test_target_cells": int(method_row["test_target_cells"]),
            }
        points.append(
            {
                "model": canonical,
                "exact_configuration": exact_configuration,
                "prompt_type": prompt,
                "prompt_label": "Scratchpad" if prompt == "scratchpad" else "Zero shot",
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
                "aggregation": aggregation,
            }
        )
    points.sort(
        key=lambda row: (
            -float(row["prediction_pearson"]),
            str(row["model"]).casefold(),
            str(row["model"]),
            str(row["prompt_type"]),
        )
    )
    if len(points) + len(excluded_news) != summary["audit"]["eligible_exact_configurations"]:
        raise ValueError("site correlation point count does not match experiment audit")
    if any(
        not is_news_free_freeze_configuration(row["exact_configuration"])
        for row in points
    ):
        raise ValueError("site correlation payload contains a non-freeze or news configuration")

    correlations = [float(row["prediction_pearson"]) for row in points]
    model_event_cells = sum(int(row["n_common"]) for row in points)
    model_count = len({str(row["model"]) for row in points})
    prompt_counts = {
        prompt: sum(row["prompt_type"] == prompt for row in points)
        for prompt in ("zero_shot", "scratchpad")
    }

    def support_weighted(field: str) -> float:
        return sum(float(row[field]) * int(row["n_common"]) for row in points) / model_event_cells

    aggregation_summary = [
        summarize_aggregation(points, method) for method in AGGREGATION_METHODS
    ]
    source_summary = {
        row["method"]: row
        for row in summary["method_summary"]
        if row["sample"] == "all_configurations"
    }
    for derived in aggregation_summary:
        source = source_summary[derived["method"]]
        comparisons = {
            "pair_count": source["pair_count"],
            "test_target_cells": source["pair_event_cells"],
            "support_weighted_brier_index": source["support_weighted_brier_index"],
            "support_weighted_gain_vs_market": source[
                "support_weighted_gain_vs_market"
            ],
            "support_weighted_gain_vs_model": source[
                "support_weighted_gain_vs_model"
            ],
            "positive_vs_market_pairs": round(
                source["positive_vs_market_share"] * source["pair_count"]
            ),
        }
        for field, expected in comparisons.items():
            observed = derived[field]
            if isinstance(expected, float):
                matches = math.isclose(observed, expected, rel_tol=1e-12, abs_tol=1e-12)
            else:
                matches = observed == expected
            if not matches:
                raise ValueError(
                    f"aggregation summary mismatch for {derived['method']} {field}: "
                    f"{observed} != {expected}"
                )

    return {
        "schema_version": "1.1.0",
        "generated_at": summary["generated_at"],
        "title": "Freeze-only prompt ↔ Polymarket correlation",
        "scope": (
            "Every eligible zero-shot and scratchpad with-freeze configuration is kept "
            "as a separate observation; news-augmented configurations are excluded. "
            "Correlations use identical non-imputed Polymarket event support."
        ),
        "metric": {
            "id": "prediction_pearson",
            "label": "Prediction Pearson correlation",
            "range": [-1, 1],
            "higher_means": "closer linear alignment with the same freeze-time market probability",
            "causal_warning": "Correlation measures similarity, not incremental forecasting value.",
        },
        "aggregation": {
            "evaluation": (
                "ten-repeat, event-disjoint two-fold cross-fit in both directions; "
                "Directional CF weights use training outcomes only"
            ),
            "support_weighting": (
                "support-weighted across prompt/market pairs using repeated "
                "opposite-fold test target cells"
            ),
            "market_baseline": "ForecastBench freeze_datetime_value",
            "methods": AGGREGATION_METHOD_METADATA,
            "summary_all": aggregation_summary,
        },
        "audit": {
            "model_count": model_count,
            "configuration_count": len(points),
            "prompt_counts": prompt_counts,
            "model_event_cells": model_event_cells,
            "support_weighted_prediction_pearson": support_weighted(
                "prediction_pearson"
            ),
            "support_weighted_exact_copy_share": support_weighted(
                "exact_copy_share"
            ),
            "support_weighted_mean_absolute_difference": support_weighted(
                "mean_absolute_difference"
            ),
            "correlation_minimum": min(correlations),
            "correlation_maximum": max(correlations),
            "imputed_rows_excluded_all_configurations": summary["provenance"][
                "with_freeze_imputation_audit"
            ]["excluded_imputed_rows"],
            "all_configs_explicitly_with_freeze": all(
                "with freeze values"
                in _normalized_configuration(row["exact_configuration"])
                for row in points
            ),
            "all_configs_exclude_news": True,
            "excluded_news_augmented_candidate_configurations": excluded_news_candidates,
        },
        "provenance": {
            "summary": str(summary_path),
            "summary_sha256": sha256_file(summary_path),
            "pair_results": str(pair_path),
            "pair_results_sha256": sha256_file(pair_path),
            "market_probability": summary["design"]["market_probability"],
            "imputation_policy": summary["design"]["imputation_policy"],
            "configuration_selection": (
                "all eligible exact zero-shot and scratchpad with-freeze configurations"
            ),
            "site_filter": (
                "require explicit 'with freeze values' and exclude configurations "
                "containing 'news'"
            ),
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
