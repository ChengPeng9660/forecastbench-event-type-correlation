"""Export audited cross-category results for the public Atlas, without refitting.

Usage: python analysis/export_complementarity_site.py --study /path/to/study
The source study is specialization_argument_2026-08-31. Its frozen outputs stay
unchanged. Missing values become JSON null, never invented scores or zero gains.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path
import shutil

METHODS = [
    ("type_shrunk", "Category-shrunk", "research"),
    ("global_convex", "Global convex", "research"),
    ("type_router", "Category router", "research"),
    ("cv_gated_type", "CV-gated category", "research"),
    ("source_shrunk", "Source-shrunk", "research"),
    ("source_topic_hierarchy", "Source + topic", "research"),
    ("simple_mean", "Simple mean", "original"),
    ("log_odds_mean", "Log-odds mean", "original"),
    ("ec_w0_56", "EC · w = 0.56", "original"),
    ("piecewise_odds", "Piecewise odds", "original"),
    ("cf_directional", "Directional CF", "original"),
    ("best_single", "Best single · hindsight", "hindsight"),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atom(value: str):
    if value in ("", "nan", "NaN"):
        return None
    if value in ("True", "False"):
        return value == "True"
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except ValueError:
        return value


def records(path: Path):
    with (gzip.open(path, "rt") if path.suffix == ".gz" else path.open()) as f:
        return list(csv.DictReader(f))


def project(row, keys):
    return {key: atom(row[key]) for key in keys}


def export(study: Path, destination: Path):
    audited = json.loads((study / "results/independent_mechanism_audit.json").read_text())
    assert audited["status"] == "PASS"
    assert digest(study / "results/mechanism_rows.csv.gz") == audited["result_sha256"]
    for name, expected in audited["code_sha256"].items():
        assert digest(study / "code" / name) == expected, name
    frozen = json.loads((study / "artifact_manifest.json").read_text())
    inputs = [
        "results/mechanism_enriched.csv.gz", "results/harmonized_group_profiles.csv.gz",
        "results/aggregation_summary.csv", "results/mechanism_summary.csv",
        "results/primary_intervals.csv", "results/matched_coverage_primary_intervals.csv",
        "results/matched_coverage_temporal_summary.csv", "results/label_sensitivity_summary.csv",
        "results/independent_mechanism_audit.json", "data/audit.json", "data/models.json",
    ]
    for name in inputs:
        assert digest(study / name) == frozen[name]["sha256"], name
    rows = records(study / inputs[0])
    primary = [r for r in rows if r["split"] == "20260910" and r["fold"] == "0"]
    assert len(primary) == 1436
    groups = {}
    for r in records(study / inputs[1]):
        if not r["id"].startswith("20260910_0_"):
            continue
        key = (r["dimension"], r["id"])
        group = project(r, ["group", "train_mass", "test_mass", "train_events", "test_events",
                            "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b", "test_support_ok"])
        group["methods"] = {method: atom(r[method + "_bi"]) for method, _, _ in METHODS}
        groups.setdefault(key, []).append(group)
    pairs = []
    for r in primary:
        p = project(r, ["train_events", "test_events", "train_rows", "test_rows", "train_gap",
                        "test_gap", "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b",
                        "train_groups", "train_coverage", "train_between_norm", "train_between",
                        "train_within", "train_total", "train_between_share", "crossing",
                        "crossing_persists", "complete_test_profile", "train_profile_bi_defined",
                        "group_a", "group_b", "cross_provider"])
        p.update(id=r["pair_id"], dimension=r["dimension"], model_a=r["model_a"], model_b=r["model_b"],
                 methods={m: atom(r[m + "_bi"]) for m, _, _ in METHODS},
                 profiles=groups.get((r["dimension"], r["id"]), []))
        pairs.append(p)
    primary_keys = {(p["dimension"], p["id"]) for p in pairs}
    assert len(primary_keys) == len(pairs)

    cohorts = {}
    for r in records(study / inputs[3]):
        if r["cohort"] not in ("eligible", "crossing") or r["split"] == "full":
            continue
        key = "|".join(r[k] for k in ["split", "fold", "dimension", "threshold", "cohort"])
        c = project(r, [k for k in r if k not in ("split", "fold", "dimension", "cohort")])
        c.update(split=r["split"], fold=int(r["fold"]), dimension=r["dimension"], cohort=r["cohort"], methods={})
        cohorts[key] = c
    for r in records(study / inputs[2]):
        key = "|".join(r[k] for k in ["split", "fold", "dimension", "threshold", "cohort"])
        if key not in cohorts:
            continue
        cohorts[key]["methods"][r["method"]] = project(r, ["n_bi", "gain_best_bi", "gain_trainbest_bi",
                "gain_best_loss", "positive_rate", "n_preservation", "preservation_rate"])
        # Keep the audited mean of paired increments. A difference of separately
        # averaged method scores can change the estimand when BI is undefined.
        cohorts[key]["type_increment_mean"] = atom(r["mean_type_increment"])
    for c in cohorts.values():
        assert len(c["methods"]) == len(METHODS)
        if c["split"] == "20260910" and c["fold"] == 0:
            included = [p for p in pairs if p["dimension"] == c["dimension"] and
                        (p["train_groups"] or 0) >= 2 and (p["train_coverage"] or 0) >= c["threshold"]
                        and (c["cohort"] != "crossing" or p["crossing"] is True)]
            assert len(included) == c["n"], (c, len(included))
            for method, _, _ in METHODS:
                values = [p["methods"][method] - max(p["test_bi_a"], p["test_bi_b"]) for p in included
                          if all(p[k] is not None for k in ("test_bi_a", "test_bi_b")) and p["methods"][method] is not None]
                expected = c["methods"][method]["gain_best_bi"]
                assert (not values and expected is None) or abs(sum(values) / len(values) - expected) < 1e-10
    matched = [project(r, ["coverage_threshold", "dimension", "triplets", "estimate", "ci_low", "ci_high"])
               for r in records(study / inputs[5]) if r["endpoint"] == "contrast_type_increment_bi"]
    labels = [project(r, ["dimension", "cohort", "coverage_threshold", "pairs", "permutations",
                          "actual_bi", "control_bi", "actual_minus_control_bi",
                          "control_train_changed_event_fraction", "control_test_changed_event_fraction"])
              for r in records(study / inputs[7])]
    intervals = [project(r, list(r)) for r in records(study / inputs[4])]
    panel = json.loads((study / "data/audit.json").read_text())
    payload = {
        "schema_version": 1, "study": study.name, "date": "2026-08-31",
        "primary_split": "20260910", "primary_fold": 0,
        "models": json.loads((study / "data/models.json").read_text()),
        "sample": {k: panel[k] for k in ("scored_models", "genuine_scored_predictions", "targets", "events", "dates")},
        "methods": [{"id": m, "label": label, "kind": kind} for m, label, kind in METHODS],
        "pairs": pairs, "cohorts": list(cohorts.values()), "matched": matched, "labels": labels,
        "intervals": intervals,
        "audit": {"status": audited["status"], "numeric_checks": audited["numeric_checks"],
                  "max_absolute_error": audited["max_absolute_error"], "implementation_tests": 22},
        "provenance": {name: digest(study / name) for name in inputs},
    }
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "study.json").write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    for name in ("REPORT.md", "ARGUMENT.md", "PROTOCOL.md", "CODE_AUDIT.md", "THEORY_DESIGN_REVIEW.md",
                 "MATCHED_CONTROLS.md", "LABEL_CONTROLS.md", "LICENSE-DATA.md"):
        shutil.copyfile(study / name, destination / name)
    with (destination / "primary-pairs.csv").open("w", newline="") as f:
        keys = ["dimension", "id", "model_a", "model_b", "train_gap", "test_gap", "train_events", "test_events",
                "train_coverage", "crossing", "train_between_norm", "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b"]
        writer = csv.DictWriter(f, fieldnames=keys + [m + "_bi" for m, _, _ in METHODS], lineterminator="\n")
        writer.writeheader()
        for p in pairs:
            writer.writerow({**{k: p[k] for k in keys}, **{m + "_bi": p["methods"][m] for m, _, _ in METHODS}})
    manifest = {"study": study.name, "primary_pair_views": len(pairs), "cohort_views": len(cohorts),
                "source_manifest_sha256": digest(study / "artifact_manifest.json"),
                "files": {p.name: {"sha256": digest(p), "bytes": p.stat().st_size}
                          for p in sorted(destination.iterdir()) if p.is_file() and p.name != "manifest.json"}}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "primary_pair_views": len(pairs), "cohort_views": len(cohorts),
                      "bytes": (destination / "study.json").stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "site/public/data/complementarity")
    args = parser.parse_args()
    export(args.study, args.output)
