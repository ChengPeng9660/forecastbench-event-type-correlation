"""Post-hoc no-reversal cohorts; reversed pairs use the training-overall model."""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import csv
import gzip
import json
import math
import multiprocessing
from pathlib import Path
import shutil
import time

import numpy as np

from analysis.type_selection import (ROOT, SEEDS, apply_router, brier, digest,
    event_weights, fit_router, in_scope, pair_id, predictions_for, split_rows, write_json)
from analysis.type_selection_mechanisms import (METHODS, LABELS, CONTRASTS,
    apply_controls, fit_controls, serialize, view_key)
from analysis.type_selection_calibrated_pooling import apply_pipeline, fit_pipeline
from analysis.type_selection_no_calibration import METHODS as POOL_METHODS, LABELS as POOL_LABELS

TOL = 1e-12
SCOPES = ("all", "complementary")
COHORTS = ("stable", "fallback", "all")
FLAGS = ("same_model_version", "same_prompt", "same_information")


def assess_stability(router, raw, y, events, types):
    """Test labels determine this retrospective grouping, never the fallback model."""
    routes = []
    reversed_types, missing_types = [], []
    for route in router["routes"]:
        mask = types == route["type"]
        n = len(np.unique(events[mask]))
        loss = brier(raw[mask], y[mask], events[mask]) if n else [None, None]
        status = "not_complementary"
        if route["complementary"]:
            if not n:
                status = "unverified"
                missing_types.append(route["type"])
            else:
                delta = loss[1-route["selected"]] - loss[route["selected"]]
                status = "reversed" if delta < -TOL else "tied" if abs(delta) <= TOL else "retained"
                if status == "reversed":
                    reversed_types.append(route["type"])
        routes.append({**route, "test_events": n, "test_brier_a": loss[0],
                       "test_brier_b": loss[1], "test_status": status})
    status = "reversed" if reversed_types else "unverified" if missing_types else "no_reversal"
    assert router["complementary"], "Only training-complementary pairs may enter this study"
    for route in routes:
        route["policy_selected"] = route["selected"] if status == "no_reversal" else router["fallback"]
    return {"status": status, "overall_choice": router["fallback"], "routes": routes,
            "reversed_types": reversed_types, "missing_types": missing_types}


def policy_choices(router, stability, raw, types):
    if stability["status"] == "no_reversal":
        return apply_router(router, raw, types)[2]
    return np.full(len(raw), router["fallback"], dtype=int)


def scores(pred, y, events):
    if not len(y):
        return {"events": 0, "targets": 0, "brier": None, "ece": None}
    bs = event_weights(events) @ (pred-y[:, None])**2
    ece = []
    for column in pred.T:
        bins = np.minimum((column*10).astype(int), 9)
        ece.append(float(np.abs(np.bincount(bins, weights=column-y, minlength=10)).sum()/len(y)))
    return {"events": len(np.unique(events)), "targets": len(y), "brier": bs.tolist(), "ece": ece}


def independent_score_error(pred, y, events, result):
    if not len(y):
        return 0.
    event_losses = [((pred[events == event]-y[events == event, None])**2).mean(axis=0)
                    for event in np.unique(events)]
    error = float(np.max(np.abs(np.mean(event_losses, axis=0)-result["brier"])))
    for k, column in enumerate(pred.T):
        value = 0.
        # Reproduce the archive's floating-point bin convention with scalar
        # operations, then independently average outcomes and probabilities.
        bins = np.array([min(9, math.floor(10*float(probability))) for probability in column])
        for low in range(10):
            mask = bins == low
            if mask.any():
                value += mask.mean()*abs(column[mask].mean()-y[mask].mean())
        error = max(error, abs(value-result["ece"][k]))
    return error


