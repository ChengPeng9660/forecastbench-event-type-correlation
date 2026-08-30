"""Independently verify a diagnostics-only refresh against immutable Git inputs.

No experiment producer, refresh builder, or shared scoring helper is imported.
Existing scores, support, folds, identities, and non-high-loss summaries must be
bit-for-bit equal as JSON scalars. A high-loss coordinate can only become null
when its attached diagnostics explicitly record undefined included directions.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any


COORDINATE_CONTAINERS = {"diversity", "train_diversity", "mean_train_diversity", "metrics"}
HIGH_LOSS = {"high_loss_lift", "high_loss_diversity"}
SUMMARY_VALUES = {"defined_pair_count", "pearson", "spearman", "near_bi_pearson"}


def checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def same_scalar(first: Any, second: Any) -> bool:
    return (type(first) is type(second) and first == second
            and (not isinstance(first, float) or first.hex() == second.hex()))


def validate_diagnostics(value: Any, owner: dict[str, Any]) -> None:
    if not isinstance(value, dict) or value.get("threshold") != 0.25:
        raise ValueError("invalid high-loss diagnostic threshold or object")
    if "included_fold_count" in value:
        total, defined, missing = (value.get(key) for key in
                                   ("included_fold_count", "defined_fold_count", "undefined_fold_count"))
        if any(type(n) is not int or n < 0 for n in (total, defined, missing)) or not total or defined + missing != total:
            raise ValueError("high-loss fold coverage is inconsistent")
        reasons = value.get("reason_counts")
        if not isinstance(reasons, dict) or any(type(n) is not int or n <= 0 for n in reasons.values()) or sum(reasons.values()) != missing:
            raise ValueError("high-loss reason counts do not account for undefined folds")
        if owner.get("fold_count", owner.get("evaluation_count", total)) != total:
            raise ValueError("high-loss diagnostics do not cover the displayed directions")
        train, valid = value.get("train_target_cells"), value.get("valid_train_target_cells")
        if type(train) is not int or type(valid) is not int or not 0 <= valid <= train:
            raise ValueError("invalid high-loss training support")
        if (missing == 0) != (valid == train):
            raise ValueError("defined high-loss training support disagrees with missing folds")
        if value.get("reason", "") != ("one_or_more_included_fold_lifts_undefined" if missing else ""):
            raise ValueError("high-loss missing-fold reason is inconsistent")
    if "high_count_a" in value or "high_count_b" in value:
        a, b, joint = (value.get(key) for key in ("high_count_a", "high_count_b", "joint_high_count"))
        n = value.get("n_targets", value.get("train_target_cells"))
        if any(type(k) is not int or k < 0 for k in (a, b, joint, n)) or not n or not 0 <= joint <= min(a, b) <= max(a, b) <= n:
            raise ValueError("invalid marginal/joint high-loss counts")
        expected = value.get("expected_joint_count")
        if not isinstance(expected, (float, int)) or not math.isfinite(expected) or expected < 0:
            raise ValueError("invalid expected joint high-loss count")
        if "n_targets" in value and not math.isclose(expected, a * b / n, rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError("whole-sample expected joint count disagrees with marginals")


def compare_payload(before: Any, after: Any) -> dict[str, int]:
    counts = {"preserved_scalars": 0, "diagnostic_objects": 0, "coordinates_changed_to_null": 0,
              "derived_high_loss_summary_fields_changed": 0}

    def visit(old: Any, new: Any, path: tuple[str, ...], diagnostic: dict[str, Any] | None = None) -> None:
        location = ".".join(path) or "root"
        is_coordinate = len(path) >= 2 and path[-2] in COORDINATE_CONTAINERS and path[-1] in HIGH_LOSS
        if is_coordinate and (not isinstance(old, dict) or "complementarity" in old):
            previous = old.get("complementarity") if isinstance(old, dict) else old
            current = new.get("complementarity") if isinstance(new, dict) else new
            repaired = not same_scalar(previous, current)
            if repaired:
                if not (type(previous) in (int, float) and math.isfinite(previous) and current is None
                        and diagnostic and diagnostic.get("undefined_fold_count", 0) > 0):
                    raise ValueError(f"{location}: high-loss coordinate changed without an undefined-fold null repair")
                counts["coordinates_changed_to_null"] += 1
            if diagnostic and diagnostic.get("undefined_fold_count", 0) and current is not None:
                raise ValueError(f"{location}: partial-direction coordinate remains numeric")
            if isinstance(old, dict):
                added_reason = current is None and diagnostic and diagnostic.get("undefined_fold_count", 0)
                allowed_added = {"reason"} if added_reason else set()
                if not isinstance(new, dict) or set(old) - set(new) or set(new) - set(old) - allowed_added:
                    raise ValueError(f"{location}: metric object fields changed")
                if "reason" not in old and "reason" in new and new["reason"] != diagnostic["reason"]:
                    raise ValueError(f"{location}: new missing reason does not match diagnostics")
                for key in old:
                    if repaired and key in {"raw", "complementarity"}:
                        if new[key] is not None:
                            raise ValueError(f"{location}.{key}: inconsistent null repair")
                    elif current is None and diagnostic and diagnostic.get("undefined_fold_count", 0) and key == "reason":
                        if new[key] != diagnostic["reason"]:
                            raise ValueError(f"{location}: missing reason does not match diagnostics")
                    else:
                        visit(old[key], new[key], (*path, key), diagnostic)
            elif not repaired:
                counts["preserved_scalars"] += 1
            return
        if isinstance(old, dict):
            if not isinstance(new, dict) or set(old) - set(new) or set(new) - set(old) - {"high_loss_diagnostics"}:
                raise ValueError(f"{location}: object fields changed outside appended diagnostics")
            if "high_loss_diagnostics" in new:
                diagnostic = new["high_loss_diagnostics"]
                validate_diagnostics(diagnostic, new)
                counts["diagnostic_objects"] += 1
            summary = path[:2] == ("evaluation", "focal_correlation_summary") and old.get("metric") == "high_loss_lift"
            for key, value in old.items():
                if summary and key in SUMMARY_VALUES:
                    counts["derived_high_loss_summary_fields_changed"] += not same_scalar(value, new[key])
                else:
                    visit(value, new[key], (*path, key), diagnostic)
            return
        if isinstance(old, list):
            if not isinstance(new, list) or len(old) != len(new):
                raise ValueError(f"{location}: array membership changed")
            for index, (first, second) in enumerate(zip(old, new)):
                visit(first, second, (*path, str(index)), diagnostic)
            return
        if not same_scalar(old, new):
            raise ValueError(f"{location}: protected scalar changed from {old!r} to {new!r}")
        counts["preserved_scalars"] += 1

    visit(before, after, ())
    return counts


def _pearson(first: list[float], second: list[float]) -> float | None:
    if len(first) < 3:
        return None
    a, b = math.fsum(first) / len(first), math.fsum(second) / len(second)
    x, y = [v - a for v in first], [v - b for v in second]
    scale = math.sqrt(math.fsum(v * v for v in x) * math.fsum(v * v for v in y))
    return math.fsum(a * b for a, b in zip(x, y)) / scale if scale else None


def _ranks(values: list[float]) -> list[float]:
    return [1 + sum(other < value for other in values) + (sum(other == value for other in values) - 1) / 2 for value in values]


def validate_high_loss_summaries(payload: dict[str, Any]) -> int:
    checked = 0
    for row in payload.get("evaluation", {}).get("focal_correlation_summary", []):
        if row["metric"] != "high_loss_lift":
            continue
        points = [point for point in payload["points"] if point["base_model"] == row["base_model"]]
        def association(subset, rank=False):
            pairs = [(p["combined"]["train_diversity"]["high_loss_lift"], p["combined"]["aggregation"][row["method"]]["gain_vs_base"]) for p in subset]
            pairs = [(x, y) for x, y in pairs if x is not None and y is not None and math.isfinite(x) and math.isfinite(y)]
            x, y = [a for a, _ in pairs], [b for _, b in pairs]
            return len(pairs), _pearson(_ranks(x) if rank else x, _ranks(y) if rank else y)
        n, r = association(points)
        expected = {"defined_pair_count": n, "pearson": r, "spearman": association(points, True)[1],
                    "near_bi_pearson": association([p for p in points if p["combined"]["near_bi"]])[1]}
        for key, value in expected.items():
            actual = row[key]
            valid_type = actual is None or type(actual) in (int, float)
            if (not valid_type or (key == "defined_pair_count" and type(actual) is not int)
                    or (value is None) != (actual is None)
                    or value is not None and not math.isclose(value, actual, rel_tol=1e-10, abs_tol=1e-10)):
                raise ValueError(f"high-loss summary {row['base_model']}/{row['method']}/{key} does not match refreshed coordinates")
        checked += 1
    return checked


def verify_market_null_sources(repo: Path, site_data: Path, clean_path: Path, covered: set[str]) -> dict[str, int]:
    """Ground every repaired legacy view in saved folds or immutable selection IDs.

    Only adjusted-loss indicators are rebuilt; no pool prediction, fitted weight,
    score, or selection rule is re-estimated.
    """
    relevant = {"polymarket-aggregation/freeze-exposed-correlation.json", "polymarket-aggregation/without-freeze-base.json",
                "pair-aggregation/upper-left-model-pairs.json", "polymarket-aggregation/freeze-baseline.json"} & covered
    if not relevant:
        return {"checked_views": 0, "undefined_views": 0, "saved_fold_files_checked": 0}
    panels: dict[str, dict[tuple[str, ...], float]] = {"Polymarket Freeze": {}}
    with gzip.open(clean_path, "rt", newline="") as handle:
        for row in csv.DictReader(handle):
            key = tuple(row[field] for field in ("date", "source", "event_id", "horizon"))
            y, effect, norm = (float(row[field]) for field in ("outcome", "question_fixed_effect", "normalization_term"))
            panels.setdefault(row["exact_configuration"], {})[key] = (float(row["prediction"]) - y) ** 2 - effect + norm
            panels["Polymarket Freeze"][key] = (float(row["market_prediction"]) - y) ** 2 - effect + norm
    canonical = {}
    fixed = json.loads((site_data / "pair-aggregation/fixed-focal-without-freeze.json").read_text())
    for name, configurations in fixed["audit"]["model_configurations"].items():
        if len(configurations) == 1:
            canonical[name] = f"{name} ({configurations[0]})" if configurations[0] else name
    cached = {}
    def clean_records(first, second):
        key = (first, second)
        if key in cached:
            return cached[key]
        a, b = panels[first], panels[second]
        common = sorted(a.keys() & b.keys())
        result = []
        for repetition, seed in enumerate(range(20260825, 20260835), 1):
            for train, test in (("A", "B"), ("B", "A")):
                chosen = [k for k in common if ("A" if int.from_bytes(hashlib.sha256(f"{seed}|{k[1].casefold()}|{k[2]}".encode()).digest()[:8], "big") % 2 == 0 else "B") == train]
                if not chosen or len(chosen) == len(common):
                    continue
                n = len(chosen)
                na, nb = sum(a[k] > .25 for k in chosen), sum(b[k] > .25 for k in chosen)
                joint = sum(a[k] > .25 and b[k] > .25 for k in chosen)
                result.append({"fold_id": f"split_{repetition:02d}_seed_{seed}__{train}_train__{test}_test",
                               "seed": seed, "train_fold": train, "n_train": n, "n_test": len(common) - n,
                               "value": 1 - joint * n / (na * nb) if na and nb else None,
                               "a": na, "b": nb, "joint": joint, "expected": na * nb / n})
        cached[key] = result
        return result
    result = {"checked_views": 0, "undefined_views": 0, "saved_fold_files_checked": 0}
    def check(owner, coordinate, records, equal=False):
        diagnostic = owner["high_loss_diagnostics"]
        defined = [r for r in records if r["value"] is not None]
        expected = {"included_fold_count": len(records), "defined_fold_count": len(defined),
                    "undefined_fold_count": len(records) - len(defined), "train_target_cells": sum(r["n_train"] for r in records),
                    "valid_train_target_cells": sum(r["n_train"] for r in defined)}
        if any(diagnostic[key] != value for key, value in expected.items()):
            raise ValueError("published high-loss coverage differs from independent saved/clean folds")
        if expected["undefined_fold_count"]:
            if coordinate is not None:
                raise ValueError("undefined independent fold still has a numeric coordinate")
            result["undefined_views"] += 1
        else:
            weights = [1 if equal else r["n_train"] for r in records]
            expected_x = math.fsum(r["value"] * w for r, w in zip(records, weights)) / sum(weights)
            if coordinate is None or not math.isclose(coordinate, expected_x, rel_tol=1e-11, abs_tol=1e-12):
                raise ValueError("published high-loss coordinate differs from independent fold ratio mean")
        if records and all("a" in row for row in records):
            counts = {"high_count_a": sum(r["a"] for r in records), "high_count_b": sum(r["b"] for r in records),
                      "joint_high_count": sum(r["joint"] for r in records), "expected_joint_count": math.fsum(r["expected"] for r in records),
                      "min_high_count_a": min(r["a"] for r in records), "min_high_count_b": min(r["b"] for r in records),
                      "min_joint_high_count": min(r["joint"] for r in records)}
            if any(not math.isclose(diagnostic[key], value, rel_tol=1e-12, abs_tol=1e-12) for key, value in counts.items()):
                raise ValueError("published marginal/joint counts differ from independent clean-cache indicators")
        result["checked_views"] += 1
    for relative in sorted(relevant):
        payload = json.loads((site_data / relative).read_text())
        if relative in {"polymarket-aggregation/freeze-exposed-correlation.json", "polymarket-aggregation/without-freeze-base.json"}:
            provenance = payload["provenance"]
            path = (repo / provenance["fold_results"]).resolve()
            if not path.is_relative_to(repo) or file_checksum(path) != provenance["fold_results_sha256"]:
                raise ValueError("original saved market fold checksum mismatch")
            groups = {}
            with gzip.open(path, "rt", newline="") as handle:
                for row in csv.DictReader(handle):
                    if row["method"] == "anchor":
                        groups.setdefault((row["model_a"], row["model_b"]), []).append({
                            "train_fold": row["train_fold"], "n_train": int(row["n_train"]),
                            "value": None if row["train_high_loss_lift_complementarity"] == "" else float(row["train_high_loss_lift_complementarity"])})
            result["saved_fold_files_checked"] += 1
            for point in payload["points"]:
                combined = point.get("combined", point)
                names = (("Polymarket Freeze", point["exact_configuration"]) if "exact_configuration" in point
                         else (combined["base_name"], combined["partner_name"]))
                records = groups[names]
                check(combined, combined["train_diversity"]["high_loss_lift"], records)
                for direction, view in point["directions"].items():
                    check(view, view["train_diversity"]["high_loss_lift"], [r for r in records if r["train_fold"] == ("A" if direction == "a_to_b" else "B")])
        elif relative == "pair-aggregation/upper-left-model-pairs.json":
            for row in payload["crossfit"]["rows"]:
                selected = {(selection["seed"], selection["train_fold"]) for selection in payload["crossfit"]["selection_runs"]
                            if row["model_a"] in selection["selected_models"] and row["model_b"] in selection["selected_models"]}
                records = [r for r in clean_records(row["model_a"], row["model_b"])
                           if (r["seed"], r["train_fold"]) in selected and min(r["n_train"], r["n_test"]) >= payload["audit"]["minimum_pair_fold_overlap"]]
                check(row, row["mean_train_diversity"]["high_loss_diversity"], records, equal=True)
        else:
            cross = payload["cross_fit"]
            lists = [cross["eligible_points"], cross["near_bi_points"]]
            for directional in cross["directional_points"].values():
                lists.extend([directional["eligible_points"], directional["near_bi_points"]])
            for points in lists:
                for point in points:
                    ids = set(point["cross_fit"]["fold_ids"])
                    records = [r for r in clean_records(point["model_a"], canonical[point["model_b"]]) if r["fold_id"] in ids]
                    check(point, point["metrics"]["high_loss_lift"]["complementarity"], records)
    return result


def audit_refresh(repo: Path, site_data: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    repo, site_data = repo.resolve(), site_data.resolve()
    provenance = manifest["provenance"]
    refresh = provenance["diagnostics_refresh"]
    if refresh.get("kind") != "high_loss_diagnostics_only":
        raise ValueError("unsupported diagnostics refresh kind")
    baseline = refresh["baseline_ref"]
    if not re.fullmatch(r"[0-9a-f]{40}", baseline):
        raise ValueError("diagnostics refresh baseline must be an immutable full Git commit")
    def located(relative):
        path = (repo / relative).resolve()
        if not path.is_relative_to(repo):
            raise ValueError("diagnostics provenance path leaves repository")
        return path
    def original(path):
        relative = path.resolve().relative_to(repo).as_posix()
        return subprocess.check_output(["git", "-C", str(repo), "show", f"{baseline}:{relative}"])
    report_path, script_path = located(refresh["audit_report"]), located(refresh["refresh_script"])
    if file_checksum(report_path) != refresh["audit_report_sha256"] or file_checksum(script_path) != refresh["refresh_script_sha256"]:
        raise ValueError("refresh report/script checksum mismatch")
    report = json.loads(report_path.read_text())
    resolved_report_baseline = subprocess.check_output(["git", "-C", str(repo), "rev-parse", f"{report['baseline_ref']}^{{commit}}"], text=True).strip()
    if resolved_report_baseline != baseline or report["script_sha256"] != refresh["refresh_script_sha256"]:
        raise ValueError("refresh report baseline/script does not match provenance")
    clean = located(manifest["audit"]["clean_intermediate"])
    if len({file_checksum(clean), refresh["clean_intermediate_sha256"], report["clean_cache_sha256"], manifest["audit"]["clean_intermediate_sha256"]}) != 1:
        raise ValueError("refresh clean-cache checksum mismatch")
    producer = located("analysis/configuration_pair_aggregation.py")
    if (checksum(original(producer)) != provenance["producer_sha256"]
            or refresh["aggregation_producer_sha256"] != provenance["producer_sha256"]
            or file_checksum(producer) != refresh["current_producer_sha256"]):
        raise ValueError("original/current aggregation producer checksum mismatch")
    original_manifest = json.loads(original(site_data / "configuration-pair-aggregation/manifest.json"))
    without_refresh = {**manifest, "provenance": {key: value for key, value in provenance.items() if key != "diagnostics_refresh"}}
    try:
        compare_payload(original_manifest, without_refresh)
    except ValueError as error:
        raise ValueError("aggregation manifest changed outside appended diagnostics provenance") from error
    catalog = located(provenance["catalog"])
    if (checksum(original(catalog)) != provenance["catalog_sha256"]
            or refresh["original_catalog_sha256"] != provenance["catalog_sha256"]
            or refresh["current_catalog_sha256"] != file_checksum(catalog)):
        raise ValueError("original/current catalog checksum mismatch")
    if report.get("scores_or_weights_refit") is not False or report.get("non_high_loss_changes") != 0:
        raise ValueError("refresh report does not assert a diagnostics-only update")
    rows, errors, files = report["files"], [], []
    seen = set()
    for entry in rows:
        relative = entry["file"]
        path = (site_data / relative).resolve()
        if not path.is_relative_to(site_data) or not relative.endswith(".json") or relative in seen:
            raise ValueError("invalid/duplicate diagnostics report payload path")
        seen.add(relative)
        old_bytes, new_bytes = original(path), path.read_bytes()
        if checksum(old_bytes) != entry["before_sha256"] or checksum(new_bytes) != entry["after_sha256"]:
            raise ValueError(f"{relative}: before/after payload checksum mismatch")
        old, new = json.loads(old_bytes), json.loads(new_bytes)
        try:
            counts = compare_payload(old, new)
            counts["high_loss_summaries_recomputed"] = validate_high_loss_summaries(new)
            files.append({"file": relative, "before_sha256": entry["before_sha256"], "after_sha256": entry["after_sha256"], **counts})
        except ValueError as error:
            errors.append(f"{relative}: {error}")
    expected_files = {f"configuration-pair-aggregation/{entry['file']}" for entry in manifest["configurations"]}
    if not expected_files <= seen or len(rows) != report["file_count"]:
        errors.append("refresh report does not cover every configuration shard exactly once")
    changed = subprocess.check_output(["git", "-C", str(repo), "diff", "--name-only", "--no-renames", baseline, "--", str(site_data)], text=True).splitlines()
    baseline_paths = set(subprocess.check_output(["git", "-C", str(repo), "ls-tree", "-r", "--name-only", baseline, "--", str(site_data)], text=True).splitlines())
    unaccounted = [path for path in changed if path in baseline_paths and path.endswith(".json")
                   and (repo / path).relative_to(site_data).as_posix() not in seen | {"configuration-pair-aggregation/manifest.json"}]
    if unaccounted:
        errors.append(f"pre-existing JSON changed outside refresh report: {unaccounted}")
    source_checks = verify_market_null_sources(repo, site_data, clean, seen)
    return {"passed": not errors, "baseline_ref": baseline, "audit_report_sha256": refresh["audit_report_sha256"],
            "file_count": len(files), "files": files, "errors": errors,
            "preserved_scalars": sum(row["preserved_scalars"] for row in files),
            "coordinates_changed_to_null": sum(row["coordinates_changed_to_null"] for row in files),
            "independent_market_fold_sources": source_checks,
            "limitations": ["Every changed legacy market coordinate is grounded in original checksummed folds or clean-cache counts on unchanged published selections; aggregation forecasts and weights are not refit.",
                            "Raw clean-cache source provenance remains the original experiment's responsibility."]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-data", type=Path, default=Path("site/public/data"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.site_data / "configuration-pair-aggregation/manifest.json").read_text())
    result = audit_refresh(Path(__file__).resolve().parents[1], args.site_data, manifest)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "files"}, indent=2))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
