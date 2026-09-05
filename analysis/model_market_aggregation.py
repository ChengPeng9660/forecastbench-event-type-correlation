"""Cross-fit every published exact configuration with a fixed Polymarket base.

Reuse the hash-verified, non-imputed configuration-pair input snapshot. This is
a separate experiment: no previous data or scoring code is changed. The market
is both the first (fixed anchor) constituent and the matched-test reference.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from analysis import configuration_pair_aggregation as pair
from analysis.pair_aggregation import event_fold, sha256_file


SCHEMA_VERSION = 2
MARKET_BASE = "Polymarket Freeze"
REPOSITORY_ROOT = Path(__file__).resolve().parent.parent


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")


def _public_path(path: Path, repository_root: Path = REPOSITORY_ROOT) -> str:
    """Retain repository-relative provenance without leaking local directories."""
    try:
        return path.resolve().relative_to(repository_root.resolve()).as_posix()
    except ValueError:
        return path.name


def load_verified_inputs(
    clean_cache: Path,
    panel_path: Path,
    taxonomy_path: Path,
    catalog_path: Path,
    *,
    allow_metric_refresh: bool = False,
):
    # The clean cache fixes support and raw probabilities.  Its producer hash is
    # expected to differ when the scoring definition is deliberately revised;
    # load_clean_cache verifies the cache hash and reconstructs every catalog
    # score under the current metric contract.
    if not allow_metric_refresh:
        source_audit = json.loads((clean_cache.parent / "audit.json").read_text(encoding="utf-8"))
        if sha256_file(Path(pair.__file__)) != source_audit["provenance"]["producer_sha256"]:
            raise ValueError("cached experiment producer SHA-256 differs from the audited scoring module")
    return pair.load_clean_cache(
        clean_cache, panel_path, taxonomy_path, catalog_path,
        allow_metric_refresh=allow_metric_refresh,
    )


def evaluate_model_market(
    exact_configuration: str,
    model: Mapping[pair.TargetKey, pair.Observation],
    market: Mapping[pair.TargetKey, pair.Observation],
    *, split_seeds: Iterable[int] = pair.DEFAULT_SEEDS,
    minimum_fold_overlap: int = 1,
    assignments: Mapping[pair.TargetKey, tuple[bool, ...]] | None = None,
) -> dict[str, Any]:
    if exact_configuration == MARKET_BASE:
        raise ValueError("the model configuration cannot use the reserved market identity")
    result = pair.evaluate_prepared_pair(
        MARKET_BASE, exact_configuration, market, model, market,
        split_seeds=split_seeds, minimum_fold_overlap=minimum_fold_overlap, assignments=assignments,
    )
    common = sorted(set(model) & set(market))
    for fold in result["folds"]:
        train = [key for key in common if event_fold(key[1], key[2], fold["seed"]) == fold["train_fold"]]
        test = [key for key in common if event_fold(key[1], key[2], fold["seed"]) == fold["test_fold"]]
        train_events = {(key[1].casefold(), key[2]) for key in train}
        test_events = {(key[1].casefold(), key[2]) for key in test}
        if train_events & test_events or len(train) != fold["n_train"] or len(test) != fold["n_test"]:
            raise ValueError(f"event split or recorded support mismatch: {exact_configuration}, {fold['fold_id']}")
        if fold["first"] != fold["market"]:
            raise ValueError("fixed market anchor differs from its matched-test market reference")
    return result


def run_experiment(
    clean_cache: Path, panel_path: Path, taxonomy_path: Path, catalog_path: Path,
    output_dir: Path, site_output_dir: Path, *, split_seeds: Iterable[int] = pair.DEFAULT_SEEDS,
    minimum_fold_overlap: int = 1, repository_root: Path = REPOSITORY_ROOT,
    baseline_commit: str | None = None,
    metric_definition_refresh: bool = False,
) -> dict[str, Any]:
    seeds = tuple(split_seeds)
    panel, market, identities, input_audit = load_verified_inputs(
        clean_cache, panel_path, taxonomy_path, catalog_path,
        allow_metric_refresh=metric_definition_refresh,
    )
    prepared_market = pair.prepare_panel(market)
    assignments = {key: tuple(event_fold(key[1], key[2], seed) == "A" for seed in seeds) for key in market}
    print(json.dumps({"stage": "inputs_verified", "configurations": len(identities),
                      "configuration_target_rows": sum(map(len, panel.values()))}), flush=True)
    points = []
    statuses: Counter[str] = Counter()
    fold_histogram: Counter[int] = Counter()
    fold_count = 0
    with pair.FoldWriter(output_dir) as writer:
        for name in sorted(identities, key=lambda value: (value.casefold(), value)):
            result = evaluate_model_market(name, pair.prepare_panel(panel[name]), prepared_market,
                                           split_seeds=seeds, minimum_fold_overlap=minimum_fold_overlap,
                                           assignments=assignments)
            statuses[result["status"]] += 1
            fold_histogram[len(result["folds"])] += 1
            for fold in result["folds"]:
                writer.write({"first_configuration": MARKET_BASE, "second_configuration": name, **fold})
                fold_count += 1
            views = pair.build_views(result, reverse=False)
            for sample in views.values():
                for view in sample.values():
                    if view is not None and view["base"] != view["market"]:
                        raise ValueError("pooled market anchor differs from the matched-market reference")
            points.append({
                "configuration": identities[name],
                **{key: value for key, value in result.items()
                   if key not in ("folds", "first_configuration", "second_configuration")},
                "views": views,
            })

    fold_path = output_dir / "fold-results-manifest.json"
    _write_json(fold_path, {"schema_version": SCHEMA_VERSION, "format": "jsonl_gzip",
                            "market_base": MARKET_BASE, "row_count": fold_count, "files": writer.files})
    provenance = {
        **{name: _public_path(path, repository_root) for name, path in
           (("clean_cache", clean_cache), ("source_audit", clean_cache.parent / "audit.json"),
            ("panel", panel_path), ("taxonomy", taxonomy_path), ("catalog", catalog_path))},
        **{f"{name}_sha256": sha256_file(path) if path.is_file() else input_audit.get("original_provenance", {}).get(f"{name}_sha256") for name, path in
           (("clean_cache", clean_cache), ("source_audit", clean_cache.parent / "audit.json"),
            ("panel", panel_path), ("taxonomy", taxonomy_path), ("catalog", catalog_path))},
        "producer": "analysis/model_market_aggregation.py", "producer_sha256": sha256_file(Path(__file__)),
        "baseline_commit": baseline_commit,
        "cache_original_producer_sha256": json.loads((clean_cache.parent / "audit.json").read_text(encoding="utf-8"))["provenance"]["producer_sha256"],
        "scoring_modules": {name: sha256_file(REPOSITORY_ROOT / name) for name in
                            ("analysis/configuration_pair_aggregation.py", "analysis/pair_aggregation.py", "analysis/metrics.py")},
        "market_probability": "valid audited freeze_datetime_value, not later market values",
        "join_key": "date + lowercase Polymarket source + event_id + horizon",
        "processed_raw_files_reread": False,
    }
    verified_cache = input_audit["verified_clean_cache"]
    source_presence = verified_cache["original_source_hashes_verified_when_present"]
    audit = {
        "configuration_count": len(points), "configuration_status_counts": dict(statuses),
        "configuration_target_rows": sum(map(len, panel.values())),
        "available_fold_count_histogram": dict(sorted(fold_histogram.items())),
        "fold_records": fold_count,
        "high_support_configurations": sum(point["views"]["all"]["combined"] is not None
                                           and not point["views"]["all"]["combined"]["small_support"] for point in points),
        "near_bi_configurations": sum(point["views"]["near_bi"]["combined"] is not None for point in points),
        "all_configurations_retain_exact_catalog_identity": True,
        "all_methods_use_identical_model_market_test_support": True,
        "all_fixed_base_scores_equal_matched_market": True,
        "event_disjoint_splits_checked": True, "strict_train_fold_near_bi": True,
        "test_event_outcomes_used_for_training": False,
        "clean_cache_hash_verified": True,
        "source_hashes_verified": all(source_presence.values()),
        "source_files_present": source_presence,
        "catalog_identity_support_and_scores_reconstructed":
            verified_cache["catalog_identity_support_and_scores_reconstructed"],
        "published_configuration_support_checks": len(input_audit["published_configuration_support_checks"]),
        "maximum_catalog_score_difference": max((row["maximum_score_difference"]
                                                  for row in input_audit["published_configuration_support_checks"]), default=0),
        "fold_results": _public_path(fold_path, repository_root), "fold_results_sha256": sha256_file(fold_path),
        "fold_results_bytes": sum(chunk["bytes"] for chunk in writer.files),
    }
    summary = {
        "schema_version": SCHEMA_VERSION, "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "All published exact model configurations with a fixed Polymarket freeze-time base; non-imputed Polymarket market targets only; dataset questions excluded.",
        "market_base": MARKET_BASE,
        "methods": pair.METHODS, "method_order": pair.METHOD_ORDER,
        "metrics": pair.METRICS, "metric_order": pair.METRIC_ORDER,
        "split": {"repetitions": len(seeds), "seeds": seeds, "minimum_fold_overlap": minimum_fold_overlap,
                  "support_warning_threshold": 50, "near_bi_gap": 2.0,
                  "unit": "source + event_id, shared across dates and horizons", "event_disjoint": True},
        "aggregation": {
            "base": "Polymarket is the fixed base; the exact model configuration is the partner",
            "diversity": "train-target weighted fold diagnostics; null if any included fold metric is undefined",
            "brier_score": "within each fold, average squared error within event and then equally across events; combine folds by event count",
            "brier_index": "100 * (1 - sqrt(Brier score)), transformed once after event averaging",
            "loss": "event-equal ordinary Brier score", "gain": "relative reduction in event-equal ordinary Brier score",
            "directional_cf": "fit sign-specific clipped C/D weights on train observations, anchored at Polymarket",
            "best_single": "test-fold hindsight constituent, not deployable",
            "near_bi": "filter individual directions by training model-market BI gap before aggregation",
            "beats_market_bi_tolerance": pair.MARKET_COMPARISON_TOLERANCE,
        },
        "points": points, "audit": audit, "provenance": provenance,
    }
    _write_json(site_output_dir / "summary.json", summary)
    _write_json(output_dir / "audit.json", {**audit, "inputs": input_audit, "provenance": provenance,
                                            "public_summary": _public_path(site_output_dir / "summary.json", repository_root),
                                            "public_summary_sha256": sha256_file(site_output_dir / "summary.json")})
    print(json.dumps({"stage": "complete", **audit}, indent=2), flush=True)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clean-cache", type=Path, default=Path("data/derived/configuration_pair_aggregation/clean_panel.csv.gz"))
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument("--catalog", type=Path, default=Path("site/public/data/polymarket-aggregation/market-diversity-performance.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/derived/model_market_aggregation"))
    parser.add_argument("--site-output-dir", type=Path, default=Path("site/public/data/model-market-aggregation"))
    parser.add_argument("--repository-root", type=Path, default=REPOSITORY_ROOT,
                        help="Repository root used to keep provenance paths relative when executing an isolated source snapshot")
    parser.add_argument("--baseline-commit", help="Commit supplying the imported scoring dependencies")
    parser.add_argument("--metric-definition-refresh", action="store_true",
                        help="Allow a deliberate scoring-code and catalog refresh over the same audited cache")
    args = parser.parse_args()
    run_experiment(args.clean_cache, args.panel, args.taxonomy, args.catalog, args.output_dir, args.site_output_dir,
                   repository_root=args.repository_root, baseline_commit=args.baseline_commit,
                   metric_definition_refresh=args.metric_definition_refresh)


if __name__ == "__main__":
    main()
