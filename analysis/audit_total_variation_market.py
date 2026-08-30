"""Audit additive TV fields against a pre-upgrade copy of site/public/data.

This is a lightweight artifact audit, not an experiment generator. It checks
old values, complete TV coverage, and fold-to-pair/direction TV aggregation.
The optional derived baseline must be the old freeze experiment summary JSON.

Run from the repository root, for example::

    python -m analysis.audit_total_variation_market --baseline-site-data /path/to/site-data-before
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


FILES = (
    "polymarket-aggregation/freeze-exposed-correlation.json",
    "polymarket-aggregation/without-freeze-base.json",
    "polymarket-aggregation/freeze-baseline.json",
    "polymarket-aggregation/market-diversity-performance.json",
    "pair-aggregation/upper-left-model-pairs.json",
)
LABEL = "Total variation (TV)"
TOLERANCE = 1e-12
# Derived-output digests change when TV columns are added. Raw input hashes
# intentionally are NOT exempt from comparison.
ALLOWED_CHANGED_FIELDS = {
    "generated_at", "fold_results_sha256", "pair_results_sha256", "summary_sha256",
}
TV_FIELDS = {
    "total_variation", "macro_total_variation", "support_weighted_total_variation",
    "train_total_variation_complementarity", "diversity_total_variation",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def close(first: Any, second: Any) -> bool:
    return (isinstance(first, (int, float)) and not isinstance(first, bool)
            and isinstance(second, (int, float)) and not isinstance(second, bool)
            and math.isclose(first, second, rel_tol=TOLERANCE, abs_tol=TOLERANCE))


def differences(before: Any, after: Any, path: str = "") -> list[str]:
    """Reject old-field changes/removal and unexpected non-TV additions."""
    if path.rsplit(".", 1)[-1] in ALLOWED_CHANGED_FIELDS:
        return []
    if isinstance(before, dict):
        if not isinstance(after, dict):
            return [f"{path}: dictionary type changed"]
        errors = []
        for key, value in before.items():
            child = f"{path}.{key}" if path else key
            errors.extend([f"{child}: old field removed"] if key not in after
                          else differences(value, after[key], child))
        for key in after.keys() - before.keys():
            if key not in TV_FIELDS and not (
                key == "diversity_metrics" and isinstance(after[key], dict)
                and set(after[key]) == {"total_variation"}
            ):
                errors.append(f"{path}.{key}: unexpected non-TV addition")
        return errors
    if isinstance(before, list):
        if not isinstance(after, list) or len(before) != len(after):
            return [f"{path}: list type/cardinality changed"]
        return [error for index, (a, b) in enumerate(zip(before, after))
                for error in differences(a, b, f"{path}[{index}]")]
    if isinstance(before, (float, int)) and not isinstance(before, bool):
        return [] if close(before, after) else [f"{path}: {before!r} -> {after!r}"]
    return [] if type(before) is type(after) and before == after else [f"{path}: {before!r} -> {after!r}"]


def tv_contract(payload: dict[str, Any], relative: str) -> dict[str, Any]:
    """Require TV on every applicable record, not merely one valid point."""
    values: list[float] = []
    errors: list[str] = []

    def required(container: Any, field: str, path: str) -> None:
        if not isinstance(container, dict):
            errors.append(f"{path}: missing/non-dictionary metric container")
            return
        value = container.get(field)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not 0 <= value <= 1):
            errors.append(f"{path}.{field}: missing/non-numeric/out-of-range TV")
        else:
            values.append(float(value))

    def walk(node: Any, path: str = "") -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                child = f"{path}.{key}" if path else key
                if key in {"train_diversity", "mean_train_diversity", "diversity"}:
                    required(value, "total_variation", child)
                if (key == "metrics" and isinstance(value, dict)
                        and isinstance(value.get("adjusted_pog"), dict)
                        and "raw" in value["adjusted_pog"]):
                    tv = value.get("total_variation", {})
                    required(tv, "raw", child + ".total_variation")
                    required(tv, "complementarity", child + ".total_variation")
                    # Single-support metrics have a reason field. Aggregated
                    # cross-fit metrics intentionally contain only raw/value.
                    if (not isinstance(tv, dict) or tv.get("reason", "") != ""
                            or not close(tv.get("raw"), tv.get("complementarity"))):
                        errors.append(f"{child}: TV orientation/reason mismatch")
                walk(value, child)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")

    walk(payload)
    if relative.endswith("freeze-exposed-correlation.json"):
        metadata = payload["aggregation"]["diversity_metrics"]
        for index, point in enumerate(payload["points"]):
            required(point, "total_variation", f"points[{index}]")
            if not close(point.get("total_variation"), point["mean_absolute_difference"]):
                errors.append(f"points[{index}]: TV does not equal same-support MAD")
    elif relative.endswith("without-freeze-base.json"):
        metadata = payload["evaluation"]["diversity_metrics"]
    elif relative.endswith("freeze-baseline.json"):
        metadata = payload["diversity_metrics"]
    else:
        metadata = payload["metrics"]
    if metadata.get("total_variation", {}).get("label") != LABEL:
        errors.append("TV metadata label missing or inconsistent")
    if metadata.get("total_variation", {}).get("range") != [0.0, 1.0]:
        errors.append("TV metadata range must be [0, 1]")
    if not values:
        errors.append("No numeric TV records found")
    if relative.endswith("market-diversity-performance.json") and len(metadata) != 5:
        errors.append("Market-performance must expose five diversity metrics")
    return {"passed": not errors, "numeric_values": len(values),
            "minimum": min(values) if values else None, "maximum": max(values) if values else None,
            "errors": errors}


def csv_rows(path: Path) -> list[dict[str, str]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def audit_fold_tv(derived_root: Path, payloads: dict[str, Any]) -> list[dict[str, Any]]:
    reports = []
    for prefix, public_name in (
        ("", FILES[0]), ("without_freeze_base_", FILES[1]),
    ):
        folder = derived_root / "freeze_exposed_market_aggregation"
        folds = csv_rows(folder / f"{prefix}fold_method_results.csv.gz")
        pairs = csv_rows(folder / f"{prefix}pair_method_results.csv")
        grouped: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
        errors = []
        for row in folds:
            grouped[(row["model_b"], row["method"])].append(row)
            value = float(row["train_total_variation_complementarity"])
            if not math.isfinite(value) or not 0 <= value <= 1:
                errors.append(f"{row['pair_id']}: invalid fold TV")

        def weighted(rows: list[dict[str, str]]) -> float:
            return sum(float(row["train_total_variation_complementarity"]) * int(row["n_train"])
                       for row in rows) / sum(int(row["n_train"]) for row in rows)

        for row in pairs:
            expected = weighted(grouped[(row["model_b"], row["method"])])
            if not close(expected, float(row["train_total_variation_complementarity"])):
                errors.append(f"{row['pair_id']}: combined TV not train-support weighted")
        for point in payloads[public_name]["points"]:
            identifier = point["partner_configuration"] if prefix else point["exact_configuration"]
            rows = grouped[(identifier, "anchor")]
            combined = point["combined"] if prefix else point
            if not close(weighted(rows), combined["train_diversity"]["total_variation"]):
                errors.append(f"{identifier}: public combined TV mismatch")
            for direction, train_fold in (("a_to_b", "A"), ("b_to_a", "B")):
                selected = [row for row in rows if row["train_fold"] == train_fold]
                if not close(weighted(selected), point["directions"][direction]["train_diversity"]["total_variation"]):
                    errors.append(f"{identifier}: {direction} TV mismatch")
        reports.append({"artifact": prefix or "market_freeze", "fold_rows": len(folds),
                        "pair_rows": len(pairs), "passed": not errors, "errors": errors})
    folder = derived_root / "upper_left_model_pair_aggregation"
    folds = csv_rows(folder / "crossfit_fold_methods.csv.gz")
    pairs = csv_rows(folder / "crossfit_pair_method_averages.csv")
    grouped = defaultdict(list)
    errors = []
    for row in folds:
        grouped[(row["pair_id"], row["method"])].append(row)
        value = float(row["diversity_total_variation"])
        if not math.isfinite(value) or not 0 <= value <= 1:
            errors.append(f"{row['pair_id']}: invalid fold TV")
    for row in pairs:
        selected = grouped[(row["pair_id"], row["method"])]
        expected = sum(float(fold["diversity_total_variation"]) for fold in selected) / len(selected)
        if not close(expected, float(row["diversity_total_variation"])):
            errors.append(f"{row['pair_id']}: mean train TV mismatch")
    pair_by_id = {(row["pair_id"], row["method"]): row for row in pairs}
    for point in payloads[FILES[4]]["crossfit"]["rows"]:
        row = pair_by_id[(point["pair_id"], point["method"])]
        if not close(float(row["diversity_total_variation"]), point["mean_train_diversity"]["total_variation"]):
            errors.append(f"{point['pair_id']}: public mean train TV mismatch")
    reports.append({"artifact": "upper_left_pairs", "fold_rows": len(folds),
                    "pair_rows": len(pairs), "passed": not errors, "errors": errors})
    return reports


def audit(baseline_site_data: Path, site_data: Path, derived_root: Path,
          baseline_derived_summary: Path | None = None) -> dict[str, Any]:
    reports = []
    payloads = {}
    for relative in FILES:
        old_path, new_path = baseline_site_data / relative, site_data / relative
        old, new = read_json(old_path), read_json(new_path)
        payloads[relative] = new
        errors = differences(old, new)
        contract = tv_contract(new, relative)
        if relative.endswith("upper-left-model-pairs.json"):
            derived = read_json(derived_root / "upper_left_model_pair_aggregation/summary.json")
            if derived != new:
                errors.append("upper-left derived summary differs from public payload")
        reports.append({"file": relative, "baseline_sha256": digest(old_path),
                        "current_sha256": digest(new_path), "passed": not errors and contract["passed"],
                        "old_value_differences": errors, "tv_contract": contract})
    optional: dict[str, Any] = {"checked": False, "reason": "optional baseline-derived-summary not provided"}
    if baseline_derived_summary is not None:
        current = derived_root / "freeze_exposed_market_aggregation/summary.json"
        errors = differences(read_json(baseline_derived_summary), read_json(current))
        optional = {"checked": True, "passed": not errors, "baseline_sha256": digest(baseline_derived_summary),
                    "current_sha256": digest(current), "old_value_differences": errors}
    folds = audit_fold_tv(derived_root, payloads)
    return {
        "audit": "Additive total-variation market regression and fold export audit",
        "schema_version": "1.0.0", "tolerance": TOLERANCE,
        "allowed_changed_fields": sorted(ALLOWED_CHANGED_FIELDS),
        "raw_input_hashes_checked": True,
        "passed": all(row["passed"] for row in reports + folds) and optional.get("passed", True),
        "files_checked": len(reports), "numeric_tv_values": sum(row["tv_contract"]["numeric_values"] for row in reports),
        "files": reports, "fold_consistency": folds, "derived_freeze_summary": optional,
        "limitations": [
            "Artifact checks do not re-read original forecast JSON or replace source-imputation audits.",
            "Old-field regression covers the public JSONs and optional derived summary; no pre-upgrade fold CSV is compared.",
            "Train-key and outcome-independence properties also require the synthetic unit tests.",
            "Ten repeated folds reuse targets; record counts are not independent statistical sample sizes.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-site-data", type=Path, required=True)
    parser.add_argument("--site-data", type=Path, default=Path("site/public/data"))
    parser.add_argument("--derived-root", type=Path, default=Path("data/derived"))
    parser.add_argument("--baseline-derived-summary", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/derived/total_variation_audit/market.json"))
    args = parser.parse_args()
    report = audit(args.baseline_site_data, args.site_data, args.derived_root, args.baseline_derived_summary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("passed", "files_checked", "numeric_tv_values")}, indent=2))
    if not report["passed"]:
        raise SystemExit("Market TV audit failed; inspect the report")


if __name__ == "__main__":
    main()
