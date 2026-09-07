"""Frozen, train-only diagnostics of historical type routing versus pooling."""
from __future__ import annotations

import argparse
import csv
import gzip
import json
from pathlib import Path
import shutil
import time

import numpy as np

from analysis.type_selection import (
    ROOT, SEEDS, apply_router, digest, event_weights, fit_router, in_scope,
    pair_id, predictions_for, split_rows, write_json,
)

TYPES = ["climate_weather", "entertainment_culture", "finance", "health", "politics", "sports", "technology"]
METHODS = ["type_selection", "simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds",
           "calibrated_selection", "flexible_selection", "joint_model", "convex_pool", "extremized_convex"]
LABELS = ["Type-based selection", "Simple mean", "Log-odds mean", "EC · w = 0.56", "Piecewise odds",
          "Calibrated selection", "Type-adjusted selection", "Type-adjusted joint model",
          "Training convex pool", "Extremized convex pool"]
GROUPS = ["both_high", "both_low", "opposite", "other"]
CUTOFFS = [.6, .7, .8]
SCOPES = ["complementary", "all"]
RIDGE = .005
CONTRASTS = [(0, 5), (6, 7), (8, 9), (2, 3), (0, 4)]
CONTRAST_NAMES = ["calibration_gain", "incremental_gain", "extremization_gain", "ec_vs_logodds", "piecewise_vs_selection"]


def logit(p):
    clipped = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped))


def sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -700, 700)))


def features(selected, other, types, mode):
    z = logit(selected)
    columns = [np.ones(len(z)), z / 4]
    if mode != "calibrated":
        columns += [np.maximum(z - knot, 0) / 4 for knot in [-2, 0, 2]]
        columns += [(types == t).astype(float) for t in TYPES]
    if mode == "joint":
        columns.append((logit(other) - z) / 4)
    return np.column_stack(columns), z


def fit_logistic(x, offset, y, weights):
    """Convex penalized log loss. All arguments are training data."""
    penalty = np.full(x.shape[1], RIDGE)
    penalty[0] *= .1
    theta = np.zeros(x.shape[1])
    def objective(coef):
        z = offset + x @ coef
        return float(weights @ (np.logaddexp(0, z) - y * z) + .5 * (penalty * coef) @ coef)
    for iteration in range(60):
        q = sigmoid(offset + x @ theta)
        gradient = x.T @ (weights * (q - y)) + penalty * theta
        if np.max(np.abs(gradient)) < 1e-8:
            break
        hessian = x.T @ ((weights * q * (1 - q))[:, None] * x) + np.diag(penalty)
        step = np.linalg.solve(hessian, gradient)
        old = objective(theta)
        scale = 1.
        for _ in range(30):
            if objective(theta - scale * step) <= old - 1e-4 * scale * float(gradient @ step) + 1e-15:
                break
            scale /= 2
        theta -= scale * step
    q = sigmoid(offset + x @ theta)
    residual = float(np.max(np.abs(x.T @ (weights * (q - y)) + penalty * theta)))
    assert residual < 1e-7, f"Logistic solver did not converge: {residual}"
    return theta, {"gradient": residual, "iterations": iteration + 1, "objective": objective(theta)}


def fit_controls(singles, selected, other, types, y, events):
    w = event_weights(events)
    fitted = {}
    for mode in ["calibrated", "flexible", "joint"]:
        x, z = features(selected, other, types, mode)
        coef, audit = fit_logistic(x, z, y, w)
        fitted[mode] = {"coef": coef.tolist(), **audit}
    difference = singles[:, 0] - singles[:, 1]
    denominator = w @ difference ** 2
    alpha = float(np.clip(w @ (difference * (y - singles[:, 1])) / denominator, 0, 1)) if denominator > 1e-18 else .5
    pooled = alpha * singles[:, 0] + (1 - alpha) * singles[:, 1]
    grid = np.linspace(1, 2, 21)
    losses = w @ (sigmoid(logit(pooled)[:, None] * grid) - y[:, None]) ** 2
    gamma = float(grid[np.flatnonzero(losses <= losses.min() + 1e-12)[0]])
    fitted.update(alpha=alpha, gamma=gamma)
    return fitted


