"""Publish pair and event-type views of frozen aggregation results without fitting."""

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

from analysis.type_selection import event_weights, split_rows
from analysis.typewise_matched_aggregation import METHOD_VERSION, PROTOCOL_VERSION, method_predictions

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site/public/data"
METHODS = ["type_selection", "global_joint", "event_type_joint"]
EVENT_TYPE_METHODS = ["model_a", "model_b", "global_joint", "event_type_joint"]


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")


def score_columns(predictions, outcomes, events):
    """Match the frozen event-equal Brier and target-weighted ECE definitions."""
    weights = event_weights(events)
    brier = weights @ ((predictions - outcomes[:, None]) ** 2)
    ece = []
    for column in predictions.T:
        bins = np.minimum((column * 10).astype(int), 9)
        signed = np.bincount(bins, weights=column - outcomes, minlength=10)
        ece.append(float(np.abs(signed).sum() / len(outcomes)))
    return {"brier": brier.tolist(), "ece": ece}


def load_reconstruction_source(destination, index):
    manifest = read(destination / "source-manifest.json")
    study = Path(manifest["source_root"])
    required = ["data/panel.npz", "data/models.json", "data/events.csv"]
    for name in required:
        assert digest(study / name) == manifest["files"][name], name
    panel_file = np.load(study / "data/panel.npz")
    panel = {key: panel_file[key] for key in ["predictions", "outcome", "event", "topic"]}
    models = read(study / "data/models.json")
    assert len(models) == len(set(models)) == panel["predictions"].shape[1]
    with (study / "data/events.csv").open() as stream:
        catalog = [(row["source"], row["event_id"]) for row in csv.DictReader(stream)]
    folds = split_rows(catalog, panel["event"], index["primary_split"])
    return study, panel, {name: number for number, name in enumerate(models)}, folds, required


def reconstruct_event_types(row, parent, stable_parent, panel, model_indices, folds, primary):
    """Score four frozen predictions separately on each complementary test type."""
    predictions, outcomes, events, types = [panel[key] for key in
                                            ["predictions", "outcome", "event", "topic"]]
    i, j = model_indices[row["model_a"]], model_indices[row["model_b"]]
    common = np.flatnonzero(np.isfinite(predictions[:, i]) & np.isfinite(predictions[:, j]))
    test = common[folds[common] != primary[1]]
    singles = predictions[test][:, [i, j]]
    outcomes, events, types = outcomes[test], events[test], types[test]

    routes = {route["type"]: route for route in parent["routes"]}
    fallback_choices = {route["selected"] for route in parent["routes"] if route["fallback"]}
    if fallback_choices:
        assert len(fallback_choices) == 1
        fallback = next(iter(fallback_choices))
    else:
        train = common[folds[common] == primary[1]]
        train_singles = predictions[train][:, [i, j]]
        loss = event_weights(panel["event"][train]) @ (
            (train_singles - panel["outcome"][train, None]) ** 2)
        fallback = int(np.argmin(loss))
        if abs(loss[0] - loss[1]) <= 1e-12:
            fallback = min(range(2), key=lambda side: (row[f"model_{'ab'[side]}"].casefold(),
                                                       row[f"model_{'ab'[side]}"]))
    choices = np.asarray([routes.get(str(group), {"selected": fallback})["selected"]
                          for group in types], dtype=int)
    selected = singles[np.arange(len(singles)), choices]
    other = singles[np.arange(len(singles)), 1 - choices]
    joint = method_predictions(selected, other, types, row["fit"])
    displayed = np.column_stack([singles, joint[:, 1], joint[:, 2]])

    maximum_error = 0.0
    comparisons = 0
    complementary = [route["type"] for route in parent["routes"] if route["complementary"]]
    masks = {"all": np.ones(len(test), dtype=bool),
             "complementary": np.isin(types, complementary)}
    for scope, mask in masks.items():
        reconstructed = score_columns(joint[mask], outcomes[mask], events[mask])
        assert len(np.unique(events[mask])) == row["scopes"][scope]["events"]
        assert int(mask.sum()) == row["scopes"][scope]["targets"]
        for metric in ["brier", "ece"]:
            error = float(np.max(np.abs(np.asarray(reconstructed[metric]) -
                                        np.asarray(row["scopes"][scope][metric]))))
            assert error < 1e-12, (row["id"], scope, metric, error)
            maximum_error = max(maximum_error, error)
            comparisons += len(METHODS)

    stable_routes = {route["type"]: route for route in stable_parent["routes"]} if stable_parent else {}
    result = {}
    for group in complementary:
        mask = types == group
        assert mask.any(), (row["id"], group)
        scores = score_columns(displayed[mask], outcomes[mask], events[mask])
        values = {
            "events": int(len(np.unique(events[mask]))),
            "targets": int(mask.sum()),
            **scores,
        }
        stable_route = stable_routes.get(group)
        if stable_route:
            assert values["events"] == stable_route["test_events"]
            for side in range(2):
                error = abs(values["brier"][side] - stable_route[f"test_brier_{'ab'[side]}"])
                assert error < 1e-12, (row["id"], group, side, error)
                maximum_error = max(maximum_error, error)
                comparisons += 1
        result[group] = values

    assert sum(value["events"] for value in result.values()) == row["scopes"]["complementary"]["events"]
    assert sum(value["targets"] for value in result.values()) == row["scopes"]["complementary"]["targets"]
    event_count = row["scopes"]["complementary"]["events"]
    for source, method in [(0, None), (2, 1), (3, 2)]:
        if source == 0:
            reconstructed = sum(value["events"] * value["brier"][
                routes[group]["selected"]] for group, value in result.items()) / event_count
        else:
            reconstructed = sum(value["events"] * value["brier"][source]
                                for value in result.values()) / event_count
        error = abs(reconstructed - row["scopes"]["complementary"]["brier"][method or 0])
        assert error < 1e-12, (row["id"], "complementary", source, error)
        maximum_error = max(maximum_error, error)
        comparisons += 1
    return result, maximum_error, comparisons


