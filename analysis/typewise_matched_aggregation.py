"""Train-only, event-type-specific matched aggregation on the frozen Atlas panel."""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import csv
import gzip
import json
import multiprocessing
from pathlib import Path
import shutil
import time

import numpy as np

from analysis.aggregation_stability import assess_stability
from analysis.type_selection import (
    ROOT, SEEDS, apply_router, digest, event_weights, fit_router, in_scope,
    pair_id, split_rows, write_json,
)
from analysis.type_selection_mechanisms import TYPES, logit, serialize, sigmoid, view_key
from analysis.type_selection_no_calibration import fit_weights


METHODS = ("type_selection", "global_joint", "event_type_joint")
LABELS = ("Raw type selection", "Global matched aggregation", "Event-type matched aggregation")
SCOPES = ("all", "complementary")
COHORTS = ("all", "no_reversal", "reversed_or_unverified")
FLAGS = ("same_model_version", "same_prompt", "same_information")
RIDGE = 0.005
TOL = 1e-12
N = len(METHODS)


def _fit_group_coefficients(z, x, y, weights, codes, count):
    """Jointly solve separable one-dimensional ridge-logistic objectives."""
    beta = np.zeros(count)

    def objective(value):
        linear = z + value[codes] * x
        return float(weights @ (np.logaddexp(0, linear) - y * linear) + .5 * RIDGE * (value @ value))

    for iteration in range(100):
        q = sigmoid(z + beta[codes] * x)
        gradient = np.bincount(codes, weights=weights * x * (q - y), minlength=count) + RIDGE * beta
        if float(np.max(np.abs(gradient))) < 1e-11:
            break
        hessian = np.bincount(codes, weights=weights * x * x * q * (1 - q), minlength=count) + RIDGE
        step = np.clip(gradient / hessian, -20, 20)
        old = objective(beta)
        scale = 1.0
        for _ in range(40):
            candidate = beta - scale * step
            if objective(candidate) <= old - 1e-4 * scale * float(gradient @ step) + 1e-15:
                break
            scale /= 2
        beta = candidate
    q = sigmoid(z + beta[codes] * x)
    gradient = np.bincount(codes, weights=weights * x * (q - y), minlength=count) + RIDGE * beta
    residual = float(np.max(np.abs(gradient)))
    assert residual < 1e-8, f"Typewise solver did not converge: {residual}"
    return beta, residual, iteration + 1, objective(beta)


def fit_typewise_weights(selected, other, outcomes, events, types, router):
    """Fit one coefficient per supported training type and one pooled fallback."""
    global_fit = fit_weights(selected, other, outcomes, events)
    supported = sorted(route["type"] for route in router["routes"] if route["train_events"] >= 30)
    supported_index = {group: index for index, group in enumerate(supported)}
    fallback_mask = ~np.isin(types, supported)
    has_fallback = bool(fallback_mask.any())
    count = len(supported) + int(has_fallback)
    assert count > 0
    fallback_code = len(supported)
    codes = np.array([supported_index.get(str(group), fallback_code) for group in types], dtype=int)
    weights = event_weights(events)
    z = logit(selected)
    x = (logit(other) - z) / 4
    beta, residual, iterations, objective = _fit_group_coefficients(
        z, x, outcomes, weights, codes, count)
    type_betas = {group: float(beta[index]) for group, index in supported_index.items()}
    if has_fallback:
        fallback_beta = float(beta[fallback_code])
        fallback_source = "pooled"
    else:
        fallback_beta = float(4 * global_fit["log_weight"])
        fallback_source = "global"
    return {
        "global_log_weight": float(global_fit["log_weight"]),
        "global_beta": float(4 * global_fit["log_weight"]),
        "global_gradient": float(global_fit["gradient"]),
        "supported_types": supported,
        "type_betas": type_betas,
        "type_log_weights": {group: value / 4 for group, value in type_betas.items()},
        "fallback_beta": fallback_beta,
        "fallback_log_weight": fallback_beta / 4,
        "fallback_source": fallback_source,
        "typewise_gradient": residual,
        "iterations": iterations,
        "objective": objective,
    }