def apply_controls(fitted, singles, selected, other, types):
    output = []
    for mode in ["calibrated", "flexible", "joint"]:
        x, z = features(selected, other, types, mode)
        output.append(sigmoid(z + x @ np.array(fitted[mode]["coef"])))
    pooled = fitted["alpha"] * singles[:, 0] + (1 - fitted["alpha"]) * singles[:, 1]
    output += [pooled, sigmoid(fitted["gamma"] * logit(pooled))]
    return np.column_stack(output)


def confidence_groups(singles, cutoff=.7):
    a, b = singles.T
    group = np.full(len(a), 3, dtype=int)
    group[((a < .5) & (b > .5)) | ((a > .5) & (b < .5))] = 2
    group[(a >= cutoff) & (b >= cutoff)] = 0
    # Round decimal complement to avoid 1-.7 becoming .30000000000000004.
    low = round(1 - cutoff, 10)
    group[(a <= low) & (b <= low)] = 1
    return group


def decompose(pred, singles, y, weights):
    groups = []
    for cutoff in CUTOFFS:
        ids = confidence_groups(singles, cutoff)
        mass = np.bincount(ids, weights=weights, minlength=4)
        outcome = np.bincount(ids, weights=weights * y, minlength=4)
        loss = np.array([np.bincount(ids, weights=weights * (p - y) ** 2, minlength=4) for p in pred.T]).T
        probability = np.array([np.bincount(ids, weights=weights * p, minlength=4) for p in pred.T]).T
        assert abs(mass.sum() - 1) < 1e-10
        np.testing.assert_allclose(loss.sum(axis=0), weights @ (pred - y[:, None]) ** 2, atol=1e-12)
        groups.append({"mass": mass, "outcome": outcome, "loss": loss, "probability": probability})
    return groups


def matched_check(selected, other, single_q, y, types, events, weights):
    """Support-only matching; outcomes affect descriptive estimates, never cells."""
    bins = np.minimum((selected * 10).astype(int), 9)
    cell_codes = np.array([TYPES.index(t) if t in TYPES else 7 for t in types]) * 10 + bins
    values, masses, count, supported = [], [], 0, set()
    for cell in np.unique(cell_codes):
        inside = cell_codes == cell
        high = inside & (other - selected >= .1 - 1e-12)
        low = inside & (other - selected <= -.1 + 1e-12)
        if min(len(np.unique(events[high])), len(np.unique(events[low]))) < 5:
            continue
        mh, ml = weights[high].sum(), weights[low].sum()
        if not mh or not ml:
            continue
        values.append([float(weights[high] @ column[high] / mh - weights[low] @ column[low] / ml)
                       for column in [y, selected, y - single_q, other]])
        masses.append(2 * mh * ml / (mh + ml))
        count += 1
        supported.update(events[high | low].tolist())
    return {"cells": count, "events": len(supported), "overlap_mass": sum(masses),
            "differences": np.average(values, axis=0, weights=masses).tolist() if masses else None}


def evaluate_scope(pred, singles, y, types, events, mask, fallback, fit, primary):
    if not mask.any():
        return None
    p, raw, yy, tt, ee = pred[mask], singles[mask], y[mask], types[mask], events[mask]
    weights = event_weights(ee)
    loss = (p - yy[:, None]) ** 2
    bs = weights @ loss
    ece = []
    for column in p.T:
        bins = np.minimum((column * 10).astype(int), 9)
        ece.append(float(np.abs(np.bincount(bins, weights=column - yy, minlength=10)).sum() / len(yy)))
    retained, routed = 0., 0.
    for route in fit["routes"]:
        if route["fallback"]:
            continue
        inside = tt == route["type"]
        if not inside.any():
            continue
        r = weights[inside] @ (raw[inside] - yy[inside, None]) ** 2
        mass = weights[inside].sum()
        routed += mass
        delta = r[1 - route["selected"]] - r[route["selected"]]
        retained += mass * (1. if delta > 1e-12 else .5 if abs(delta) <= 1e-12 else 0.)
    other = np.where(np.abs(p[:, 0] - raw[:, 0]) < 1e-15, raw[:, 1], raw[:, 0])
    matching = matched_check(p[:, 0], other, p[:, 6], yy, tt, ee, weights) if primary else None
    fb = fallback[mask].astype(float)
    return {"events": len(np.unique(ee)), "targets": len(yy), "brier": bs, "ece": np.array(ece),
            "groups": decompose(p, raw, yy, weights), "fallback_mass": weights @ fb,
            "fallback_loss": (weights * fb) @ loss, "retained_mass": retained, "routed_mass": routed,
            "matching": matching}


