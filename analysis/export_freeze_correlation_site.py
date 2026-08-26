"""Export a compact site payload for freeze-exposed model/market correlation."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
from pathlib import Path
from typing import Any

from analysis.closed_form_aggregation import aggregate_pairs
from analysis.freeze_exposed_market_aggregation import add_model_reference_fields
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

DIVERSITY_METRICS = {
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


def optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return float(value)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def directional_pair_indexes(
    fold_path: Path,
) -> dict[str, dict[tuple[str, str], dict[str, Any]]]:
    string_fields = {
        "experiment",
        "pair_id",
        "model_a",
        "model_b",
        "pair_group",
        "train_fold",
        "test_fold",
        "anchor",
        "partner",
        "method",
        "canonical_model_version",
        "model_configuration",
        "source_model_configuration",
        "freeze_exposure",
        "base_model_configuration",
        "partner_model_configuration",
    }
    integer_fields = {"repetition", "seed", "n_train", "n_test", "primary_configuration"}
    fold_rows: list[dict[str, Any]] = []
    for raw in read_csv_rows(fold_path):
        typed: dict[str, Any] = {}
        for field, value in raw.items():
            if field in string_fields:
                typed[field] = value
            elif field in integer_fields:
                typed[field] = int(value)
            elif value == "":
                typed[field] = None
            elif value.casefold() in {"true", "false"}:
                typed[field] = value.casefold() == "true"
            else:
                typed[field] = float(value)
        fold_rows.append(typed)
    output: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
    for direction, train_fold in (("a_to_b", "A"), ("b_to_a", "B")):
        selected = [row for row in fold_rows if row["train_fold"] == train_fold]
        aggregated = add_model_reference_fields(aggregate_pairs(selected))
        output[direction] = {
            (str(row["model_b"]), str(row["method"])): row
            for row in aggregated
        }
    return output


def aggregation_scores(
    index: dict[tuple[str, str], dict[str, Any]],
    model_b: str,
    *,
    base_name: str,
    partner_name: str,
) -> dict[str, Any]:
    anchor = index[(model_b, "anchor")]
    partner = index[(model_b, "partner")]
    aggregation: dict[str, dict[str, Any]] = {}
    for method in AGGREGATION_METHODS:
        row = index[(model_b, method)]
        aggregation[method] = {
            "brier_index": float(row["brier_index"]),
            "gain_vs_base": float(row["gain_vs_anchor"]),
            "gain_vs_partner": float(row["gain_vs_model"]),
            "test_target_cells": int(row["test_target_cells"]),
        }
    return {
        "base_name": base_name,
        "partner_name": partner_name,
        "base_brier_index": float(anchor["brier_index"]),
        "partner_brier_index": float(partner["brier_index"]),
        "partner_gain_vs_base": float(partner["gain_vs_anchor"]),
        "train_diversity": {
            metric: optional_float(anchor[f"train_{metric}_complementarity"])
            for metric in DIVERSITY_METRICS
        },
        "train_bi_gap": float(anchor["train_bi_gap"]),
        "train_near_bi_share": float(anchor["train_near_bi_share"]),
        "near_bi": float(anchor["train_bi_gap"]) <= 2.0,
        "train_target_cells": int(anchor["train_target_cells"]),
        "test_target_cells": int(anchor["test_target_cells"]),
        "aggregation": aggregation,
    }


def market_direction_scores(
    index: dict[tuple[str, str], dict[str, Any]],
    model_b: str,
) -> dict[str, Any]:
    generic = aggregation_scores(
        index,
        model_b,
        base_name="Polymarket Freeze",
        partner_name=model_b,
    )
    generic["market_brier_index"] = generic.pop("base_brier_index")
    generic["model_brier_index"] = generic.pop("partner_brier_index")
    generic["model_gain_vs_market"] = generic.pop("partner_gain_vs_base")
    for score in generic["aggregation"].values():
        score["gain_vs_market"] = score.pop("gain_vs_base")
        score["gain_vs_model"] = score.pop("gain_vs_partner")
    return generic


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


def build_payload(
    summary_path: Path,
    pair_path: Path,
    fold_path: Path | None = None,
) -> dict[str, Any]:
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

    pair_rows = read_csv_rows(pair_path)
    pair_index = {
        (row["model_b"], row["method"]): row
        for row in pair_rows
    }
    resolved_fold_path = fold_path or pair_path.with_name("fold_method_results.csv.gz")
    direction_indexes = directional_pair_indexes(resolved_fold_path)

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
                "train_diversity": {
                    "adjusted_pog": optional_float(
                        anchor["train_adjusted_pog_complementarity"]
                    ),
                    "high_loss_lift": optional_float(
                        anchor["train_high_loss_lift_complementarity"]
                    ),
                    "adjusted_loss_corr": optional_float(
                        anchor["train_adjusted_loss_corr_complementarity"]
                    ),
                },
                "train_bi_gap": float(anchor["train_bi_gap"]),
                "train_near_bi_share": float(anchor["train_near_bi_share"]),
                "near_bi": float(anchor["train_bi_gap"]) <= 2.0,
                "aggregation": aggregation,
                "directions": {
                    direction: market_direction_scores(index, exact_configuration)
                    for direction, index in direction_indexes.items()
                },
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
        "schema_version": "1.3.0",
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
                "Directional CF weights use training outcomes only; displayed points are "
                "pair-level aggregates across directions rather than directional regressions"
            ),
            "support_weighting": (
                "support-weighted across prompt/market pairs using repeated "
                "opposite-fold test target cells"
            ),
            "market_baseline": "ForecastBench freeze_datetime_value",
            "fold_views": {
                "combined": "ten A→B and ten B→A evaluations pooled",
                "a_to_b": "A-train diversity and B-test aggregation outcome",
                "b_to_a": "B-train diversity and A-test aggregation outcome",
            },
            "diversity_metrics": DIVERSITY_METRICS,
            "near_bi": {
                "threshold_bi_points": 2.0,
                "definition": "mean train-fold BI gap at most 2.0 points",
                "pair_count": sum(row["near_bi"] for row in points),
            },
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
            "fold_results": str(resolved_fold_path),
            "fold_results_sha256": sha256_file(resolved_fold_path),
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


def summarize_fixed_base_aggregation(
    points: list[dict[str, Any]],
    method: str,
) -> dict[str, Any]:
    scores = [point["combined"]["aggregation"][method] for point in points]
    support = sum(score["test_target_cells"] for score in scores)

    def weighted(field: str) -> float:
        return sum(score[field] * score["test_target_cells"] for score in scores) / support

    return {
        "method": method,
        "pair_count": len(scores),
        "test_target_cells": support,
        "support_weighted_brier_index": weighted("brier_index"),
        "support_weighted_gain_vs_base": weighted("gain_vs_base"),
        "support_weighted_gain_vs_partner": weighted("gain_vs_partner"),
        "positive_vs_base_pairs": sum(score["gain_vs_base"] > 0 for score in scores),
    }


def build_without_freeze_base_payload(
    summary_path: Path,
    pair_path: Path,
    fold_path: Path,
) -> dict[str, Any]:
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    pair_rows = read_csv_rows(pair_path)
    pair_index = {
        (row["model_b"], row["method"]): row
        for row in pair_rows
    }
    direction_indexes = directional_pair_indexes(fold_path)
    partner_names = sorted(
        {row["model_b"] for row in pair_rows if row["method"] == "anchor"},
        key=str.casefold,
    )
    points: list[dict[str, Any]] = []
    for partner_name in partner_names:
        anchor = pair_index[(partner_name, "anchor")]
        canonical = anchor["canonical_model_version"]
        model_family = family(canonical)
        if model_family not in PROVIDERS:
            raise ValueError(f"unsupported canonical model family: {canonical}")
        configuration = anchor["partner_model_configuration"]
        prompt = prompt_type(configuration)
        combined = aggregation_scores(
            pair_index,
            partner_name,
            base_name=anchor["model_a"],
            partner_name=partner_name,
        )
        points.append(
            {
                "model": canonical,
                "provider": PROVIDERS[model_family],
                "family": model_family,
                "base_configuration": anchor["model_a"],
                "partner_configuration": partner_name,
                "prompt_type": prompt,
                "prompt_label": "Scratchpad" if prompt == "scratchpad" else "Zero shot",
                "n_common": int(anchor["test_target_cells"]) // 10,
                "combined": combined,
                "directions": {
                    direction: aggregation_scores(
                        index,
                        partner_name,
                        base_name=anchor["model_a"],
                        partner_name=partner_name,
                    )
                    for direction, index in direction_indexes.items()
                },
            }
        )
    points.sort(
        key=lambda row: (
            str(row["provider"]).casefold(),
            str(row["model"]).casefold(),
            str(row["prompt_type"]),
        )
    )
    summaries = [
        summarize_fixed_base_aggregation(points, method)
        for method in AGGREGATION_METHODS
    ]
    exclusions = summary["eligibility"].get(
        "same_version_no_freeze_base_exclusions", {}
    )
    fixed_base_methods = json.loads(json.dumps(AGGREGATION_METHOD_METADATA))
    fixed_base_methods["ec_w0_56"]["formula"] = (
        "sigmoid(0.56 × (logit(p_base) + logit(p_partner)))"
    )
    fixed_base_methods["simple_mean"]["formula"] = "(p_base + p_partner) / 2"
    fixed_base_methods["log_odds_mean"]["formula"] = (
        "sigmoid((logit(p_base) + logit(p_partner)) / 2)"
    )
    fixed_base_methods["piecewise_odds"]["formula"] = (
        "threshold-5 piecewise transform of the summed base/partner logits"
    )
    fixed_base_methods["best_single"]["formula"] = (
        "higher test-fold adjusted Brier Index of base and partner on identical support"
    )
    return {
        "schema_version": "1.0.0",
        "generated_at": summary["generated_at"],
        "title": "Without-freeze base × with-freeze partner",
        "scope": (
            "Each exact zero-shot or scratchpad with-freeze forecast is paired with the "
            "same canonical model version without freeze values on identical, non-imputed "
            "Polymarket event support."
        ),
        "base": {
            "label": "Without-freeze same-version model",
            "fixed": True,
            "selection": "released canonical no-freeze ForecastBench model-version panel",
        },
        "partner": {
            "label": "With-freeze same-version model",
            "selection": "every eligible exact zero-shot or scratchpad configuration",
        },
        "evaluation": {
            "design": (
                "ten-repeat event-disjoint two-fold cross-fit; all diversity diagnostics "
                "and Directional CF weights use the named training fold only"
            ),
            "fold_views": {
                "combined": "ten A→B and ten B→A evaluations pooled",
                "a_to_b": "A-train diversity and B-test aggregation outcome",
                "b_to_a": "B-train diversity and A-test aggregation outcome",
            },
            "near_bi_threshold": 2.0,
            "diversity_metrics": DIVERSITY_METRICS,
            "methods": fixed_base_methods,
            "summary_combined": summaries,
        },
        "audit": {
            "configuration_count": len(points),
            "model_count": len({point["model"] for point in points}),
            "prompt_counts": {
                prompt: sum(point["prompt_type"] == prompt for point in points)
                for prompt in ("zero_shot", "scratchpad")
            },
            "near_bi_combined_count": sum(point["combined"]["near_bi"] for point in points),
            "excluded_configurations": exclusions,
            "all_bases_fixed_without_freeze": all(
                point["combined"]["base_name"].endswith("(without freeze values)")
                for point in points
            ),
            "all_partners_explicit_with_freeze": all(
                is_news_free_freeze_configuration(point["partner_configuration"])
                for point in points
            ),
        },
        "provenance": {
            "summary": str(summary_path),
            "summary_sha256": sha256_file(summary_path),
            "pair_results": str(pair_path),
            "pair_results_sha256": sha256_file(pair_path),
            "fold_results": str(fold_path),
            "fold_results_sha256": sha256_file(fold_path),
            "imputation_policy": summary["design"]["imputation_policy"],
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
        "--fold-results",
        type=Path,
        default=Path(
            "data/derived/freeze_exposed_market_aggregation/fold_method_results.csv.gz"
        ),
    )
    parser.add_argument(
        "--without-freeze-pair-results",
        type=Path,
        default=Path(
            "data/derived/freeze_exposed_market_aggregation/"
            "without_freeze_base_pair_method_results.csv"
        ),
    )
    parser.add_argument(
        "--without-freeze-fold-results",
        type=Path,
        default=Path(
            "data/derived/freeze_exposed_market_aggregation/"
            "without_freeze_base_fold_method_results.csv.gz"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "site/public/data/polymarket-aggregation/freeze-exposed-correlation.json"
        ),
    )
    parser.add_argument(
        "--without-freeze-output",
        type=Path,
        default=Path(
            "site/public/data/polymarket-aggregation/without-freeze-base.json"
        ),
    )
    args = parser.parse_args()
    payload = build_payload(args.summary, args.pair_results, args.fold_results)
    without_freeze_payload = build_without_freeze_base_payload(
        args.summary,
        args.without_freeze_pair_results,
        args.without_freeze_fold_results,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    args.without_freeze_output.parent.mkdir(parents=True, exist_ok=True)
    args.without_freeze_output.write_text(
        json.dumps(
            without_freeze_payload,
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "models": payload["audit"]["model_count"],
                "model_event_cells": payload["audit"]["model_event_cells"],
                "without_freeze_output": str(args.without_freeze_output),
                "without_freeze_configurations": without_freeze_payload["audit"][
                    "configuration_count"
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