def initialize(study):
    global PANEL, MODELS, SPLITS
    panel = np.load(Path(study)/"data/panel.npz")
    PANEL = {key: panel[key] for key in ["predictions", "outcome", "event", "topic"]}
    MODELS = json.loads((Path(study)/"data/models.json").read_text())
    with (Path(study)/"data/events.csv").open() as f:
        catalog = [(r["source"], r["event_id"]) for r in csv.DictReader(f)]
    SPLITS = {seed: split_rows(catalog, PANEL["event"], seed) for seed in SEEDS}


def evaluate(task):
    number, record = task
    i, j, seed, fold = [int(record[k]) for k in ["i", "j", "split", "fold"]]
    p, y, events, types = [PANEL[k] for k in ["predictions", "outcome", "event", "topic"]]
    common = np.flatnonzero(np.isfinite(p[:, i]) & np.isfinite(p[:, j]))
    train, test = common[SPLITS[seed][common] == fold], common[SPLITS[seed][common] != fold]
    assert not np.intersect1d(events[train], events[test]).size
    assert min(len(np.unique(events[train])), len(np.unique(events[test]))) >= 100
    tr, te = p[train][:, [i, j]], p[test][:, [i, j]]
    router = fit_router(tr, y[train], events[train], types[train], [MODELS[i], MODELS[j]])
    assert router["crossing"] and abs(router["train_gap"]-record["train_gap"]) < 1e-9
    assert abs(router["train_coverage"]-record["train_coverage"]) < 1e-9
    stability = assess_stability(router, te, y[test], events[test], types[test])
    tc, ec = policy_choices(router, stability, tr, types[train]), policy_choices(router, stability, te, types[test])
    ts, to = tr[np.arange(len(train)), tc], tr[np.arange(len(train)), 1-tc]
    es, eo = te[np.arange(len(test)), ec], te[np.arange(len(test)), 1-ec]
    control = fit_controls(tr, ts, to, types[train], y[train], events[train])
    pipeline = fit_pipeline(tr, tc, y[train], events[train])
    raw, stages = apply_pipeline(pipeline, te, ec)
    pred = np.column_stack([raw[:, 0], raw[:, 2:6], apply_controls(control, te, es, eo, types[test])])
    masks = {"all": np.ones(len(test), bool), "complementary": np.isin(types[test], router["complementary"])}
    values, error = {}, 0.
    for scope, mask in masks.items():
        yy, ee = y[test][mask], events[test][mask]
        row = scores(pred[mask], yy, ee)
        row["pools"] = {"raw": scores(raw[mask], yy, ee),
                        **{mode: scores(stages[mode][0][mask], yy, ee) for mode in ["input", "output"]}}
        row["single_brier"] = scores(te[mask], yy, ee)["brier"]
        values[scope] = row
        if number % 97 == 0:
            error = max(error, independent_score_error(pred[mask], yy, ee, row))
            for mode, matrix in [("raw", raw), ("input", stages["input"][0]), ("output", stages["output"][0])]:
                error = max(error, independent_score_error(matrix[mask], yy, ee, row["pools"][mode]))
        if row["brier"] is not None:
            assert abs(row["brier"][0]-row["pools"]["raw"]["brier"][0]) < 1e-12
            assert abs(row["brier"][5]-row["pools"]["output"]["brier"][0]) < 1e-7
            if stability["status"] != "no_reversal":
                assert abs(row["brier"][0]-row["single_brier"][router["fallback"]]) < 1e-12
    max_gradient = max(*[control[m]["gradient"] for m in ["calibrated", "flexible", "joint"]],
                       *pipeline["input_audit"]["gradient"], *pipeline["output_audit"]["gradient"])
    row = {"id": pair_id(MODELS[i], MODELS[j]), "model_a": MODELS[i], "model_b": MODELS[j],
           # Preserve the frozen eligibility metadata exactly: recomputing a
           # boundary such as 0.5 can differ by one floating-point ulp.
           "split": seed, "fold": fold, "train_gap": float(record["train_gap"]), "train_coverage": float(record["train_coverage"]),
           **{k: bool(record[k]) for k in FLAGS}, "stability": stability["status"],
           "overall_choice": router["fallback"], "train_overall_brier": router["train_brier"],
           "routes": stability["routes"], "scopes": values,
           "audit": {"max_gradient": max_gradient, "independent_error": error, "independently_checked": number % 97 == 0}}
    if seed == SEEDS[0] and fold == 0:
        row["fit"] = {"control": control, "pipeline": pipeline}
    return serialize(row)