def apply_typewise(selected, other, types, fit):
    z = logit(selected)
    difference = logit(other) - z
    mapping = fit["type_log_weights"]
    fallback = fit["fallback_log_weight"]
    weights = np.array([mapping.get(str(group), fallback) for group in types])
    return sigmoid(z + weights * difference)


def method_predictions(selected, other, types, fit):
    z = logit(selected)
    global_joint = sigmoid(z + fit["global_log_weight"] * (logit(other) - z))
    return np.column_stack([selected, global_joint, apply_typewise(selected, other, types, fit)])


def score_scope(predictions, duplicate, outcomes, events):
    if not len(outcomes):
        return None
    weights = event_weights(events)
    brier = weights @ ((predictions - outcomes[:, None]) ** 2)
    duplicate_brier = weights @ ((duplicate - outcomes[:, None]) ** 2)
    ece = []
    for column in predictions.T:
        bins = np.minimum((column * 10).astype(int), 9)
        ece.append(float(np.abs(np.bincount(bins, weights=column - outcomes, minlength=10)).sum() / len(outcomes)))
    return {
        "events": int(len(np.unique(events))),
        "targets": int(len(outcomes)),
        "brier": brier,
        "ece": np.asarray(ece),
        "duplicate_brier": duplicate_brier,
        "wins_vs_selection": (brier[0] - brier > 1e-10).astype(float),
        "wins_vs_global": (brier[1] - brier > 1e-10).astype(float),
        "duplicate_wins": (duplicate_brier - brier > 1e-10).astype(float),
    }


def initialize(study):
    global PANEL, MODELS, SPLITS
    panel = np.load(Path(study) / "data/panel.npz")
    PANEL = {key: panel[key] for key in ["predictions", "outcome", "event", "topic"]}
    MODELS = json.loads((Path(study) / "data/models.json").read_text())
    with (Path(study) / "data/events.csv").open() as stream:
        catalog = [(row["source"], row["event_id"]) for row in csv.DictReader(stream)]
    SPLITS = {seed: split_rows(catalog, PANEL["event"], seed) for seed in SEEDS}


def evaluate(task):
    number, record = task
    i, j, seed, fold = [int(record[key]) for key in ["i", "j", "split", "fold"]]
    p, y, events, types = [PANEL[key] for key in ["predictions", "outcome", "event", "topic"]]
    common = np.flatnonzero(np.isfinite(p[:, i]) & np.isfinite(p[:, j]))
    train = common[SPLITS[seed][common] == fold]
    test = common[SPLITS[seed][common] != fold]
    assert not np.intersect1d(events[train], events[test]).size
    tr, te = p[train][:, [i, j]], p[test][:, [i, j]]
    router = fit_router(tr, y[train], events[train], types[train], [MODELS[i], MODELS[j]])
    assert router["crossing"]
    assert abs(router["train_gap"] - record["train_gap"]) < 1e-9
    assert abs(router["train_coverage"] - record["train_coverage"]) < 1e-9

    train_s, _, train_choice = apply_router(router, tr, types[train])
    train_o = tr[np.arange(len(train)), 1 - train_choice]
    fit = fit_typewise_weights(train_s, train_o, y[train], events[train], types[train], router)
    test_s, _, test_choice = apply_router(router, te, types[test])
    test_o = te[np.arange(len(test)), 1 - test_choice]
    predictions = method_predictions(test_s, test_o, types[test], fit)
    duplicate = method_predictions(test_s, test_s, types[test], fit)
    masks = {
        "all": np.ones(len(test), dtype=bool),
        "complementary": np.isin(types[test], router["complementary"]),
    }
    results = {scope: score_scope(predictions[mask], duplicate[mask], y[test][mask], events[test][mask])
               for scope, mask in masks.items()}
    stability = assess_stability(router, te, y[test], events[test], types[test])["status"]
    independent_error = independent_gradient = 0.0
    checked = number % 97 == 0
    if checked:
        from analysis.audit_typewise_matched_aggregation import independent_check
        independent_error, independent_gradient = independent_check(
            train_s, train_o, y[train], events[train], types[train],
            test_s, test_o, y[test], events[test], types[test], fit,
            predictions, duplicate, masks, results)
    metadata = {
        "id": pair_id(MODELS[i], MODELS[j]),
        "model_a": MODELS[i], "model_b": MODELS[j],
        "split": seed, "fold": fold,
        # Preserve frozen values at filter boundaries.
        "train_gap": float(record["train_gap"]),
        "train_coverage": float(record["train_coverage"]),
        **{flag: bool(record[flag]) for flag in FLAGS},
        "stability": stability,
        "scopes": results,
        "audit": {
            "max_gradient": max(fit["global_gradient"], fit["typewise_gradient"], independent_gradient),
            "independent_error": independent_error,
            "independently_checked": checked,
        },
    }
    if seed == SEEDS[0] and fold == 0:
        metadata["fit"] = fit
    return serialize(metadata)


