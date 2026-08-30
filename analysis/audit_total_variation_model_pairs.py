"""Validate regenerated model-pair TV outputs against the saved public data."""

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path


def main() -> int:
    ROOT = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-site-data", type=Path, required=True,
                        help="Saved site/public/data directory from before TV regeneration.")
    parser.add_argument("--site-data", type=Path, default=ROOT / "site/public/data")
    parser.add_argument("--fold-results", type=Path,
                        default=ROOT / "data/derived/fixed_focal_without_freeze/fold_method_results.csv.gz")
    parser.add_argument("--output", type=Path,
                        default=ROOT / "data/derived/total_variation_audit/model_pairs.json")
    parser.add_argument("--tolerance", type=float, default=1e-12)
    args = parser.parse_args()
    if not math.isfinite(args.tolerance) or args.tolerance < 0:
        parser.error("--tolerance must be finite and nonnegative")
    BEFORE = args.baseline_site_data.resolve()
    AFTER = args.site_data.resolve()
    TOLERANCE = args.tolerance
    FILENAMES = (
        "pair-aggregation/all-six-family-pairs.json",
        "pair-aggregation/fixed-focal-without-freeze.json",
    )
    failures = []
    checks = []


    def is_tv_item(item):
        return item == "total_variation" or (
            isinstance(item, dict)
            and (item.get("metric") == "total_variation" or item.get("metric_id") == "total_variation")
        )


    def compare(old, new, path, stats):
        if isinstance(old, dict):
            if not isinstance(new, dict):
                failures.append({"path": path, "reason": "changed_object_type"})
                return
            for key in new.keys() - old.keys():
                if key not in {"total_variation", "tv_reason"}:
                    failures.append({"path": f"{path}.{key}", "reason": "unexpected_new_key"})
            for key, old_value in old.items():
                child = f"{path}.{key}"
                if key not in new:
                    failures.append({"path": child, "reason": "missing_old_key"})
                    continue
                if key in {"generated_at", "built_at"} or (
                    ".provenance." in child
                    and key in {"pair_metrics_sha256", "pair_payload_sha256"}
                ):
                    if old_value != new[key]:
                        stats["permitted_metadata_changes"].append(child)
                    continue
                compare(old_value, new[key], child, stats)
            return
        if isinstance(old, list):
            if not isinstance(new, list):
                failures.append({"path": path, "reason": "changed_array_type"})
                return
            filtered = [item for item in new if not is_tv_item(item)]
            if len(old) != len(filtered):
                failures.append({"path": path, "reason": "changed_old_array_length", "old": len(old), "new": len(filtered)})
                return
            for index, (left, right) in enumerate(zip(old, filtered)):
                compare(left, right, f"{path}[{index}]", stats)
            return
        stats["old_scalar_values_checked"] += 1
        if isinstance(old, (int, float)) and not isinstance(old, bool) and isinstance(new, (int, float)) and not isinstance(new, bool):
            difference = abs(old - new)
            stats["old_numeric_values_checked"] += 1
            stats["maximum_absolute_numeric_difference"] = max(stats["maximum_absolute_numeric_difference"], difference)
            if not math.isfinite(new) or difference > TOLERANCE:
                failures.append({"path": path, "reason": "changed_old_numeric_value", "old": old, "new": new})
        elif old != new or type(old) is not type(new):
            failures.append({"path": path, "reason": "changed_old_value", "old": old, "new": new})


    payloads = {}
    for name in FILENAMES:
        old_bytes, new_bytes = (BEFORE / name).read_bytes(), (AFTER / name).read_bytes()
        old, new = json.loads(old_bytes), json.loads(new_bytes)
        stats = {
            "file": name,
            "before_sha256": hashlib.sha256(old_bytes).hexdigest(),
            "after_sha256": hashlib.sha256(new_bytes).hexdigest(),
            "old_scalar_values_checked": 0,
            "old_numeric_values_checked": 0,
            "maximum_absolute_numeric_difference": 0.0,
            "permitted_metadata_changes": [],
        }
        compare(old, new, name, stats)
        checks.append(stats)
        payloads[name] = new


    tv_values = []


    def check_tv(value, path):
        if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            failures.append({"path": path, "reason": "invalid_tv", "value": value})
        else:
            tv_values.append(value)


    pairs = payloads[FILENAMES[0]]
    point_sets = [("same_sample_audit", pairs["points"])]
    for view, source in (("combined", pairs["cross_fit"]), *pairs["cross_fit"]["directional_points"].items()):
        for sample in ("eligible", "near_bi"):
            point_sets.append((f"{view}.{sample}", source[f"{sample}_points"]))
    pair_tv_counts = {}
    for view, points in point_sets:
        pair_tv_counts[view] = len(points)
        for index, point in enumerate(points):
            metric = point["metrics"].get("total_variation", {})
            for kind in ("raw", "complementarity"):
                check_tv(metric.get(kind), f"all_six.{view}[{index}].{kind}")
            if metric.get("raw") != metric.get("complementarity"):
                failures.append({"path": f"all_six.{view}[{index}]", "reason": "tv_orientation_changed"})

    same_sample_tv = {
        frozenset((point["model_a"], point["model_b"])): point["metrics"]["total_variation"]["raw"]
        for point in pairs["points"]
    }
    for point in pairs["cross_fit"]["eligible_points"]:
        expected = same_sample_tv[frozenset((point["model_a"], point["model_b"]))]
        if abs(point["metrics"]["total_variation"]["raw"] - expected) > TOLERANCE:
            failures.append({"path": f"all_six.{point['model_a']}__{point['model_b']}", "reason": "combined_tv_not_full_common_target_mean"})

    fixed = payloads[FILENAMES[1]]
    fold_groups = defaultdict(lambda: [0.0, 0])
    fold_records = {}
    fold_row_count = 0
    fold_path = args.fold_results.resolve()
    with gzip.open(fold_path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            fold_row_count += 1
            value = float(row["train_total_variation_complementarity"])
            check_tv(value, f"fold_csv.row_{fold_row_count}")
            if row["method"] != "anchor":
                continue
            weight = int(row["n_train"])
            fold_id = (
                f"split_{int(row['repetition']):02d}_seed_{row['seed']}"
                f"__{row['train_fold']}_train__{row['test_fold']}_test"
            )
            fold_records[(row["model_a"], row["model_b"], fold_id)] = (
                value, weight, row["train_near_bi"] == "True"
            )
            for view in ("combined", "a_to_b" if row["train_fold"] == "A" else "b_to_a"):
                group = fold_groups[(row["model_a"], row["model_b"], view)]
                group[0] += value * weight
                group[1] += weight

    maximum_fold_reconstruction_difference = 0.0
    all_six_fold_reconstruction_count = 0
    for view, points in point_sets:
        if view == "same_sample_audit":
            continue
        for index, point in enumerate(points):
            selected = [
                fold_records[(point["model_a"], point["model_b"], fold_id)]
                for fold_id in point["cross_fit"]["fold_ids"]
            ]
            support = sum(weight for _, weight, _ in selected)
            expected = sum(value * weight for value, weight, _ in selected) / support
            difference = abs(point["metrics"]["total_variation"]["raw"] - expected)
            maximum_fold_reconstruction_difference = max(maximum_fold_reconstruction_difference, difference)
            all_six_fold_reconstruction_count += 1
            if difference > TOLERANCE or support != point["cross_fit"]["train_target_rows"]:
                failures.append({"path": f"all_six.{view}[{index}]", "reason": "tv_fold_reconstruction_mismatch"})
            if view.endswith(".near_bi") and not all(near for _, _, near in selected):
                failures.append({"path": f"all_six.{view}[{index}]", "reason": "non_near_bi_fold_in_strict_sample"})

    for index, point in enumerate(fixed["points"]):
        for view, data in (("combined", point["combined"]), *point["directions"].items()):
            value = data["train_diversity"].get("total_variation")
            check_tv(value, f"fixed.points[{index}].{view}")
            weighted_sum, support = fold_groups[(point["base_model"], point["partner_model"], view)]
            difference = abs(value - weighted_sum / support)
            maximum_fold_reconstruction_difference = max(maximum_fold_reconstruction_difference, difference)
            if difference > TOLERANCE or support != data["train_target_cells"]:
                failures.append({"path": f"fixed.points[{index}].{view}", "reason": "tv_fold_reconstruction_mismatch"})
        expected = same_sample_tv[frozenset((point["base_model"], point["partner_model"]))]
        if abs(point["combined"]["train_diversity"]["total_variation"] - expected) > TOLERANCE:
            failures.append({"path": f"fixed.points[{index}].combined", "reason": "combined_tv_not_full_common_target_mean"})

    tv_correlations = [row for row in fixed["evaluation"]["focal_correlation_summary"] if row["metric"] == "total_variation"]
    expected_correlations = fixed["audit"]["model_count"] * len(fixed["evaluation"]["methods"])
    if len(tv_correlations) != expected_correlations:
        failures.append({"path": "fixed.evaluation.focal_correlation_summary", "reason": "missing_tv_correlations"})

    report = {
        "status": "pass" if not failures else "fail",
        "absolute_numeric_tolerance": TOLERANCE,
        "snapshot_directory": str(BEFORE),
        "comparison": checks,
        "tv_definition": "mean(abs(p_a-p_b)) over identical aligned target rows; training folds only in cross-fit",
        "all_six_point_counts_with_tv": pair_tv_counts,
        "all_six_tv_fold_reconstructions_checked": all_six_fold_reconstruction_count,
        "fixed_focal_ordered_pair_count": len(fixed["points"]),
        "fixed_focal_fold_results": str(fold_path),
        "fixed_focal_fold_method_rows_checked": fold_row_count,
        "fixed_focal_tv_correlation_rows": len(tv_correlations),
        "maximum_tv_fold_reconstruction_difference": maximum_fold_reconstruction_difference,
        "tv_values_checked": len(tv_values),
        "minimum_tv": min(tv_values),
        "maximum_tv": max(tv_values),
        "failures": failures,
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
