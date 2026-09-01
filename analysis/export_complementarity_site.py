"""Export the audited all-configuration complementarity study to the Atlas."""

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
    ("simple_mean", "Simple mean", "deployable"),
    ("log_odds_mean", "Log-odds mean", "deployable"),
    ("ec_w0_56", "EC · w = 0.56", "deployable"),
    ("piecewise_odds", "Piecewise odds", "deployable"),
    ("cf_directional", "Directional CF", "deployable"),
]
METHOD_IDS = {method for method, _, _ in METHODS}
PRIMARY_METHOD = "cf_directional"
PRIMARY_SPLIT = "20260910"
PRIMARY_FOLD = 0
PROFILE_SHARDS = 32
DATA_ATTRIBUTION = """# Data attribution

Derived with changes from ForecastBench data produced by the Forecasting Research Institute / forecastingresearch.

Original data: [ForecastBench datasets](https://github.com/forecastingresearch/forecastbench-datasets).

Data and derived-data license: [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Changes include retaining every clean exact model-version, prompt, and information configuration; removing imputed, unresolved, and unscored records; joining an archived official fixed-effect snapshot and existing topic labels; constructing event-disjoint common-support panels; evaluating training-only category complementarity and five unchanged aggregation formulas; and generating retrospective summaries.

This is not an official ForecastBench leaderboard release. No forecasts, submissions, or outcomes were fabricated.
"""


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


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


def stable_pair_id(model_a: str, model_b: str) -> str:
    names = sorted((model_a, model_b), key=lambda name: (name.casefold(), name))
    return "p-" + hashlib.sha256("\0".join(names).encode()).hexdigest()[:12]


def profile_shard(profile_key: str) -> str:
    return f"{int(hashlib.sha256(profile_key.encode()).hexdigest()[:8], 16) % PROFILE_SHARDS:02d}"


def verify_frozen_inputs(study: Path):
    manifest = json.loads((study / "artifact_manifest.json").read_text())
    required = [
        "PROTOCOL.md", "REPORT.md", "README.md", "REPRODUCE.md",
        "data/audit.json", "data/configurations.json", "data/models.json",
        "results/pair_results.csv.gz", "results/primary_category_profiles.csv.gz",
        "results/primary_summary.csv", "results/direction_summary.csv",
        "results/requested_primary_results.csv", "results/diagnostics.json",
        "results/audit.json", "results/independent_audit.json",
    ]
    for name in required:
        expected = manifest["files"][name]["sha256"]
        if digest(study / name) != expected:
            raise ValueError(f"frozen artifact hash mismatch: {name}")
    audit = json.loads((study / "results/audit.json").read_text())
    independent = json.loads((study / "results/independent_audit.json").read_text())
    if not audit["weighting"].startswith("uniform common-target rows"):
        raise ValueError("unexpected target weighting")
    if not audit["no_test_gap_filter"] or not audit["train_selection_only"]:
        raise ValueError("pair selection is not training-only")
    if audit["event_overlap_failures"] or independent["event_disjointness"] != "PASS":
        raise ValueError("event-disjointness audit failed")
    if independent["status"] != "PASS" or independent["maximum_absolute_error"] >= independent["tolerance"]:
        raise ValueError("independent numerical audit failed")
    return manifest, audit, independent


def in_scope(pair, scope):
    if scope == "all":
        return True
    if scope == "different_model_version":
        return pair["same_model_version"] is False
    if scope == "matched_conditions":
        return pair["same_prompt"] is True and pair["same_information"] is True
    raise ValueError(scope)