def empty_aggregate():
    return {
        "pairs": 0, "events": 0.0, "targets": 0.0,
        "brier": np.zeros(N), "ece": np.zeros(N), "duplicate_brier": np.zeros(N),
        "wins_vs_selection": np.zeros(N), "wins_vs_global": np.zeros(N),
        "duplicate_wins": np.zeros(N),
    }


def add_aggregate(aggregate, row):
    if row is None:
        return
    aggregate["pairs"] += 1
    for key in ["events", "targets", "brier", "ece", "duplicate_brier",
                "wins_vs_selection", "wins_vs_global", "duplicate_wins"]:
        aggregate[key] += row[key]


def finish_aggregate(aggregate):
    count = aggregate["pairs"]
    return serialize({key: value if key == "pairs" else value / count if count else None
                      for key, value in aggregate.items()})


def _summarize_values(values):
    if not values:
        return {"count": 0, "mean": None, "median": None, "q25": None, "q75": None,
                "min": None, "max": None, "negative_share": None, "between_zero_and_one_share": None,
                "above_one_share": None}
    array = np.asarray(values, dtype=float)
    return serialize({
        "count": len(array), "mean": array.mean(), "median": np.median(array),
        "q25": np.quantile(array, .25), "q75": np.quantile(array, .75),
        "min": array.min(), "max": array.max(),
        "negative_share": np.mean(array < 0),
        "between_zero_and_one_share": np.mean((array >= 0) & (array <= 1)),
        "above_one_share": np.mean(array > 1),
    })


def _direction_summary(directions):
    summary = {}
    for scope in SCOPES:
        brier = np.asarray([direction["scopes"][scope]["brier"] for direction in directions
                            if direction["scopes"][scope]["brier"] is not None])
        ece = np.asarray([direction["scopes"][scope]["ece"] for direction in directions
                          if direction["scopes"][scope]["ece"] is not None])
        if not len(brier):
            summary[scope] = {
                "defined_directions": 0,
                "brier_better_than_selection": [0] * N,
                "ece_better_than_selection": [0] * N,
                "typewise_brier_better_than_global": 0,
                "typewise_ece_better_than_global": 0,
            }
            continue
        summary[scope] = {
            "defined_directions": len(brier),
            "brier_better_than_selection": (brier[:, [0]] - brier > 1e-10).sum(axis=0).tolist(),
            "ece_better_than_selection": (ece[:, [0]] - ece > 1e-10).sum(axis=0).tolist(),
            "typewise_brier_better_than_global": int(np.sum(brier[:, 1] - brier[:, 2] > 1e-10)),
            "typewise_ece_better_than_global": int(np.sum(ece[:, 1] - ece[:, 2] > 1e-10)),
        }
    return summary


