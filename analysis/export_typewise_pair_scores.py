"""Publish per-pair views of frozen event-type results without fitting or rescoring."""

import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site/public/data"
METHODS = ["type_selection", "global_joint", "event_type_joint"]


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")


def export():
    destination = DATA / "typewise-matched-aggregation"
    index = read(destination / "index.json")
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
    comparisons = 0
    metadata = ["id", "model_a", "model_b", "train_gap", "train_coverage",
                "same_model_version", "same_prompt", "same_information"]
    source = destination / "all-direction-results.jsonl.gz"
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
            shards[shard][pair_id] = {
                **{field: row[field] for field in metadata + ["stability"]},
                "scopes": {scope: {field: scores[field] for field in ["events", "targets", "brier", "ece"]}
                           for scope, scores in row["scopes"].items()},
            }
    ids = {pair_id for shard in shards.values() for pair_id in shard}
    assert len(ids) == index["audit"]["primary_pairs"]
    for parent in parent_indices.values():
        assert ids == {row["id"] for row in parent["pairs"]}
    outputs = {}
    for shard, pairs in sorted(shards.items()):
        path = destination / "pairs" / f"{shard}.json"
        write(path, {"schema_version": 1, "methods": METHODS, "primary_split": primary[0],
                     "primary_fold": primary[1], "source_audit_status": "PASS", "pairs": pairs})
        outputs[str(path.relative_to(destination))] = digest(path)
    inputs = [source, destination / "index.json", destination / "audit.json",
              destination / "source-manifest.json"]
    manifest = {
        "schema_version": 1, "validation_status": "PASS", "primary_pairs": len(ids),
        "export_only": True, "validated_parent_scores": comparisons,
        "max_parent_score_error": maximum_error,
        "source_sha256": {str(path.relative_to(DATA)): digest(path) for path in inputs},
        "exporter_sha256": digest(Path(__file__)), "shards_sha256": outputs,
    }
    write(destination / "pair-scores-manifest.json", manifest)
    print(json.dumps({key: value for key, value in manifest.items() if not key.endswith("sha256")}))


if __name__ == "__main__":
    export()