def export(destination=None):
    destination = Path(destination) if destination is not None else DATA / "typewise-matched-aggregation"
    index = read(destination / "index.json")
    assert index["method_version"] == METHOD_VERSION
    assert index["audit"]["status"] == "PASS" and index["audit"]["train_only_coefficients"]
    assert index["methods"] == METHODS
    primary = (index["primary_split"], index["primary_fold"])
    parent_indices = {name: read(DATA / name / "index.json") for name in
                      ["aggregation-decision-pairs", "aggregation-stability"]}
    for parent in parent_indices.values():
        assert (parent["primary_split"], parent["primary_fold"]) == primary
    parents = {}
    shards = defaultdict(dict)
    maximum_error = 0.0
    maximum_reconstruction_error = 0.0
    comparisons = 0
    reconstructed_scores = 0
    reconstructed_types = 0
    metadata = ["id", "model_a", "model_b", "train_gap", "train_coverage",
                "same_model_version", "same_prompt", "same_information"]
    source = destination / "all-direction-results.jsonl.gz"
    study, panel, model_indices, folds, reconstruction_files = load_reconstruction_source(destination, index)
    with gzip.open(source, "rt") as stream:
        for line in stream:
            row = json.loads(line)
            if (row["split"], row["fold"]) != primary:
                continue
            pair_id = row["id"]
            shard = pair_id[2:4]
            assert pair_id not in shards[shard]
            for name in parent_indices:
                if name == "aggregation-stability" and row["stability"] != "no_reversal":
                    continue
                key = (name, shard)
                if key not in parents:
                    parents[key] = read(DATA / name / "pairs" / f"{shard}.json")
                parent = parents[key][pair_id]
                assert all(parent[field] == row[field] for field in metadata), pair_id
                if name == "aggregation-stability":
                    assert parent["stability"] == row["stability"]
                for scope in ["all", "complementary"]:
                    scores = row["scopes"][scope]
                    baseline = parent["scopes"][scope]["pools"]["raw"]
                    assert all(scores[field] == baseline[field] for field in ["events", "targets"])
                    for metric in ["brier", "ece"]:
                        assert len(scores[metric]) == 3 and all(map(math.isfinite, scores[metric]))
                        for method, baseline_method in [(0, 0), (1, 7)]:
                            error = abs(scores[metric][method] - baseline[metric][baseline_method])
                            assert error < 1e-12, (pair_id, scope, metric, error)
                            maximum_error = max(maximum_error, error)
                            comparisons += 1
            original_parent = parents[("aggregation-decision-pairs", shard)][pair_id]
            stable_shard = parents.get(("aggregation-stability", shard))
            stable_parent = stable_shard.get(pair_id) if stable_shard else None
            event_types, error, checked = reconstruct_event_types(
                row, original_parent, stable_parent, panel, model_indices, folds, primary)
            maximum_reconstruction_error = max(maximum_reconstruction_error, error)
            reconstructed_scores += checked
            reconstructed_types += len(event_types)
            shards[shard][pair_id] = {
                **{field: row[field] for field in metadata + ["stability"]},
                "scopes": {scope: {field: scores[field] for field in ["events", "targets", "brier", "ece"]}
                           for scope, scores in row["scopes"].items()},
                "event_types": event_types,
            }
    ids = {pair_id for shard in shards.values() for pair_id in shard}
    assert len(ids) == index["audit"]["primary_pairs"]
    for parent in parent_indices.values():
        assert ids == {row["id"] for row in parent["pairs"]}
    outputs = {}
    for shard, pairs in sorted(shards.items()):
        path = destination / "pairs" / f"{shard}.json"
        write(path, {"schema_version": 2, "method_version": METHOD_VERSION,
                     "protocol_version": PROTOCOL_VERSION, "methods": METHODS,
                     "event_type_methods": EVENT_TYPE_METHODS,
                     "primary_split": primary[0], "primary_fold": primary[1],
                     "source_audit_status": "PASS", "pairs": pairs})
        outputs[str(path.relative_to(destination))] = digest(path)
    inputs = [source, destination / "index.json", destination / "audit.json",
              destination / "source-manifest.json"]
    manifest = {
        "schema_version": 2, "method_version": METHOD_VERSION,
        "protocol_version": PROTOCOL_VERSION, "validation_status": "PASS", "primary_pairs": len(ids),
        "export_only": True, "fitting_performed": False, "test_scores_reconstructed": True,
        "event_type_methods": EVENT_TYPE_METHODS, "reconstructed_pair_types": reconstructed_types,
        "validated_parent_scores": comparisons, "validated_reconstructed_scores": reconstructed_scores,
        "max_parent_score_error": maximum_error,
        "max_reconstruction_error": maximum_reconstruction_error,
        "source_sha256": {"typewise-matched-aggregation/" + str(path.relative_to(destination)): digest(path)
                          for path in inputs},
        "reconstruction_source_sha256": {
            str(path.relative_to(study)): digest(path)
            for path in [study / name for name in reconstruction_files]
        },
        "exporter_sha256": digest(Path(__file__)), "shards_sha256": outputs,
    }
    write(destination / "pair-scores-manifest.json", manifest)
    print(json.dumps({key: value for key, value in manifest.items() if not key.endswith("sha256")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", type=Path,
                        help="Audited typewise build directory; defaults to the website data directory")
    args = parser.parse_args()
    export(args.destination)