def empty_aggregate():
    return {"pairs": 0, "events": 0., "targets": 0., "brier": np.zeros(10), "ece": np.zeros(10),
            "wins": np.zeros(5), "alpha": 0., "gamma": 0., "extremized_pairs": 0,
            "groups": [{"mass": np.zeros(4), "outcome": np.zeros(4), "loss": np.zeros((4, 10)),
                        "probability": np.zeros((4, 10))} for _ in CUTOFFS],
            "fallback_mass": 0., "fallback_loss": np.zeros(10), "retained_mass": 0., "routed_mass": 0.,
            "matching_pairs": 0, "matching_cells": 0, "matching_events": 0,
            "matching_overlap": 0., "matching_differences": np.zeros(4)}


def add_aggregate(aggregate, row, fitted):
    if row is None:
        return
    aggregate["pairs"] += 1
    for key in ["events", "targets", "brier", "ece", "fallback_mass", "fallback_loss", "retained_mass", "routed_mass"]:
        aggregate[key] += row[key]
    aggregate["wins"] += np.array([row["brier"][a] - row["brier"][b] > 1e-10 for a, b in CONTRASTS])
    aggregate["alpha"] += fitted["alpha"]
    aggregate["gamma"] += fitted["gamma"]
    aggregate["extremized_pairs"] += fitted["gamma"] > 1
    for destination, source in zip(aggregate["groups"], row["groups"]):
        for key in destination:
            destination[key] += source[key]
    matched = row["matching"]
    if matched and matched["differences"] is not None:
        aggregate["matching_pairs"] += 1
        aggregate["matching_cells"] += matched["cells"]
        aggregate["matching_events"] += matched["events"]
        aggregate["matching_overlap"] += matched["overlap_mass"]
        aggregate["matching_differences"] += matched["differences"]


