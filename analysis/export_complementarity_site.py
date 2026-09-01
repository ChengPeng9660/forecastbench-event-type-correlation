"""Export the audited uniform-target complementarity sensitivity to the Atlas.

Usage:
  python analysis/export_complementarity_site.py \
    --study /path/to/complementarity_unweighted_gap_sensitivity_2026-09-01

This script only projects frozen experiment outputs into a browser-friendly
contract. It does not refit an aggregation method or recompute a result.
Missing values become JSON null and are never replaced by zero.
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
PRIMARY_SPLIT = "20260910"
PRIMARY_FOLD = 0
DATA_ATTRIBUTION = """# Data attribution

Derived with changes from ForecastBench data produced by the Forecasting Research Institute / forecastingresearch.

Original data: [ForecastBench datasets](https://github.com/forecastingresearch/forecastbench-datasets).

Data and derived-data license: [Creative Commons Attribution-ShareAlike4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Changes include selecting exact plain-zero-shot configurations, removing imputed/unresolved/unscored records, joining an archived official fixed-effect snapshot and existing topic labels, constructing common-support research panels, calculating complementarity decompositions and aggregation results, and generating retrospective summaries and figures.

This is not an official ForecastBench leaderboard release. No new forecasts, model submissions or outcomes were fabricated. Source manifests, fixed-effect snapshot and delivery hashes are provided.
"""


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atom(value):
    if value is None or value in ("", "nan", "NaN"):
        return None
    if value in ("True", "False"):
        return value == "True"
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return value


def records(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", newline="") as handle:
        return list(csv.DictReader(handle))


def project(row, keys):
    return {key: atom(row.get(key)) for key in keys}


def verify_frozen_inputs(study: Path, source: Path):
    manifest = json.loads((study / "artifact_manifest.json").read_text())
    required = [
        "PROTOCOL.md", "REPORT.md", "README.md", "REPRODUCE.md",
        "results/pair_results.csv.gz", "results/category_profiles.csv.gz",
        "results/primary_summary.csv", "results/direction_summary.csv",
        "results/primary_intervals.csv", "results/requested_primary_results.csv",
        "results/audit.json", "results/independent_audit.json",
    ]
    for name in required:
        expected = manifest["files"][name]["sha256"]
        assert digest(study / name) == expected, name
    audit = json.loads((study / "results/audit.json").read_text())
    independent = json.loads((study / "results/independent_audit.json").read_text())
    assert audit["weighting"].startswith("uniform common-target rows")
    assert audit["no_test_gap_filter"] and audit["train_selection_only"]
    assert audit["event_overlap_failures"] == 0
    assert independent["status"].lower() == "pass"
    assert independent["event_disjointness"].lower() == "pass"
    assert max(independent["maximum_absolute_differences"].values()) < independent["tolerance"]
    assert digest(source / "artifact_manifest.json") == audit["source_manifest_sha256"]
    return manifest, audit, independent


def export(study: Path, destination: Path):
    source = study.parent / "specialization_argument_2026-08-31"
    manifest, audit, independent = verify_frozen_inputs(study, source)
    models = json.loads((source / "data/models.json").read_text())
    sample = json.loads((source / "data/audit.json").read_text())
    providers = {row["model"]: row["provider"] for row in records(source / "data/model_coverage.csv")}

    all_pair_rows = records(study / "results/pair_results.csv.gz")
    primary_rows = [row for row in all_pair_rows if row["split"] == PRIMARY_SPLIT and int(row["fold"]) == PRIMARY_FOLD]
    assert len(all_pair_rows) == audit["output_rows"] == 25580
    assert len(primary_rows) == audit["primary_influence_rows"] == 2618

    profile_map = {}
    for row in records(study / "results/category_profiles.csv.gz"):
        if not row["id"].startswith(f"{PRIMARY_SPLIT}_{PRIMARY_FOLD}_"):
            continue
        key = (row["dimension"], row["id"])
        profile = project(row, [
            "group", "train_mass", "test_mass", "train_events", "test_events",
            "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b", "test_support_ok",
        ])
        profile["methods"] = {method: atom(row[f"{method}_bi"]) for method, _, _ in METHODS}
        profile_map.setdefault(key, []).append(profile)

    pairs = []
    for row in primary_rows:
        pair = project(row, [
            "train_events", "test_events", "train_rows", "test_rows", "train_gap", "test_gap",
            "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b", "train_groups",
            "train_coverage", "train_between_norm", "train_between", "train_within", "train_total",
            "train_between_share", "crossing", "crossing_persists", "complete_test_profile",
            "train_profile_bi_defined", "group_a", "group_b",
        ])
        pair.update(
            id=row["pair_id"],
            dimension=row["dimension"],
            model_a=row["model_a"],
            model_b=row["model_b"],
            train_origin_dataset_fraction=atom(row["train_origin_0_row_fraction"]),
            cross_provider=providers.get(row["model_a"]) != providers.get(row["model_b"]),
            methods={method: atom(row[f"{method}_bi"]) for method, _, _ in METHODS},
            profiles=profile_map.get((row["dimension"], row["id"]), []),
        )
        assert row["weighting"] == "uniform_rows"
        pairs.append(pair)
    assert len({(pair["dimension"], pair["id"]) for pair in pairs}) == len(pairs)

    summary_keys = [
        "view", "ability_gap", "coverage", "dimension", "cohort", "method", "n", "n_defined",
        "mean_gain_vs_test_best_bi", "median_gain_vs_test_best_bi", "beats_both_rate",
        "mean_gain_vs_train_selected_bi", "beats_train_selected_rate", "mean_increment_vs_global_bi",
        "mean_gain_vs_test_best_raw_loss", "mean_train_gap", "mean_test_gap", "mean_train_coverage",
        "mean_test_events",
    ]
    summaries = [project(row, summary_keys) for row in records(study / "results/primary_summary.csv")]
    direction_rows = records(study / "results/direction_summary.csv")
    directions = [project(row, ["split", "fold", *summary_keys]) for row in direction_rows]
    for exported, source_row in zip(directions, direction_rows):
        # Split identifiers are labels even though they contain only digits.
        exported["split"] = source_row["split"]
        exported["fold"] = int(source_row["fold"])
    intervals = [project(row, row.keys()) for row in records(study / "results/primary_intervals.csv")]
    assert len(summaries) == 352 and len(directions) == 3520 and len(intervals) == 96

    # Contract-check all primary summary rows against the exported pair records.
    for row in summaries:
        selected = [pair for pair in pairs
                    if pair["dimension"] == row["dimension"]
                    and pair["train_gap"] <= row["ability_gap"] + 1e-12
                    and (pair["train_groups"] or 0) >= 2
                    and (pair["train_coverage"] or 0) >= row["coverage"]
                    and (row["cohort"] != "crossing" or pair["crossing"] is True)]
        assert len(selected) == int(row["n"]), (row, len(selected))
        values = []
        for pair in selected:
            method_bi = pair["methods"][row["method"]]
            if method_bi is not None and pair["test_bi_a"] is not None and pair["test_bi_b"] is not None:
                values.append(method_bi - max(pair["test_bi_a"], pair["test_bi_b"]))
        assert len(values) == int(row["n_defined"])
        if values:
            assert abs(sum(values) / len(values) - row["mean_gain_vs_test_best_bi"]) < 1e-10

    maximum_error = max(independent["maximum_absolute_differences"].values())
    payload = {
        "schema_version": 2,
        "study": manifest["study"],
        "date": "2026-09-01",
        "primary_split": PRIMARY_SPLIT,
        "primary_fold": PRIMARY_FOLD,
        "weighting": "uniform_rows",
        "ability_thresholds": [3, 5],
        "coverage_thresholds": [.5, .6, .7, .8],
        "models": models,
        "methods": [{"id": method, "label": label, "kind": kind} for method, label, kind in METHODS],
        "pairs": pairs,
        "summaries": summaries,
        "directions": directions,
        "intervals": intervals,
        "sample": {key: sample[key] for key in ["scored_models", "genuine_scored_predictions", "targets", "events", "dates"]},
        "audit": {
            "status": "PASS",
            "implementation_independent": independent["implementation_independent"],
            "sampled_rows": independent["sampled_primary_dimension_rows"],
            "max_absolute_error": maximum_error,
            "event_disjointness": independent["event_disjointness"].upper(),
            "output_rows": audit["output_rows"],
            "category_profile_rows": audit["category_profile_rows"],
            "source_manifest_sha256": audit["source_manifest_sha256"],
        },
        "provenance": {
            "experiment_manifest_sha256": digest(study / "artifact_manifest.json"),
            "pair_results_sha256": digest(study / "results/pair_results.csv.gz"),
            "category_profiles_sha256": digest(study / "results/category_profiles.csv.gz"),
            "source_manifest_sha256": audit["source_manifest_sha256"],
        },
    }

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    (destination / "LICENSE-DATA.md").write_text(DATA_ATTRIBUTION)
    (destination / "study.json").write_text(json.dumps(payload, separators=(",", ":")))

    public_rows = []
    for pair in pairs:
        public_rows.append({
            "dimension": pair["dimension"], "pair_id": pair["id"],
            "model_a": pair["model_a"], "model_b": pair["model_b"],
            "train_bi_gap": pair["train_gap"], "uniform_row_category_coverage": pair["train_coverage"],
            "train_crossing": pair["crossing"], "train_category_complementarity": pair["train_between_norm"],
            "train_dataset_row_fraction": pair["train_origin_dataset_fraction"],
            "test_bi_a": pair["test_bi_a"], "test_bi_b": pair["test_bi_b"],
            "global_convex_bi": pair["methods"]["global_convex"],
            "category_shrunk_bi": pair["methods"]["type_shrunk"],
            "category_shrunk_gain_vs_better_test_single_bi": (
                pair["methods"]["type_shrunk"] - max(pair["test_bi_a"], pair["test_bi_b"])
                if None not in (pair["methods"]["type_shrunk"], pair["test_bi_a"], pair["test_bi_b"]) else None),
            "category_shrunk_increment_vs_global_bi": (
                pair["methods"]["type_shrunk"] - pair["methods"]["global_convex"]
                if None not in (pair["methods"]["type_shrunk"], pair["methods"]["global_convex"]) else None),
            "train_events": pair["train_events"], "test_events": pair["test_events"],
        })
    with (destination / "primary-pairs.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(public_rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(public_rows)

    copies = {
        "REPORT.md": "REPORT.md",
        "PROTOCOL.md": "PROTOCOL.md",
        "README.md": "README.md",
        "REPRODUCE.md": "REPRODUCE.md",
        "results/requested_primary_results.csv": "requested_primary_results.csv",
        "results/independent_audit.json": "independent_audit.json",
        "artifact_manifest.json": "experiment_manifest.json",
    }
    for source_name, public_name in copies.items():
        shutil.copyfile(study / source_name, destination / public_name)

    exported = {path.name: {"bytes": path.stat().st_size, "sha256": digest(path)}
                for path in sorted(destination.iterdir()) if path.name != "manifest.json"}
    public_manifest = {
        "study": payload["study"],
        "generated_from_frozen_outputs": True,
        "weighting": payload["weighting"],
        "ability_thresholds": payload["ability_thresholds"],
        "files": exported,
        "source_manifest_sha256": audit["source_manifest_sha256"],
    }
    (destination / "manifest.json").write_text(json.dumps(public_manifest, indent=2) + "\n")
    print(json.dumps({
        "destination": str(destination), "pairs": len(pairs),
        "profiles": sum(len(pair["profiles"]) for pair in pairs),
        "summaries": len(summaries), "directions": len(directions),
        "study_json_bytes": (destination / "study.json").stat().st_size,
    }, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--destination", type=Path,
                        default=Path("site/public/data/complementarity"))
    args = parser.parse_args()
    export(args.study.resolve(), args.destination.resolve())


if __name__ == "__main__":
    main()