def empty():
    return {"pairs": 0, "events": 0., "targets": 0., "brier": np.zeros(10), "ece": np.zeros(10), "wins": np.zeros(5),
            "pools": {mode: {"pairs": 0, "events": 0., "targets": 0., "brier": np.zeros(10), "ece": np.zeros(10)} for mode in ["raw", "input", "output"]}}


def add(aggregate, row):
    if row["brier"] is None:
        return
    aggregate["pairs"] += 1
    for k in ["events", "targets", "brier", "ece"]:
        aggregate[k] += row[k]
    aggregate["wins"] += [row["brier"][a]-row["brier"][b] > 1e-10 for a, b in CONTRASTS]
    for mode, pool in aggregate["pools"].items():
        pool["pairs"] += 1
        for k in ["events", "targets", "brier", "ece"]:
            pool[k] += row["pools"][mode][k]


def finish(aggregate):
    n = aggregate["pairs"]
    return serialize({k: {mode: finish(pool) for mode, pool in v.items()} if k == "pools"
                      else v if k == "pairs" else v/n if n else None for k, v in aggregate.items()})


def export(study, destination, workers=4, limit=None):
    import pandas as pd
    started = time.monotonic()
    destination.mkdir(parents=True, exist_ok=True)
    protocol = ROOT/"docs/aggregation-stability-protocol.md"
    source = json.loads((ROOT/"site/public/data/type-selection/source-manifest.json").read_text())
    for name, expected in source["files"].items():
        assert digest(study/name) == expected, name
    source.update(protocol_sha256=digest(protocol), code_sha256=digest(Path(__file__)),
                  reused_code_hashes={name: digest(ROOT/"analysis"/name) for name in
                                     ["type_selection.py", "type_selection_mechanisms.py", "type_selection_no_calibration.py", "type_selection_calibrated_pooling.py"]})
    write_json(destination/"protocol-lock.json", {"protocol_sha256": digest(protocol), "started_at_unix": time.time()})
    columns = ["i", "j", "split", "fold", "dimension", "train_gap", "train_coverage", "train_groups", "crossing", *FLAGS]
    frozen = pd.read_csv(study/"results/pair_results.csv.gz", usecols=columns)
    frozen = frozen[(frozen.dimension == "topic") & frozen.crossing & (frozen.train_gap <= 5)
                    & (frozen.train_groups >= 2) & (frozen.train_coverage >= .5)].sort_values(["split", "fold", "i", "j"])
    if limit:
        frozen = frozen.head(limit)
    records = list(enumerate(frozen.to_dict("records")))
    parent = ROOT/"site/public/data/aggregation-decision-pairs"
    old_index = json.loads((parent/"index.json").read_text())
    old = {p["id"]: json.loads((parent/"pairs"/f'{p["id"][2:4]}.json').read_text())[p["id"]] for p in old_index["pairs"]}
    filters = [(gap, coverage, identity) for gap in [3, 5] for coverage in [.5, .6, .7, .8]
               for identity in ["all", "different_model_version", "matched_conditions"]]
    aggregates, counts, primary, directions = {}, {}, {}, {}
    audit = {"status": "RUNNING", "pair_directions": 0, "primary_pairs": 0, "independent_directions": 0,
             "max_independent_error": 0., "max_gradient": 0., "max_unchanged_error": 0.,
             "test_outcomes_used_for_grouping": True, "fallback_model_selected_on": "training_overall_brier",
             "coefficient_fitting_labels": "training_only", "counts": {s: 0 for s in ["no_reversal", "reversed", "unverified"]}}
    executor = ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context("spawn"), initializer=initialize, initargs=(str(study),))
    with executor, gzip.open(destination/"all-direction-results.jsonl.gz", "wt") as output, gzip.open(destination/"primary-fits.json.gz", "wt") as fits:
        fits.write("[")
        first_fit = True
        for number, row in enumerate(executor.map(evaluate, records, chunksize=8), 1):
            check = row.pop("audit")
            for key in ["max_gradient"]:
                audit[key] = max(audit[key], check[key])
            audit["max_independent_error"] = max(audit["max_independent_error"], check["independent_error"])
            audit["independent_directions"] += check["independently_checked"]
            audit["pair_directions"] += 1
            audit["counts"][row["stability"]] += 1
            pid, seed, fold = row["id"], row["split"], row["fold"]
            if "fit" in row:
                if not first_fit:
                    fits.write(",")
                json.dump({"id": pid, **row.pop("fit")}, fits, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                first_fit = False
            output.write(json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":"))+"\n")
            directions.setdefault(pid, []).append({k: row[k] for k in ["split", "fold", "train_gap", "train_coverage", "stability", "overall_choice"]} | {
                "scopes": {scope: {"events": r["events"], "targets": r["targets"], "brier": [r["brier"][m] for m in [0, 5, 6, 7]] if r["brier"] else [None]*4}
                           for scope, r in row["scopes"].items()}})
            if seed == SEEDS[0] and fold == 0:
                original = old[pid]
                for scope in SCOPES:
                    for metric in ["brier", "ece"]:
                        for mode in ["raw", "input", "output"]:
                            indices = range(10) if row["stability"] == "no_reversal" else range(2, 6)
                            error = max(abs(row["scopes"][scope]["pools"][mode][metric][m]-original["scopes"][scope]["pools"][mode][metric][m]) for m in indices)
                            audit["max_unchanged_error"] = max(audit["max_unchanged_error"], error)
                        if row["stability"] == "no_reversal":
                            audit["max_unchanged_error"] = max(audit["max_unchanged_error"], max(abs(a-b) for a, b in zip(row["scopes"][scope][metric], original["scopes"][scope][metric])))
                primary[pid] = row
            group = "stable" if row["stability"] == "no_reversal" else "fallback"
            for gap, coverage, identity in filters:
                if row["train_gap"] <= gap+TOL and row["train_coverage"] >= coverage and in_scope(row, identity):
                    key = seed, fold, view_key(gap, coverage, identity)
                    counts.setdefault(key, {s: 0 for s in ["no_reversal", "reversed", "unverified"]})[row["stability"]] += 1
                    for cohort in [group, "all"]:
                        a = aggregates.setdefault((*key, cohort), {scope: empty() for scope in SCOPES})
                        for scope in SCOPES:
                            add(a[scope], row["scopes"][scope])
            if number % 250 == 0 or number == len(records):
                print(f'{number}/{len(records)} directions · {time.monotonic()-started:.1f}s · {audit["counts"]}', flush=True)
        fits.write("]")
    assert audit["max_independent_error"] < 1e-9 and audit["max_gradient"] < 1e-7
    assert audit["max_unchanged_error"] < 1e-7
    if not limit:
        assert set(primary) == set(old)
    shards, metadata = {}, []
    for pid, row in primary.items():
        row["directions"] = directions[pid]
        shards.setdefault(pid[2:4], {})[pid] = row
        metadata.append({k: row[k] for k in ["id", "model_a", "model_b", "train_gap", "train_coverage", *FLAGS, "stability", "overall_choice"]})
    (destination/"pairs").mkdir(exist_ok=True)
    for shard, rows in shards.items():
        write_json(destination/"pairs"/f"{shard}.json", rows)
    (destination/"views").mkdir(exist_ok=True)
    reconstructed = 0
    for gap, coverage, identity in filters:
        key = view_key(gap, coverage, identity)
        view = {"key": key, "gap": gap, "coverage": coverage, "pair_scope": identity, "cohorts": {}}
        for cohort in COHORTS:
            dd = []
            for seed in SEEDS:
                for fold in [0, 1]:
                    a = aggregates.get((seed, fold, key, cohort), {s: empty() for s in SCOPES})
                    dd.append({"split": seed, "fold": fold, "scopes": {s: finish(a[s]) for s in SCOPES}})
            view["cohorts"][cohort] = {"primary": dd[0], "directions": dd}
            eligible = [p for p in primary.values() if p["train_gap"] <= gap+TOL and p["train_coverage"] >= coverage and in_scope(p, identity)
                        and (cohort == "all" or (p["stability"] == "no_reversal") == (cohort == "stable"))]
            for scope in SCOPES:
                rows = [p["scopes"][scope] for p in eligible if p["scopes"][scope]["brier"]]
                target = dd[0]["scopes"][scope]
                assert len(rows) == target["pairs"]
                if rows:
                    for mode in [None, "raw", "input", "output"]:
                        for metric in ["brier", "ece"]:
                            rr = [r if mode is None else r["pools"][mode] for r in rows]
                            tt = target if mode is None else target["pools"][mode]
                            np.testing.assert_allclose(np.mean([r[metric] for r in rr], axis=0), tt[metric], atol=1e-12, rtol=0)
                            reconstructed += 10
        view["counts"] = counts.get((SEEDS[0], 0, key), {s: 0 for s in ["no_reversal", "reversed", "unverified"]})
        write_json(destination/"views"/f"{key}.json", view)
    audit.update(status="SMOKE" if limit else "PASS", primary_pairs=len(primary), reconstructed_primary_scores=reconstructed,
                 elapsed_seconds=round(time.monotonic()-started, 2))
    write_json(destination/"index.json", {"schema_version": 1, "post_hoc": True, "date": "2026-09-08", "primary_split": SEEDS[0], "primary_fold": 0,
        "mechanism_methods": METHODS, "method_labels": LABELS, "pool_methods": POOL_METHODS, "pool_labels": POOL_LABELS,
        "views": [view_key(*f) for f in filters], "pairs": sorted(metadata, key=lambda p: (p["model_a"], p["model_b"])), "audit": audit})
    write_json(destination/"audit.json", audit)
    write_json(destination/"source-manifest.json", source)
    shutil.copyfile(protocol, destination/"PROTOCOL.md")
    default = json.loads((destination/"views/gap3-coverage50-all.json").read_text())
    lines = ["# No-reversal pairs and training-overall fallback", "", "Post-hoc analysis: test outcomes determine reversal status; the fallback model and all coefficients use training data only.",
             "", "Only pairs with crossed training event-type advantages are eligible. No unrelated LLM pairs are added.", "", f'Primary eligible cohort counts: {default["counts"]}.', "",
             "| Cohort | Test scope | Pairs | Selection Brier | Simple mean Brier | Strong single | Matched aggregation |", "|---|---|---:|---:|---:|---:|---:|"]
    for cohort in COHORTS:
        for scope in SCOPES:
            r = default["cohorts"][cohort]["primary"]["scopes"][scope]
            values = [f'{r["brier"][m]:.6f}' if r["brier"] else "—" for m in [0, 1, 6, 7]]
            lines.append(f'| {cohort} | {scope} | {r["pairs"]} | '+" | ".join(values)+" |")
    lines += ["", "Brier: targets averaged within each event, then equal events, then equal pairs. ECE: target-weighted ten-bin calibration error.",
              "", "A type tie is not a reversal. A missing test type is unverified and uses the overall fallback. Neither qualifies as evidence of strictly positive held-out advantage.",
              "", "No significance claim or prospective generalization claim is made from this test-conditioned grouping."]
    (destination/"REPORT.md").write_text("\n".join(lines)+"\n")
    print(json.dumps(audit), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT/"site/public/data/aggregation-stability")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    export(args.study, args.output, args.workers, args.limit)