def serialize(value):
    if isinstance(value, dict):
        return {str(k): serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    if isinstance(value, np.ndarray):
        return serialize(value.tolist())
    if isinstance(value, np.generic):
        return value.item()
    return value


def finish_aggregate(aggregate):
    n = aggregate["pairs"]
    result = {"pairs": n}
    for key in ["events", "targets", "brier", "ece", "wins", "alpha", "gamma", "extremized_pairs",
                "fallback_mass", "fallback_loss", "retained_mass", "routed_mass"]:
        result[key] = serialize(aggregate[key] / n) if n else None
    result["groups"] = [{key: serialize(value / n) if n else None for key, value in group.items()}
                        for group in aggregate["groups"]]
    matched_n = aggregate["matching_pairs"]
    result["matching"] = {"pairs": matched_n, "cells": aggregate["matching_cells"],
                          "mean_events": aggregate["matching_events"] / matched_n if matched_n else None,
                          "mean_overlap": aggregate["matching_overlap"] / matched_n if matched_n else None,
                          "differences": serialize(aggregate["matching_differences"] / matched_n) if matched_n else None}
    return result


def view_key(gap, coverage, scope):
    return f"gap{gap}-coverage{int(coverage * 100)}-{scope}"


def export(study, destination, limit=None):
    import pandas as pd

    started = time.monotonic()
    destination.mkdir(parents=True, exist_ok=True)
    protocol = ROOT / "docs/type-selection-mechanisms-protocol.md"
    manifest = json.loads((ROOT / "site/public/data/type-selection/source-manifest.json").read_text())
    for name, expected in manifest["files"].items():
        assert digest(study / name) == expected, name
    manifest["protocol_sha256"] = digest(protocol)
    manifest["mechanism_code_sha256"] = digest(Path(__file__))
    manifest["parent_router_sha256"] = digest(ROOT / "analysis/type_selection.py")
    write_json(destination / "protocol-lock.json", {"protocol_sha256": digest(protocol), "started_at_unix": time.time()})
    panel = np.load(study / "data/panel.npz")
    p, y, events, types = [panel[k] for k in ["predictions", "outcome", "event", "topic"]]
    assert set(types).issubset(set(TYPES) | {""})
    models = json.loads((study / "data/models.json").read_text())
    with (study / "data/events.csv").open() as f:
        catalog = [(r["source"], r["event_id"]) for r in csv.DictReader(f)]
    splits = {seed: split_rows(catalog, events, seed) for seed in SEEDS}
    cols = ["i", "j", "split", "fold", "dimension", "train_gap", "train_coverage", "train_groups", "crossing",
            "same_model_version", "same_prompt", "same_information"]
    frozen = pd.read_csv(study / "results/pair_results.csv.gz", usecols=cols)
    frozen = frozen[(frozen.dimension == "topic") & frozen.crossing & (frozen.train_gap <= 5)
                    & (frozen.train_groups >= 2) & (frozen.train_coverage >= .5)].sort_values(["split", "fold", "i", "j"])
    if limit:
        frozen = frozen.head(limit)
    old = json.loads((ROOT / "site/public/data/type-selection/study.json").read_text())
    old_pairs = {r["id"]: r for r in old["pairs"]}
    aggregates, primary = {}, []
    filters = [(gap, coverage, scope) for gap in [3, 5] for coverage in [.5, .6, .7, .8]
               for scope in ["all", "different_model_version", "matched_conditions"]]
    audit = {"status": "RUNNING", "pair_directions": 0, "fitted_logistic_models": 0,
             "max_gradient": 0., "max_parent_score_error": 0., "max_additivity_error": 0.,
             "max_clipping_brier_difference": 0., "max_independent_error": 0., "independent_pairs": 0,
             "event_overlap_failures": 0, "train_only_fits": True, "protocol_sha256": digest(protocol)}
    with gzip.open(destination / "all-direction-scores.csv.gz", "wt", newline="") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["pair_id", "model_a", "model_b", "split", "train_fold", "train_gap", "train_coverage",
                         "test_scope", "events", "targets", "method", "brier", "ece", "convex_alpha", "extremization_gamma"])
        for number, record in enumerate(frozen.itertuples(index=False), 1):
            i, j, seed, fold = int(record.i), int(record.j), int(record.split), int(record.fold)
            common = np.flatnonzero(np.isfinite(p[:, i]) & np.isfinite(p[:, j]))
            train, test = common[splits[seed][common] == fold], common[splits[seed][common] != fold]
            assert not np.intersect1d(events[train], events[test]).size
            singles_train, singles_test = p[train][:, [i, j]], p[test][:, [i, j]]
            fit = fit_router(singles_train, y[train], events[train], types[train], [models[i], models[j]])
            assert fit["crossing"] and abs(fit["train_gap"] - record.train_gap) < 1e-9
            selected, _, choices = apply_router(fit, singles_train, types[train])
            other = singles_train[np.arange(len(train)), 1 - choices]
            fitted = fit_controls(singles_train, selected, other, types[train], y[train], events[train])
            base, fallback, choices = predictions_for(fit, singles_test, types[test])
            controlled = apply_controls(fitted, singles_test, base[:, 0], singles_test[np.arange(len(test)), 1 - choices], types[test])
            pred = np.column_stack([base[:, :5], controlled])
            is_primary = seed == SEEDS[0] and fold == 0
            pid = pair_id(models[i], models[j])
            masks = {"all": np.ones(len(test), bool), "complementary": np.isin(types[test], fit["complementary"])}
            values = {scope: evaluate_scope(pred, singles_test, y[test], types[test], events[test], mask, fallback, fit, is_primary)
                      for scope, mask in masks.items()}
            audit["max_gradient"] = max(audit["max_gradient"], *[fitted[m]["gradient"] for m in ["calibrated", "flexible", "joint"]])
            audit["fitted_logistic_models"] += 3
            audit["pair_directions"] += 1
            metadata = {"id": pid, "i": i, "j": j, "split": seed, "fold": fold, "train_gap": float(record.train_gap),
                        "train_coverage": float(record.train_coverage),
                        **{key: bool(getattr(record, key)) for key in ["same_model_version", "same_prompt", "same_information"]}}
            for scope, value in values.items():
                if value is None:
                    continue
                for group in value["groups"]:
                    error = np.max(np.abs(group["loss"].sum(axis=0) - value["brier"]))
                    audit["max_additivity_error"] = max(audit["max_additivity_error"], float(error))
                w = event_weights(events[test[masks[scope]]])
                clipped = np.clip(pred[masks[scope], 8], 1e-6, 1 - 1e-6)
                clip_error = abs(float(w @ (clipped - y[test[masks[scope]]]) ** 2) - value["brier"][8])
                audit["max_clipping_brier_difference"] = max(audit["max_clipping_brier_difference"], clip_error)
                if is_primary:
                    error = np.max(np.abs(np.array(old_pairs[pid]["scopes"][scope]["scores"]["brier"][:5]) - value["brier"][:5]))
                    audit["max_parent_score_error"] = max(audit["max_parent_score_error"], float(error))
                for k, method in enumerate(METHODS):
                    writer.writerow([pid, models[i], models[j], seed, fold, record.train_gap, record.train_coverage,
                                     scope, value["events"], value["targets"], method, value["brier"][k], value["ece"][k], fitted["alpha"], fitted["gamma"]])
            for gap, coverage, scope in filters:
                if record.train_gap <= gap + 1e-12 and record.train_coverage >= coverage and in_scope(metadata, scope):
                    key = (seed, fold, view_key(gap, coverage, scope))
                    if key not in aggregates:
                        aggregates[key] = {s: empty_aggregate() for s in SCOPES}
                    for s in SCOPES:
                        add_aggregate(aggregates[key][s], values[s], fitted)
            if is_primary:
                primary.append({**metadata, "fitted": fitted, "scopes": serialize(values)})
                if len(primary) % 19 == 1:
                    from analysis.audit_type_selection_mechanisms import independent_check
                    independent_error = independent_check(singles_train, singles_test, y[train], y[test], events[train], events[test],
                                                          types[train], types[test], fit, fitted, pred, masks, values)
                    audit["independent_pairs"] += 1
                    audit["max_independent_error"] = max(audit["max_independent_error"], independent_error)
            if number % 500 == 0:
                print(f"{number}/{len(frozen)} directions · {time.monotonic()-started:.1f}s · max gradient {audit['max_gradient']:.2g}", flush=True)
    assert audit["max_additivity_error"] < 1e-9 and audit["max_parent_score_error"] < 1e-9
    if not limit:
        assert {r["id"] for r in primary} == set(old_pairs)
    audit.update(status="SMOKE" if limit else "PASS", primary_pairs=len(primary), elapsed_seconds=round(time.monotonic() - started, 2))
    (destination / "views").mkdir(exist_ok=True)
    for gap, coverage, scope in filters:
        key = view_key(gap, coverage, scope)
        directions = []
        for seed in SEEDS:
            for fold in [0, 1]:
                a = aggregates.get((seed, fold, key), {s: empty_aggregate() for s in SCOPES})
                directions.append({"split": seed, "fold": fold, "scopes": {s: finish_aggregate(a[s]) for s in SCOPES}})
        write_json(destination / "views" / f"{key}.json", {"key": key, "gap": gap, "coverage": coverage, "pair_scope": scope,
                   "primary": directions[0], "directions": directions})
    with gzip.open(destination / "primary-pair-diagnostics.json.gz", "wt") as f:
        json.dump(primary, f, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    write_json(destination / "index.json", {"schema_version": 1, "date": "2026-09-07", "methods": METHODS,
               "method_labels": LABELS, "cutoffs": CUTOFFS, "groups": GROUPS, "contrasts": CONTRASTS,
               "contrast_names": CONTRAST_NAMES, "audit": audit, "primary_split": SEEDS[0], "primary_fold": 0,
               "views": [view_key(*f) for f in filters], "exploratory": True})
    write_json(destination / "audit.json", audit)
    manifest["auditor_sha256"] = digest(ROOT / "analysis/audit_type_selection_mechanisms.py")
    write_json(destination / "source-manifest.json", manifest)
    shutil.copyfile(protocol, destination / "PROTOCOL.md")
    if not limit:
        write_report(destination)
    print(json.dumps(audit, indent=2), flush=True)


def write_report(destination):
    view = json.loads((destination / "views/gap3-coverage50-all.json").read_text())
    lines = ["# Why can pooling beat historical type selection?", "", "2026-09-07 · Exploratory follow-up · Primary direction 20260910 A→B.",
             "", "Training Overall BI gap ≤3; training type coverage ≥50%; crossed strengths; all exact configurations.",
             "Event-equal Brier within pairs, then equal pair means. Positive gain means lower Brier for the second method.", ""]
    full = view['primary']['scopes']['all']
    total = full['brier'][0] - full['brier'][4]
    high = full['groups'][1]['loss'][0][0] - full['groups'][1]['loss'][0][4]
    low = full['groups'][1]['loss'][1][0] - full['groups'][1]['loss'][1][4]
    fallback = full['fallback_loss'][0] - full['fallback_loss'][4]
    lines += ["## Main observations", "",
              f"On all test events, calibrating selection alone lowers Brier by {full['brier'][0]-full['brier'][5]:.6f}. Adding the other forecast to a flexible type-adjusted baseline lowers it by a further {full['brier'][6]-full['brier'][7]:.6f} relative to that baseline. Both contrasts improve the mean in all ten fixed directions.", "",
              f"The specific high-high explanation is contradicted for the Piecewise comparison: both-high forecasts contribute {high:+.6f} to its gain, while both-low forecasts contribute {low:+.6f}. High-high contributions are negative in all ten directions at all three prespecified cutoffs, in both test scopes. This does not imply that upward extremization can never help an individual event.", "",
              f"Fallback targets account for {100*full['fallback_mass']:.1f}% of all-event weight and {fallback:+.6f} of the total {total:+.6f} Piecewise gain ({100*fallback/total:.1f}% of the net gain). This partition overlaps the confidence partition; the two decompositions must not be added together.", "",
              "These results support incremental predictive information and substantial calibration headroom. They do not identify a single causal mechanism or prove independent internal evidence.", ""]
    for scope in SCOPES:
        r = view["primary"]["scopes"][scope]
        lines += [f"## {scope.title()} test events", "", f"{r['pairs']} pairs; {r['events']:.1f} mean test events per pair.", "",
                  "| Method | Brier ↓ | ECE ↓ |", "|---|---:|---:|"]
        lines += [f"| {label} | {r['brier'][i]:.6f} | {r['ece'][i]:.6f} |" for i, label in enumerate(LABELS)]
        lines += ["", "| Diagnostic contrast | Brier gain | Pair wins | Positive directions / 10 |", "|---|---:|---:|---:|"]
        for k, (a, b) in enumerate(CONTRASTS):
            wins = sum(d['scopes'][scope]['brier'][a] > d['scopes'][scope]['brier'][b] + 1e-10 for d in view['directions'] if d['scopes'][scope]['pairs'])
            lines.append(f"| {LABELS[b]} vs {LABELS[a]} | {r['brier'][a]-r['brier'][b]:+.6f} | {100*r['wins'][k]:.1f}% | {wins} |")
        group = r["groups"][1]
        lines += ["", "### Piecewise odds gain versus selection by original forecast group", "",
                  "| Group | Scope weight | Conditional Brier gain | Additive gain contribution | Selected p | Piecewise p | Outcome frequency |",
                  "|---|---:|---:|---:|---:|---:|---:|"]
        for k, name in enumerate(GROUPS):
            mass = group['mass'][k]
            gain = group['loss'][k][0] - group['loss'][k][4]
            lines.append(f"| {name} | {100*mass:.1f}% | {gain/mass if mass else 0:+.6f} | {gain:+.6f} | {group['probability'][k][0]/mass if mass else 0:.4f} | {group['probability'][k][4]/mass if mass else 0:.4f} | {group['outcome'][k]/mass if mass else 0:.4f} |")
        m = r['matching']
        lines += ["", f"Matched residual check: {m['pairs']}/{r['pairs']} pairs; {m['cells']} cells.",
                  f"High-minus-low [outcome, selected p, residual, other p]: {m['differences']}.",
                  f"Mean fitted gamma {r['gamma']:.3f}; gamma>1 for {100*r['extremized_pairs']:.1f}% of pairs.",
                  f"Supported route test-lead retention: {100*r['retained_mass']/r['routed_mass'] if r['routed_mass'] else 0:.1f}% of routed scope weight.", ""]
    lines += ["## Interpretation limits", "", "The confidence partitions describe where gains occur, not why models hold their beliefs. The nested joint comparison tests predictive usefulness within a fixed regularized logistic family. It does not prove independent evidence. Calibration, added predictors and extremization are separate interventions and do not constitute an additive causal decomposition.",
              "", "The existing test archive was already inspected before this follow-up. Ten directions share events and models. Matching uses coarse probability bins and applies only to its explicitly reported supported subset. No naive significance claims are made.",
              "", "See PROTOCOL.md, audit.json, source-manifest.json, all-direction-scores.csv.gz, primary-pair-diagnostics.json.gz, and views/*.json for complete definitions and outputs.",
              "", "Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0."]
    (destination / "REPORT.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--destination", type=Path, default=ROOT / "site/public/data/type-selection-mechanisms")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    export(args.study, args.destination, args.limit)