def write_report(destination):
    view = json.loads((destination / "views/gap3-coverage50-all.json").read_text())
    coefficients = json.loads((destination / "coefficient-summary.json").read_text())
    lines = [
        "# Event-type matched aggregation without calibration", "",
        "2026-09-08 exploratory historical-holdout follow-up.", "",
        "The main all-pair cohort is training-defined. The no-reversal and reversed-or-unverified cohorts are post-hoc diagnostics because their labels use test outcomes; they never alter routing or coefficients.", "",
        "Brier is event-equal within pair and then pair-equal. ECE is target-weighted in ten fixed equal-width bins. Lower is better for both.", "",
    ]
    for cohort in COHORTS:
        lines += [f"## {cohort.replace('_', ' ').title()} cohort", ""]
        for scope in SCOPES:
            result = view["cohorts"][cohort]["primary"]["scopes"][scope]
            lines += [f"### {scope.title()} test events", "",
                      "| Method | Pairs | Brier | Brier gain vs selection | ECE | ECE gain vs selection | Pair Brier wins vs selection | Gain vs duplicate | Positive Brier directions / 10 | Positive ECE directions / 10 |",
                      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
            direction = view["cohorts"][cohort]["direction_summary"][scope]
            for index, label in enumerate(LABELS):
                if result["brier"] is None:
                    cells = ["—"] * 8
                else:
                    cells = [
                        f'{result["brier"][index]:.6f}',
                        f'{result["brier"][0] - result["brier"][index]:+.6f}',
                        f'{result["ece"][index]:.6f}',
                        f'{result["ece"][0] - result["ece"][index]:+.6f}',
                        f'{100 * result["wins_vs_selection"][index]:.1f}%',
                        f'{result["duplicate_brier"][index] - result["brier"][index]:+.6f}',
                        str(direction["brier_better_than_selection"][index]),
                        str(direction["ece_better_than_selection"][index]),
                    ]
                lines.append(f'| {label} | {result["pairs"]} | ' + " | ".join(cells) + " |")
            lines.append("")
    lines += ["## Training-fitted coefficient summary", "",
              "The reported coefficient is lambda on the other forecast in `z_s + lambda * (z_o-z_s)`. Types are the router's exact seven-domain labels.", "",
              "| Training group | Pair fits | Mean lambda | Median lambda | IQR | Negative share |",
              "|---|---:|---:|---:|---:|---:|"]
    for group, values in [("Global", coefficients["global_log_weight"]),
                          ("Sparse/unseen fallback", coefficients["fallback_log_weight"]),
                          *[(group, coefficients["event_types"][group]) for group in TYPES]]:
        if values["count"]:
            lines.append(f'| {group} | {values["count"]} | {values["mean"]:.3f} | {values["median"]:.3f} | [{values["q25"]:.3f}, {values["q75"]:.3f}] | {100 * values["negative_share"]:.1f}% |')
        else:
            lines.append(f"| {group} | 0 | — | — | — | — |")
    lines.append("")
    lines += [
        "## Interpretation guardrails", "",
        "The event-type method estimates aggregation interactions, not a calibration map: there is no intercept, calibration slope, spline, probability offset, or test-fitted parameter.",
        "A positive held-out result is evidence for this rule on this frozen population, not a universal guarantee. The ten directions share models and events, so no naive significance claim is made.", "",
        "See PROTOCOL.md, audit.json, source-manifest.json, all-direction-results.jsonl.gz, primary-fits.json.gz, and views/*.json.", "",
        "Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.",
    ]
    (destination / "REPORT.md").write_text("\n".join(lines) + "\n")


def export(study, destination, workers=4, limit=None):
    import pandas as pd

    started = time.monotonic()
    destination.mkdir(parents=True, exist_ok=True)
    protocol = ROOT / "docs/typewise-matched-aggregation-protocol.md"
    source = json.loads((ROOT / "site/public/data/type-selection/source-manifest.json").read_text())
    for name, expected in source["files"].items():
        assert digest(study / name) == expected, name
    code_paths = [
        "analysis/typewise_matched_aggregation.py",
        "analysis/audit_typewise_matched_aggregation.py",
        "analysis/type_selection.py",
        "analysis/type_selection_mechanisms.py",
        "analysis/type_selection_no_calibration.py",
        "analysis/aggregation_stability.py",
    ]
    source.update(
        protocol_sha256=digest(protocol),
        code_hashes={path: digest(ROOT / path) for path in code_paths},
    )
    write_json(destination / "protocol-lock.json", {
        "protocol_sha256": digest(protocol), "started_at_unix": time.time(),
    })

    columns = ["i", "j", "split", "fold", "dimension", "train_gap", "train_coverage",
               "train_groups", "crossing", *FLAGS]
    frozen = pd.read_csv(study / "results/pair_results.csv.gz", usecols=columns)
    frozen = frozen[(frozen.dimension == "topic") & frozen.crossing &
                    (frozen.train_gap <= 5) & (frozen.train_groups >= 2) &
                    (frozen.train_coverage >= .5)].sort_values(["split", "fold", "i", "j"])
    if limit:
        frozen = frozen.head(limit)
    records = list(enumerate(frozen.to_dict("records")))
    filters = [(gap, coverage, identity) for gap in [3, 5] for coverage in [.5, .6, .7, .8]
               for identity in ["all", "different_model_version", "matched_conditions"]]
    aggregates = {}
    primary = {}
    fit_summaries = []
    audit = {
        "status": "RUNNING", "pair_directions": 0, "primary_pairs": 0,
        "independent_directions": 0, "max_independent_error": 0.0,
        "max_gradient": 0.0, "max_parent_score_error": 0.0,
        "train_only_coefficients": True,
        "test_outcomes_used_only_for_post_hoc_cohorts": True,
        "counts": {status: 0 for status in ["no_reversal", "reversed", "unverified"]},
    }
    executor = ProcessPoolExecutor(
        max_workers=workers,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=initialize,
        initargs=(str(study),),
    )
    with executor, gzip.open(destination / "all-direction-results.jsonl.gz", "wt") as output:
        for number, row in enumerate(executor.map(evaluate, records, chunksize=8), 1):
            check = row.pop("audit")
            audit["pair_directions"] += 1
            audit["independent_directions"] += int(check["independently_checked"])
            audit["max_independent_error"] = max(audit["max_independent_error"], check["independent_error"])
            audit["max_gradient"] = max(audit["max_gradient"], check["max_gradient"])
            audit["counts"][row["stability"]] += 1
            output.write(json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")

            if row["split"] == SEEDS[0] and row["fold"] == 0:
                primary[row["id"]] = row
                fit_summaries.append({
                    "id": row["id"], "train_gap": row["train_gap"],
                    "train_coverage": row["train_coverage"],
                    **{flag: row[flag] for flag in FLAGS}, **row.pop("fit"),
                })
            cohort = "no_reversal" if row["stability"] == "no_reversal" else "reversed_or_unverified"
            for gap, coverage, identity in filters:
                if row["train_gap"] <= gap + TOL and row["train_coverage"] >= coverage and in_scope(row, identity):
                    for name in ["all", cohort]:
                        aggregate = aggregates.setdefault(
                            (row["split"], row["fold"], view_key(gap, coverage, identity), name),
                            {scope: empty_aggregate() for scope in SCOPES},
                        )
                        for scope in SCOPES:
                            add_aggregate(aggregate[scope], row["scopes"][scope])
            if number % 500 == 0 or number == len(records):
                print(f"{number}/{len(records)} directions · {time.monotonic() - started:.1f}s", flush=True)

    assert audit["max_independent_error"] < 1e-9
    assert audit["max_gradient"] < 1e-7
    if not limit:
        old = json.loads((ROOT / "site/public/data/type-selection-no-calibration/index.json").read_text())
        assert audit["pair_directions"] == old["audit"]["pair_directions"]
        assert len(primary) == old["audit"]["primary_pairs"]

    (destination / "views").mkdir(exist_ok=True)
    for gap, coverage, identity in filters:
        key = view_key(gap, coverage, identity)
        view = {"key": key, "gap": gap, "coverage": coverage, "pair_scope": identity, "cohorts": {}}
        for cohort in COHORTS:
            directions = []
            for seed in SEEDS:
                for fold in [0, 1]:
                    aggregate = aggregates.get((seed, fold, key, cohort),
                                               {scope: empty_aggregate() for scope in SCOPES})
                    directions.append({
                        "split": seed, "fold": fold,
                        "scopes": {scope: finish_aggregate(aggregate[scope]) for scope in SCOPES},
                    })
            view["cohorts"][cohort] = {
                "primary": directions[0], "directions": directions,
                "direction_summary": _direction_summary(directions),
            }
        if not limit:
            parent = json.loads((ROOT / "site/public/data/type-selection-no-calibration/views" / f"{key}.json").read_text())
            for current, expected in zip(view["cohorts"]["all"]["directions"], parent["directions"]):
                for scope in SCOPES:
                    actual_row, expected_row = current["scopes"][scope], expected["scopes"][scope]
                    assert actual_row["pairs"] == expected_row["pairs"]
                    if actual_row["pairs"]:
                        for metric in ["brier", "ece", "duplicate_brier"]:
                            actual = np.asarray(actual_row[metric])[:2]
                            prior = np.asarray(expected_row[metric])[[0, 7]]
                            error = float(np.max(np.abs(actual - prior)))
                            audit["max_parent_score_error"] = max(audit["max_parent_score_error"], error)
        write_json(destination / "views" / f"{key}.json", view)

    with gzip.open(destination / "primary-fits.json.gz", "wt") as stream:
        json.dump(fit_summaries, stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    default_fits = [fit for fit in fit_summaries
                    if fit["train_gap"] <= 3 + TOL and fit["train_coverage"] >= .5]
    coefficient_summary = {
        "population": "primary gap3 coverage50 all exact configurations",
        "pairs": len(default_fits),
        "global_log_weight": _summarize_values([fit["global_log_weight"] for fit in default_fits]),
        "fallback_log_weight": _summarize_values([fit["fallback_log_weight"] for fit in default_fits]),
        "event_types": {
            group: _summarize_values([fit["type_log_weights"][group] for fit in default_fits
                                      if group in fit["type_log_weights"]])
            for group in TYPES
        },
    }
    write_json(destination / "coefficient-summary.json", coefficient_summary)
    assert audit["max_parent_score_error"] < 1e-9
    audit.update(
        status="SMOKE" if limit else "PASS",
        primary_pairs=len(primary),
        elapsed_seconds=round(time.monotonic() - started, 2),
    )
    write_json(destination / "index.json", {
        "schema_version": 1, "date": "2026-09-08", "exploratory": True,
        "methods": METHODS, "method_labels": LABELS,
        "primary_split": SEEDS[0], "primary_fold": 0,
        "cohorts": COHORTS, "scopes": SCOPES,
        "views": [view_key(*values) for values in filters], "audit": audit,
    })
    write_json(destination / "audit.json", audit)
    write_json(destination / "source-manifest.json", source)
    shutil.copyfile(protocol, destination / "PROTOCOL.md")
    write_report(destination)
    print(json.dumps(audit), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "data/build/typewise-matched-aggregation-20260908")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    export(args.study, args.output, args.workers, args.limit)
