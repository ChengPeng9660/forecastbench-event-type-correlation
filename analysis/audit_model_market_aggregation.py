"""Independently recompute every published model-plus-market cross-fit point.

The producer and its scoring helpers are deliberately not imported. Direct
probability-array arithmetic comes from the earlier independent pair auditor;
the market is always the first (fixed anchor) panel and the model is second.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

from analysis.audit_configuration_pair_aggregation import (
    IDENTITY_FIELDS, METHODS, METRICS, SEEDS, Panel, adjusted_losses,
    audit_view_contract, brier_index, compact_support, compare_expected,
    event_mean, file_sha256, mean, read_clean_intermediate, read_json, reference_folds,
    reference_views, selected_support,
)


def check_split_isolation(folds: list[dict[str, Any]], common: set) -> list[str]:
    """Check complete exact-key coverage and group isolation in both directions."""
    errors = []
    for fold in folds:
        train, test = set(fold["train_keys"]), set(fold["test_keys"])
        train_events = {(key[1].casefold(), key[2]) for key in train}
        test_events = {(key[1].casefold(), key[2]) for key in test}
        if train & test or train | test != common or train_events & test_events:
            errors.append(f"{fold['fold_id']}: overlapping/incomplete exact-key or event support")
    return errors


def _score_panel(panel: Panel, keys: list) -> dict[str, float | None]:
    raw = event_mean(keys, [(float(panel[key]["prediction"]) - float(panel[key]["outcome"])) ** 2 for key in keys])
    adjusted = event_mean(keys, adjusted_losses(panel, keys))
    return {"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": brier_index(raw)}


def audit_payload(payload: Mapping[str, Any], panels: Mapping[str, Panel], market: Panel,
                  catalog: Mapping[str, Any], *, expected_configuration_count: int | None = 238,
                  progress: bool = False) -> dict[str, Any]:
    """Full direct-array comparison of identities, support, all methods and views."""
    errors: list[str] = []
    identities = {point["exact_configuration"]: {key: point[key] for key in IDENTITY_FIELDS}
                  for point in catalog["points"]}
    catalog_points = {point["exact_configuration"]: point for point in catalog["points"]}
    points = payload.get("points", [])
    by_name = {point.get("configuration", {}).get("exact_configuration"): point for point in points}
    if len(identities) != len(catalog["points"]) or len(by_name) != len(points):
        errors.append("duplicate catalog or published exact-configuration identity")
    if set(identities) != set(panels) or set(by_name) != set(identities):
        errors.append("catalog, clean cache, and published points are not the same exact-configuration set")
    if expected_configuration_count is not None and len(identities) != expected_configuration_count:
        errors.append(f"expected {expected_configuration_count} exact configurations, got {len(identities)}")
    errors.extend(compare_expected({"schema_version": 2, "method_order": list(METHODS), "metric_order": list(METRICS),
                                    "split": {"repetitions": 10, "seeds": list(SEEDS),
                                              "minimum_fold_overlap": 1, "near_bi_gap": 2}}, payload, "summary"))
    if set(payload.get("methods", {})) != set(METHODS) or set(payload.get("metrics", {})) != set(METRICS):
        errors.append("published method/metric metadata IDs differ from the independent contract")
    results = []
    status_counts: Counter = Counter()
    fold_counts: Counter = Counter()
    near_counts: Counter = Counter()
    null_metrics: Counter = Counter()
    null_bi: Counter = Counter()
    scalar_checks = 0
    for index, name in enumerate(sorted(identities), 1):
        if name not in panels or name not in by_name:
            continue
        before = len(errors)
        actual = by_name[name]
        model = panels[name]
        common = sorted(set(model) & set(market))
        # Independently validate the numeric cache against the existing overview.
        if len(common) != len(model):
            errors.append(f"{name}: model has targets without the matched market")
        errors.extend(compare_expected(identities[name], actual.get("configuration"), f"{name}.configuration"))
        errors.extend(compare_expected(len(common), catalog_points[name]["n_common"], f"catalog.{name}.n_common"))
        for label, panel in (("model", model), ("matched_market", market)):
            errors.extend(compare_expected(_score_panel(panel, common), catalog_points[name][label], f"catalog.{name}.{label}"))
            scalar_checks += 3
        support = compact_support(market, model, market)
        errors.extend(compare_expected({key: support[key] for key in ("status", "n_common", "unique_event_count", "support_sha256")},
                                       actual, f"{name}.support"))
        folds = reference_folds(market, model, market)
        errors.extend(check_split_isolation(folds, set(common)))
        expected_views = reference_views(folds)
        errors.extend(compare_expected(expected_views, actual.get("views"), f"{name}.views"))
        for sample in ("all", "near_bi"):
            for direction in ("combined", "a_to_b", "b_to_a"):
                path = f"{name}.{sample}.{direction}"
                selected = selected_support(support["folds"], sample, direction)
                view = actual.get("views", {}).get(sample, {}).get(direction)
                errors.extend(audit_view_contract(view, selected, path))
                if view is None:
                    continue
                # These equality checks detect a reversed anchor even when all
                # symmetric fixed pools happen to give the same forecasts.
                errors.extend(compare_expected(view["market"], view["base"], path + ".base_is_market"))
                for method, score in view["methods"].items():
                    errors.extend(compare_expected(score["gain_vs_market"], score["gain_vs_base"],
                                                   path + f".{method}.base_gain_is_market_gain"))
                for metric, value in view["train_diversity"].items():
                    if value is None:
                        null_metrics[metric] += 1
                for method, score in view["methods"].items():
                    if score["brier_index"] is None:
                        null_bi[method] += 1
        combined = expected_views["all"]["combined"]
        near_fold_count = sum(fold["train_near_bi"] for fold in folds)
        status_counts[support["status"]] += 1
        fold_counts[len(folds)] += 1
        near_counts[near_fold_count] += 1
        results.append({"configuration": name, "provider": identities[name]["provider"],
                        "prompt_type": identities[name]["prompt_type"], "information_type": identities[name]["information_type"],
                        "n_common": len(common), "unique_event_count": support["unique_event_count"],
                        "support_sha256": support["support_sha256"], "fold_count": len(folds),
                        "near_bi_fold_count": near_fold_count,
                        "min_train_rows": min((len(fold["train_keys"]) for fold in folds), default=0),
                        "min_test_rows": min((len(fold["test_keys"]) for fold in folds), default=0),
                        "high_support": bool(combined and not combined["small_support"]),
                        "full_sample_tv": mean([abs(float(model[key]["prediction"]) - float(market[key]["prediction"])) for key in common]),
                        "combined_train_diversity": combined["train_diversity"] if combined else None,
                        "combined_market_bi": combined["market"]["brier_index"] if combined else None,
                        "combined_model_bi": combined["partner"]["brier_index"] if combined else None,
                        "combined_method_bi": {method: value["brier_index"] for method, value in combined["methods"].items()} if combined else {},
                        "passed": len(errors) == before})
        if progress and index % 40 == 0:
            print(json.dumps({"stage": "independent_direct_arrays", "configurations": index, "errors": len(errors)}), flush=True)
    return {"passed": not errors, "audit": "Exhaustive independent direct-array model-plus-market cross-fit recomputation",
            "configuration_count": len(identities), "recomputed_configurations": len(results),
            "configuration_target_rows": sum(map(len, panels.values())), "unique_market_target_rows": len(market),
            "independently_recomputed_fold_records": sum(row["fold_count"] for row in results),
            "catalog_score_scalar_checks": scalar_checks, "status_counts": dict(status_counts),
            "high_support_configurations": sum(row["high_support"] for row in results),
            "near_bi_configurations": sum(row["near_bi_fold_count"] > 0 for row in results),
            "fold_count_histogram": dict(sorted(fold_counts.items())), "near_bi_fold_count_histogram": dict(sorted(near_counts.items())),
            "null_train_metric_views": dict(null_metrics), "null_method_bi_views": dict(null_bi),
            "configuration_results": results, "errors": errors,
            "checks": ["All exact configuration identities match the existing catalog and cleaned cache",
                       "Market is fixed base; model is partner, including the Directional CF fit",
                       "Exact date/source/event/horizon support shared by model, market and aggregate",
                       "Ten source/event-grouped seeds, both train-to-test directions, no event leakage",
                       "All train X values and all opposite-fold method scores independently recomputed",
                       "Training-target weighted X diagnostics; event-equal Brier and BI; ordinary-Brier gains",
                       "Near-BI selected by each individual training direction before aggregation",
                       "Undefined fold metrics and BI remain null in combined views"],
            "limitations": ["The audited numeric input is the previously provenance-cleaned cache; original provider JSON and freeze snapshots are not re-read.",
                            "Random event-grouped splits are not prospective temporal holdouts; repeated folds are not independent new events.",
                            "Model configurations that saw market freeze probabilities are information-exposed comparisons, not independent forecasters.",
                            "Best Single chooses a constituent using test outcomes and is a hindsight benchmark."]}


def audit_artifacts(summary_path: Path, clean_path: Path, catalog_path: Path, *, progress: bool = False,
                    expected_configuration_count: int | None = 238, derived_path: Path | None = None) -> dict[str, Any]:
    payload = read_json(summary_path)
    panels, market = read_clean_intermediate(clean_path)
    report = audit_payload(payload, panels, market, read_json(catalog_path), progress=progress,
                           expected_configuration_count=expected_configuration_count)
    report.update(auditor_sha256=file_sha256(Path(__file__)),
                  independent_primitives_sha256=file_sha256(Path(__file__).with_name("audit_configuration_pair_aggregation.py")),
                  summary_sha256=file_sha256(summary_path), clean_intermediate_sha256=file_sha256(clean_path),
                  catalog_sha256=file_sha256(catalog_path))
    producer = Path(__file__).with_name("model_market_aggregation.py")
    if producer.exists():
        report["producer_sha256"] = file_sha256(producer)
    provenance = payload.get("provenance", {})
    for field, key in (("catalog_sha256", "catalog_sha256"), ("clean_intermediate_sha256", "clean_intermediate_sha256"),
                       ("clean_cache_sha256", "clean_intermediate_sha256"),
                       ("producer_sha256", "producer_sha256")):
        if field in provenance and provenance[field] != report.get(key):
            report["errors"].append(f"summary.provenance.{field}: source checksum mismatch")
    report["producer_scoring_module_sha256"] = provenance.get("scoring_modules", {})
    if derived_path is not None:
        report["fold_artifacts"] = audit_fold_artifacts(derived_path, panels, market)
        report["errors"].extend(report["fold_artifacts"]["errors"])
        recorded_hash = payload.get("audit", {}).get("fold_results_sha256")
        if recorded_hash != file_sha256(derived_path / "fold-results-manifest.json"):
            report["errors"].append("summary.audit.fold_results_sha256: diagnostic archive checksum mismatch")
    report["passed"] = not report["errors"]
    return report


def audit_fold_artifacts(derived: Path, panels: Mapping[str, Panel], market: Panel) -> dict[str, Any]:
    """Check every stored fold and market-anchor weight against direct arrays."""
    manifest = read_json(derived / "fold-results-manifest.json")
    errors = compare_expected({"schema_version": 2, "market_base": "Polymarket Freeze"}, manifest, "fold_manifest")
    seen: dict[str, set[str]] = {}
    expected_ids: dict[str, set[str]] = {}
    current_name = None
    references = {}
    total = 0
    for chunk in manifest["files"]:
        path = derived / chunk["file"]
        if not path.resolve().is_relative_to(derived.resolve()):
            raise ValueError("fold path escapes the experiment output directory")
        errors.extend(compare_expected({"sha256": file_sha256(path), "bytes": path.stat().st_size}, chunk, chunk["file"]))
        count = 0
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                count += 1
                actual = json.loads(line)
                name, fold_id = actual["second_configuration"], actual["fold_id"]
                if name not in panels:
                    errors.append(f"{name}: unknown diagnostic configuration")
                    continue
                if name != current_name:
                    current_name = name
                    references = {row["fold_id"]: row for row in reference_folds(market, panels[name], market)}
                    expected_ids[name] = set(references)
                if fold_id in seen.setdefault(name, set()):
                    errors.append(f"{name}.{fold_id}: duplicate diagnostic record")
                seen[name].add(fold_id)
                if fold_id not in references:
                    errors.append(f"{name}.{fold_id}: unknown diagnostic split")
                    continue
                reference = references[fold_id]
                expected = {field: reference[field] for field in ("fold_id", "seed", "train_fold", "test_fold",
                                                                   "train_bi_gap", "train_near_bi", "train_diversity",
                                                                   "n_train_events", "n_test_events")}
                expected.update(first_configuration="Polymarket Freeze", second_configuration=name,
                                n_train=len(reference["train_keys"]), n_test=len(reference["test_keys"]),
                                first=reference["base"], second=reference["partner"], market=reference["market"],
                                cf_first=reference["methods"]["cf_directional"],
                                weights_first={"upward_alpha": reference["weights"][0], "downward_alpha": reference["weights"][1]},
                                methods={method: score for method, score in reference["methods"].items() if method != "cf_directional"})
                errors.extend(compare_expected(expected, actual, f"diagnostic.{name}.{fold_id}"))
        errors.extend(compare_expected(count, chunk["row_count"], chunk["file"] + ".row_count"))
        total += count
    for name in panels:
        if name not in expected_ids:
            expected_ids[name] = {row["fold_id"] for row in reference_folds(market, panels[name], market)}
        if seen.get(name, set()) != expected_ids[name]:
            errors.append(f"{name}: incomplete or extra diagnostic fold coverage")
    errors.extend(compare_expected(total, manifest["row_count"], "fold_manifest.row_count"))
    return {"passed": not errors, "rows_independently_recomputed": total, "configurations": len(seen),
            "archive_files": len(manifest["files"]), "manifest_sha256": file_sha256(derived / "fold-results-manifest.json"),
            "errors": errors}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=Path("site/public/data/model-market-aggregation/summary.json"))
    parser.add_argument("--clean", type=Path, default=Path("data/derived/configuration_pair_aggregation/clean_panel.csv.gz"))
    parser.add_argument("--catalog", type=Path, default=Path("site/public/data/polymarket-aggregation/market-diversity-performance.json"))
    parser.add_argument("--derived", type=Path, default=Path("data/derived/model_market_aggregation"))
    parser.add_argument("--output", type=Path, default=Path("data/derived/model_market_aggregation_audit/report.json"))
    args = parser.parse_args()
    report = audit_artifacts(args.summary, args.clean, args.catalog, progress=True, derived_path=args.derived)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("configuration_results", "checks", "limitations")},
                     ensure_ascii=False), flush=True)
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