def export(study: Path, destination: Path):
    _experiment_manifest, audit, independent = verify_frozen_inputs(study)
    data_audit = json.loads((study / "data/audit.json").read_text())
    configurations = json.loads((study / "data/configurations.json").read_text())
    models = json.loads((study / "data/models.json").read_text())
    identities = {row["exact_configuration"]: row for row in configurations}
    if set(identities) != set(models) or len(identities) != 313:
        raise ValueError("exact-configuration catalog differs from the scored panel")

    all_rows = records(study / "results/pair_results.csv.gz")
    primary_source = [
        row for row in all_rows
        if row["split"] == PRIMARY_SPLIT
        and int(row["fold"]) == PRIMARY_FOLD
        and atom(row["train_gap"]) <= 5
        and atom(row["train_groups"]) >= 2
        and atom(row["train_coverage"]) >= 0.5
    ]
    if len(all_rows) != audit["output_rows"] or len(primary_source) != 16_589:
        raise ValueError("expanded result row count changed")

    profile_map = {}
    for row in records(study / "results/primary_category_profiles.csv.gz"):
        key = (row["dimension"], row["pair_id"])
        profile = project(row, [
            "group", "train_mass", "test_mass", "train_events", "test_events",
            "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b", "test_support_ok",
        ])
        profile["methods"] = {method: atom(row[f"{method}_bi"]) for method, _, _ in METHODS}
        profile_map.setdefault(key, []).append(profile)

    pair_fields = [
        "train_events", "test_events", "train_rows", "test_rows", "train_gap", "test_gap",
        "mean_train_bi", "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b",
        "train_groups", "train_coverage", "train_between_norm", "train_between", "train_within",
        "train_total", "train_between_share", "crossing", "crossing_persists",
        "complete_test_profile", "train_profile_bi_defined", "group_a", "group_b",
        "train_origin_dataset_fraction", "same_provider", "same_model_version", "same_prompt",
        "same_information", "provider_a", "provider_b", "canonical_model_version_a",
        "canonical_model_version_b", "prompt_type_a", "prompt_type_b", "information_type_a",
        "information_type_b",
    ]
    pairs = []
    stable_ids = {}
    old_to_profile_key = {}
    for row in primary_source:
        pair = project(row, pair_fields)
        pair_id = stable_pair_id(row["model_a"], row["model_b"])
        prior = stable_ids.setdefault(pair_id, (row["model_a"], row["model_b"]))
        if prior != (row["model_a"], row["model_b"]):
            raise ValueError("stable pair id collision")
        profile_key = f"{row['dimension']}:{pair_id}"
        old_to_profile_key[(row["dimension"], row["pair_id"])] = profile_key
        pair.update(
            id=pair_id,
            dimension=row["dimension"],
            model_a=row["model_a"],
            model_b=row["model_b"],
            methods={method: atom(row[f"{method}_bi"]) for method, _, _ in METHODS},
            profile_key=profile_key,
            profile_shard=profile_shard(profile_key),
        )
        if row["weighting"] != "uniform_rows":
            raise ValueError("unexpected row weighting")
        pairs.append(pair)
    if len({(pair["dimension"], pair["id"]) for pair in pairs}) != len(pairs):
        raise ValueError("duplicate dimension/pair view")

    summary_keys = [
        "view", "pair_scope", "ability_gap", "coverage", "dimension", "cohort", "method",
        "n", "n_defined", "mean_gain_vs_test_best_bi", "median_gain_vs_test_best_bi",
        "beats_both_rate", "mean_gain_vs_train_selected_bi", "beats_train_selected_rate",
        "mean_increment_vs_global_bi", "mean_gain_vs_test_best_raw_loss", "mean_train_gap",
        "mean_test_gap", "mean_train_coverage", "mean_test_events",
    ]
    summary_source = [row for row in records(study / "results/primary_summary.csv") if row["method"] in METHOD_IDS]
    direction_source = [row for row in records(study / "results/direction_summary.csv") if row["method"] in METHOD_IDS]
    summaries = [project(row, summary_keys) for row in summary_source]
    directions = [project(row, ["split", "fold", *summary_keys]) for row in direction_source]
    for exported, source in zip(directions, direction_source):
        exported["split"] = source["split"]
        exported["fold"] = int(source["fold"])
    if len(summaries) != 480 or len(directions) != 4_800:
        raise ValueError("summary row count changed")

    for summary in summaries:
        selected = [
            pair for pair in pairs
            if pair["dimension"] == summary["dimension"]
            and pair["train_gap"] <= summary["ability_gap"] + 1e-12
            and pair["train_groups"] >= 2
            and pair["train_coverage"] >= summary["coverage"]
            and (summary["cohort"] != "crossing" or pair["crossing"] is True)
            and in_scope(pair, summary["pair_scope"])
        ]
        if len(selected) != int(summary["n"]):
            raise ValueError(f"summary count does not reconstruct: {summary}")
        gains = [
            pair["methods"][summary["method"]] - max(pair["test_bi_a"], pair["test_bi_b"])
            for pair in selected
            if None not in (pair["methods"][summary["method"]], pair["test_bi_a"], pair["test_bi_b"])
        ]
        if len(gains) != int(summary["n_defined"]):
            raise ValueError("summary defined count does not reconstruct")
        if gains and abs(sum(gains) / len(gains) - summary["mean_gain_vs_test_best_bi"]) >= 1e-10:
            raise ValueError("summary mean does not reconstruct")

    candidates = [
        pair for pair in pairs
        if pair["dimension"] == "topic" and pair["train_gap"] <= 3
        and pair["train_coverage"] >= 0.5 and pair["crossing"] is True
        and in_scope(pair, "matched_conditions") and pair["train_between_norm"] is not None
    ]
    featured = max(candidates, key=lambda pair: (pair["train_between_norm"], pair["id"]))
    diagnostics = json.loads((study / "results/diagnostics.json").read_text())
    payload = {
        "schema_version": 4,
        "study": "all_exact_configuration_category_complementarity_2026-09-01",
        "date": "2026-09-01",
        "primary_split": PRIMARY_SPLIT,
        "primary_fold": PRIMARY_FOLD,
        "weighting": "uniform_rows",
        "ability_thresholds": [3, 5],
        "coverage_thresholds": [0.5, 0.6, 0.7, 0.8],
        "pair_scopes": [
            {"id": "all", "label": "All exact configurations"},
            {"id": "different_model_version", "label": "Different model versions"},
            {"id": "matched_conditions", "label": "Same prompt + information"},
        ],
        "primary_method": PRIMARY_METHOD,
        "featured_pair_id": featured["id"],
        "models": models,
        "configurations": configurations,
        "methods": [{"id": method, "label": label, "kind": kind} for method, label, kind in METHODS],
        "pairs": pairs,
        "summaries": summaries,
        "directions": directions,
        "diagnostics": diagnostics,
        "sample": {
            "scored_configurations": data_audit["scored_configurations"],
            "canonical_model_versions": data_audit["canonical_model_versions"],
            "prompt_counts": data_audit["prompt_counts"],
            "information_counts": data_audit["information_counts"],
            "genuine_scored_predictions": data_audit["genuine_scored_predictions"],
            "targets": data_audit["targets"],
            "events": data_audit["events"],
            "dates": data_audit["dates"],
        },
        "audit": {
            "status": "PASS",
            "implementation_independent": independent["implementation_independent"],
            "sampled_rows": independent["sampled_primary_dimension_rows"],
            "restricted_run_invariance_rows": independent["restricted_run_invariance_rows"],
            "max_absolute_error": independent["maximum_absolute_error"],
            "event_disjointness": independent["event_disjointness"],
            "output_rows": audit["output_rows"],
            "category_profile_rows": audit["primary_category_profile_rows"],
            "profile_shards": PROFILE_SHARDS,
        },
        "provenance": {
            "experiment_manifest_sha256": digest(study / "artifact_manifest.json"),
            "pair_results_sha256": digest(study / "results/pair_results.csv.gz"),
            "category_profiles_sha256": digest(study / "results/primary_category_profiles.csv.gz"),
        },
    }

    if destination.exists():
        shutil.rmtree(destination)
    (destination / "profiles").mkdir(parents=True)
    (destination / "LICENSE-DATA.md").write_text(DATA_ATTRIBUTION)
    (destination / "study.json").write_text(json.dumps(payload, separators=(",", ":")))

    shards = {f"{index:02d}": {} for index in range(PROFILE_SHARDS)}
    for old_key, profiles in profile_map.items():
        key = old_to_profile_key.get(old_key)
        if key is not None:
            shards[profile_shard(key)][key] = profiles
    for shard, contents in shards.items():
        (destination / "profiles" / f"{shard}.json").write_text(
            json.dumps({"schema_version": 1, "profiles": contents}, separators=(",", ":"))
        )

    public_rows = []
    for pair in pairs:
        public_row = {
            "dimension": pair["dimension"], "pair_id": pair["id"],
            "model_a": pair["model_a"], "model_b": pair["model_b"],
            "prompt_a": pair["prompt_type_a"], "prompt_b": pair["prompt_type_b"],
            "information_a": pair["information_type_a"], "information_b": pair["information_type_b"],
            "same_model_version": pair["same_model_version"], "same_prompt": pair["same_prompt"],
            "same_information": pair["same_information"], "train_bi_gap": pair["train_gap"],
            "mean_train_bi": pair["mean_train_bi"], "uniform_row_category_coverage": pair["train_coverage"],
            "train_crossing": pair["crossing"], "train_category_complementarity": pair["train_between_norm"],
            "train_dataset_row_fraction": pair["train_origin_dataset_fraction"],
            "test_bi_a": pair["test_bi_a"], "test_bi_b": pair["test_bi_b"],
            "train_events": pair["train_events"], "test_events": pair["test_events"],
        }
        for method, _, _ in METHODS:
            value = pair["methods"][method]
            public_row[f"{method}_bi"] = value
            public_row[f"{method}_gain_vs_better_test_single_bi"] = (
                value - max(pair["test_bi_a"], pair["test_bi_b"])
                if None not in (value, pair["test_bi_a"], pair["test_bi_b"]) else None
            )
        public_rows.append(public_row)
    with (destination / "primary-pairs.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(public_rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(public_rows)

    requested = [row for row in summaries if row["coverage"] == 0.5 and row["cohort"] == "crossing"]
    with (destination / "requested_primary_results.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=summary_keys, lineterminator="\n")
        writer.writeheader()
        writer.writerows(requested)

    for name in ["REPORT.md", "PROTOCOL.md", "README.md", "REPRODUCE.md"]:
        shutil.copyfile(study / name, destination / name)
    shutil.copyfile(study / "results/independent_audit.json", destination / "independent_audit.json")
    shutil.copyfile(study / "artifact_manifest.json", destination / "experiment_manifest.json")

    exported = {}
    for path in sorted(destination.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            exported[str(path.relative_to(destination))] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    public_manifest = {
        "study": payload["study"],
        "generated_from_frozen_outputs": True,
        "weighting": payload["weighting"],
        "primary_method": payload["primary_method"],
        "methods": [method for method, _, _ in METHODS],
        "ability_thresholds": payload["ability_thresholds"],
        "pair_scopes": [scope["id"] for scope in payload["pair_scopes"]],
        "files": exported,
        "experiment_manifest_sha256": payload["provenance"]["experiment_manifest_sha256"],
    }
    (destination / "manifest.json").write_text(json.dumps(public_manifest, indent=2) + "\n")
    print(json.dumps({
        "destination": str(destination), "pairs": len(pairs),
        "profiles": sum(len(value) for value in profile_map.values()),
        "summaries": len(summaries), "directions": len(directions),
        "featured_pair_id": featured["id"],
        "study_json_bytes": (destination / "study.json").stat().st_size,
        "profile_bytes": sum(path.stat().st_size for path in (destination / "profiles").iterdir()),
    }, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--destination", type=Path, default=Path("site/public/data/complementarity"))
    args = parser.parse_args()
    export(args.study.resolve(), args.destination.resolve())


if __name__ == "__main__":
    main()
