"""Package already published pair scores for the UI; never refit or rescore forecasts."""
from pathlib import Path
import csv
import gzip
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1] / "public/data"
OUT = ROOT / "aggregation-decision-pairs"
SCOPES = ("all", "complementary")
METHODS = ("type_selection", "calibrated_selection", "flexible_selection", "joint_model")
sources = {}


def read(name):
    path = ROOT / name
    sources[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    with (gzip.open(path, "rt") if name.endswith(".gz") else path.open()) as stream:
        return json.load(stream)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")


def scores(row):
    return {k: row[k] for k in ("events", "targets", "brier", "ece")}


def eligible(pair, gap, coverage, scope):
    return (pair["train_gap"] <= gap + 1e-12 and pair["train_coverage"] >= coverage
            and (scope == "all" or scope == "different_model_version" and not pair["same_model_version"]
                 or scope == "matched_conditions" and pair["same_prompt"] and pair["same_information"]))


def main():
    mechanism_index = read("type-selection-mechanisms/index.json")
    raw_index = read("type-selection-no-calibration/index.json")
    cal_index = read("type-selection-calibrated-pooling/index.json")
    assert all(v["audit"]["status"] == "PASS" for v in (mechanism_index, raw_index, cal_index))
    assert raw_index["methods"] == cal_index["methods"]
    assert [mechanism_index["methods"][i] for i in (0, 5, 6, 7)] == list(METHODS)
    raw = {v["id"]: v for v in read("type-selection-no-calibration/primary-pair-results.json.gz")}
    calibrated = {v["id"]: v for v in read("type-selection-calibrated-pooling/primary-pair-results.json.gz")}
    routing = {v["id"]: v for v in read("type-selection/study.json")["pairs"]}
    pairs = {}
    for source in read("type-selection-mechanisms/primary-pair-diagnostics.json.gz"):
        pid = source["id"]
        assert pid in raw and pid in calibrated and pid in routing
        assert (source["split"], source["fold"]) == (mechanism_index["primary_split"], mechanism_index["primary_fold"])
        meta = {k: source[k] for k in ("id", "train_gap", "train_coverage", "same_model_version", "same_prompt", "same_information")}
        for other in (raw[pid], calibrated[pid], routing[pid]):
            assert all(other[k] == source[k] for k in (*meta.keys(), "i", "j", "split", "fold"))
        pair = {**meta, "scopes": {}, "directions": [], "routes": routing[pid]["routes"]}
        for scope in SCOPES:
            m, r = source["scopes"][scope], raw[pid]["scopes"][scope]
            stages = {s: calibrated[pid]["stages"][s][scope] for s in ("input", "output")}
            route = routing[pid]["scopes"][scope]
            for other in (r, *stages.values(), route):
                assert (other["events"], other["targets"]) == (m["events"], m["targets"])
            assert math.isclose(m["brier"][0], r["brier"][0], abs_tol=1e-12)
            assert math.isclose(m["brier"][0], route["scores"]["brier"][0], abs_tol=1e-12)
            # Separate published solver runs can differ below 1e-8; retain both exact values.
            assert math.isclose(m["brier"][5], stages["output"]["brier"][0], rel_tol=0, abs_tol=1e-8)
            pair["scopes"][scope] = {**scores(m), "pools": {"raw": scores(r), **{s: scores(v) for s, v in stages.items()}},
                                     "single_brier": route["scores"]["brier"][5:7]}
        pairs[pid] = pair
    assert set(pairs) == set(raw) == set(calibrated) == set(routing)

    # Read the existing scores, preserving each split's own training eligibility.
    name = "type-selection-mechanisms/all-direction-scores.csv.gz"
    sources[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    directions = {}
    with gzip.open(ROOT / name, "rt") as stream:
        for row in csv.DictReader(stream):
            pid = row["pair_id"]
            if pid not in pairs or row["method"] not in METHODS:
                continue
            pair = pairs[pid]
            names = (row["model_a"], row["model_b"])
            if "model_a" in pair:
                assert (pair["model_a"], pair["model_b"]) == names
            pair["model_a"], pair["model_b"] = names
            key = pid, int(row["split"]), int(row["train_fold"])
            d = directions.setdefault(key, {"split": key[1], "fold": key[2], "train_gap": float(row["train_gap"]),
                                            "train_coverage": float(row["train_coverage"]), "scopes": {}})
            s = d["scopes"].setdefault(row["test_scope"], {"events": int(row["events"]), "targets": int(row["targets"]), "brier": [None] * 4})
            s["brier"][METHODS.index(row["method"])] = float(row["brier"]) if row["brier"] else None
    for (pid, _, _), d in sorted(directions.items()):
        assert all(scope in d["scopes"] for scope in SCOPES)
        pairs[pid]["directions"].append(d)
    for pair in pairs.values():
        primary = next(d for d in pair["directions"] if (d["split"], d["fold"]) == (mechanism_index["primary_split"], mechanism_index["primary_fold"]))
        for scope in SCOPES:
            assert primary["scopes"][scope]["brier"] == [pair["scopes"][scope]["brier"][i] for i in (0, 5, 6, 7)]

    # All 24 published primary means must reconstruct from the packaged exact pairs.
    comparisons = 0
    for key in mechanism_index["views"]:
        view = json.loads((ROOT / f"type-selection-mechanisms/views/{key}.json").read_text())
        cohort = [p for p in pairs.values() if eligible(p, view["gap"], view["coverage"], view["pair_scope"])]
        for folder, mode in (("type-selection-mechanisms", None), ("type-selection-no-calibration", "raw"),
                             ("type-selection-calibrated-pooling", "input"), ("type-selection-calibrated-pooling", "output")):
            published = json.loads((ROOT / f"{folder}/views/{key}.json").read_text())["primary"]
            for scope in SCOPES:
                target = published["stages"][mode][scope] if mode in ("input", "output") else published["scopes"][scope]
                assert len(cohort) == target["pairs"]
                if not cohort:
                    continue
                for metric in ("brier", "ece"):
                    for i, expected in enumerate(target[metric]):
                        rows = [p["scopes"][scope] if mode is None else p["scopes"][scope]["pools"][mode] for p in cohort]
                        actual = math.fsum(r[metric][i] for r in rows) / len(rows)
                        assert math.isclose(actual, expected, abs_tol=1e-12), (key, mode, scope, metric, i)
                        comparisons += 1

    shards = {}
    metadata = []
    for pair in sorted(pairs.values(), key=lambda p: (p["model_a"], p["model_b"])):
        shard = pair["id"][2:4]
        shards.setdefault(shard, {})[pair["id"]] = pair
        metadata.append({k: pair[k] for k in ("id", "model_a", "model_b", "train_gap", "train_coverage", "same_model_version", "same_prompt", "same_information")})
    for shard, rows in shards.items():
        write(OUT / f"pairs/{shard}.json", rows)
    write(OUT / "index.json", {"schema_version": 1, "primary_split": mechanism_index["primary_split"], "primary_fold": mechanism_index["primary_fold"],
                               "mechanism_methods": mechanism_index["methods"], "pool_methods": raw_index["methods"],
                               "pool_labels": raw_index["method_labels"], "pairs": metadata})
    write(OUT / "provenance.json", {"operation": "Copy published scores and routing maps; no fitting or rescoring", "source_sha256": sources,
                                    "pairs": len(pairs), "shards": len(shards), "validated_primary_mean_scores": comparisons})
    print(f"Packaged {len(pairs)} pairs in {len(shards)} shards; {comparisons} published mean scores verified.")


if __name__ == "__main__":
    main()
