"""Verify that adding TV leaves the existing topic/global results unchanged.

Run with a pre-upgrade copy of site/public/data. Model/market aggregation
artifacts receive their own fold-level contract and regression checks.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


TV_FIELDS = {"total_variation", "tv_reason"}


def without_tv(value):
    if isinstance(value, dict):
        # The global matrices use a compact field-indexed representation.
        if "fields" in value and "pairs" in value:
            fields = value["fields"]
            keep = [i for i, name in enumerate(fields) if name not in TV_FIELDS]
            value = {
                **value,
                "fields": [fields[i] for i in keep],
                "pairs": [[row[i] for i in keep] for row in value["pairs"]],
            }
        return {key: without_tv(item) for key, item in value.items() if key not in TV_FIELDS}
    if isinstance(value, list):
        kept = []
        for item in value:
            if isinstance(item, str) and item in TV_FIELDS:
                continue
            if isinstance(item, dict) and any(
                item.get(key) == "total_variation" for key in ("metric_id", "metric", "id")
            ):
                continue
            kept.append(without_tv(item))
        return kept
    return value


def differences(before, after, path=""):
    if isinstance(before, dict) and isinstance(after, dict):
        errors = []
        for key in before:
            if key not in after:
                errors.append(f"{path}.{key}: missing field")
            else:
                errors.extend(differences(before[key], after[key], f"{path}.{key}"))
        return errors
    if isinstance(before, list) and isinstance(after, list):
        if len(before) != len(after):
            return [f"{path}: cardinality changed {len(before)} -> {len(after)}"]
        return [error for i, (a, b) in enumerate(zip(before, after))
                for error in differences(a, b, f"{path}[{i}]")]
    if isinstance(before, (float, int)) and not isinstance(before, bool):
        if (isinstance(after, (float, int)) and not isinstance(after, bool)
                and math.isclose(before, after, rel_tol=1e-12, abs_tol=1e-12)):
            return []
    elif type(before) is type(after) and before == after:
        return []
    return [f"{path}: {before!r} -> {after!r}"]


def audit(baseline: Path, current: Path):
    relative_paths = [
        *(path.relative_to(baseline) for path in sorted((baseline / "event-types").glob("*.json"))
          if " 2." not in path.name),
        Path("global-baseline/summary.json"),
        Path("cross-type/summary.json"),
        *(path.relative_to(baseline) for path in sorted((baseline / "global-baseline/pair-matrices").glob("*.json"))
          if " 2." not in path.name),
        *(path.relative_to(baseline) for path in sorted((baseline / "global-baseline/partner-profiles").glob("*.json"))
          if " 2." not in path.name),
        Path("focal-gain/gpt-4-1-2025-04-14.json"),
    ]
    reports = []
    for relative in relative_paths:
        before = json.loads((baseline / relative).read_text())
        after = json.loads((current / relative).read_text())
        if relative.parts[0] == "focal-gain":
            # The legacy export records its generation date and the digest of
            # the global CSV; adding a CSV column necessarily changes the hash.
            # Its original panel hash, all numeric results and support are checked.
            for value in (before, after):
                value.pop("generated_at", None)
                value["provenance"].pop("pair_metrics_sha256", None)
        errors = differences(without_tv(before), without_tv(after))
        reports.append({"file": str(relative), "unchanged_existing_results": not errors, "errors": errors[:20]})
    return {
        "audit": "TV additive core data regression",
        "tolerance": 1e-12,
        "files_checked": len(reports),
        "passed": all(report["unchanged_existing_results"] for report in reports),
        "files": reports,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-site-data", type=Path, required=True)
    parser.add_argument("--site-data", type=Path, default=Path("site/public/data"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.baseline_site_data, args.site_data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, indent=2))
    if not report["passed"]:
        raise SystemExit("Existing-result differences found; inspect the audit report")


if __name__ == "__main__":
    main()
