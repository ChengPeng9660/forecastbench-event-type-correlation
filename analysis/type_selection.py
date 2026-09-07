"""Train-only event-type routing on the frozen event-weighted Atlas panel.

Run with --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05.
No archived code is imported or modified. All reported results are recalculated
from common raw forecasts and checked against the frozen fixed-formula results.
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
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
METHODS = ["type_selection", "simple_mean", "log_odds_mean", "ec_w0_56",
           "piecewise_odds", "model_a", "model_b", "train_selected_single"]
LABELS = ["Type-based selection", "Simple mean", "Log-odds mean", "EC · w = 0.56",
          "Piecewise odds", "Model A", "Model B", "Train-selected single"]
METRICS = ["brier", "bi", "ece"]
SCOPES = ["complementary", "all"]
SEEDS = list(range(20260910, 20260915))
MIN_EVENTS = 30
MARGIN = 1.0
TIE = 1e-12
TOLERANCE = 1e-9


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def pair_id(a, b):
    names = sorted((a, b), key=lambda n: (n.casefold(), n))
    return "p-" + hashlib.sha256("\0".join(names).encode()).hexdigest()[:12]


def event_weights(events):
    if not len(events):
        return np.empty(0)
    _, inverse, counts = np.unique(events, return_inverse=True, return_counts=True)
    return 1.0 / (len(counts) * counts[inverse])


def brier(predictions, outcomes, events):
    return event_weights(events) @ ((predictions - outcomes[:, None]) ** 2)


def bi(loss):
    return 100 * (1 - np.sqrt(loss))


def fit_router(predictions, outcomes, events, types, names):
    """Only training arrays enter this function; no test outcome argument."""
    overall = brier(predictions, outcomes, events)
    fallback = int(np.argmin(overall))
    if abs(overall[0] - overall[1]) <= TIE:
        fallback = min(range(2), key=lambda k: (names[k].casefold(), names[k]))
    routes = []
    for group in sorted(set(types) - {""}):
        mask = types == group
        n = len(np.unique(events[mask]))
        losses = brier(predictions[mask], outcomes[mask], events[mask])
        gap = float(bi(losses)[0] - bi(losses)[1])
        supported = n >= MIN_EVENTS
        tied = bool(abs(losses[0] - losses[1]) <= TIE)
        chosen = int(np.argmin(losses)) if supported and not tied else fallback
        routes.append({"type": group, "train_events": n,
                       "train_brier_a": float(losses[0]), "train_brier_b": float(losses[1]),
                       "train_gap_bi": gap, "selected": chosen,
                       "fallback": not supported or tied,
                       "complementary": supported and abs(gap) >= MARGIN})
    complementary = [r["type"] for r in routes if r["complementary"]]
    supported = [r["type"] for r in routes if r["train_events"] >= MIN_EVENTS]
    return {"fallback": fallback, "routes": routes, "complementary": complementary,
            "train_brier": overall.tolist(), "train_gap": float(abs(bi(overall)[0] - bi(overall)[1])),
            "train_coverage": float(event_weights(events) @ np.isin(types, supported)),
            "crossing": any(r["complementary"] and r["train_gap_bi"] >= MARGIN for r in routes)
                        and any(r["complementary"] and r["train_gap_bi"] <= -MARGIN for r in routes)}


def apply_router(fit, predictions, types):
    mapping = {r["type"]: r for r in fit["routes"]}
    choices = np.array([mapping[t]["selected"] if t in mapping else fit["fallback"] for t in types])
    fallback = np.array([mapping[t]["fallback"] if t in mapping else True for t in types])
    return predictions[np.arange(len(predictions)), choices], fallback, choices


def predictions_for(fit, singles, types):
    routed, fallback, choices = apply_router(fit, singles, types)
    clipped = np.clip(singles, 1e-6, 1 - 1e-6)
    logits = np.log(clipped / (1 - clipped)).sum(axis=1)
    threshold = math.log(5)
    piecewise = np.where(logits <= -threshold, logits + threshold / 2,
                        np.where(logits >= threshold, logits - threshold / 2, logits / 2))
    sigmoid = lambda x: 1 / (1 + np.exp(-x))
    return np.column_stack([routed, singles.mean(axis=1), sigmoid(logits / 2),
                            sigmoid(.56 * logits), sigmoid(piecewise), singles,
                            singles[:, fit["fallback"]]]), fallback, choices


def scope_scores(predictions, outcomes, events, mask, fallback, choices):
    if not np.any(mask):
        return {"events": 0, "targets": 0, "event_fraction": 0.0,
                "fallback_fraction": None, "a_fraction": None, "best_single": None,
                "scores": {metric: [None] * len(METHODS) for metric in METRICS}}
    p, y, ev = predictions[mask], outcomes[mask], events[mask]
    weights = event_weights(ev)
    bs = weights @ ((p - y[:, None]) ** 2)
    calibration = []
    for column in p.T:
        bins = np.minimum((column * 10).astype(int), 9)
        sums = np.bincount(bins, weights=column - y, minlength=10)
        calibration.append(float(np.abs(sums).sum() / len(y)))
    return {"events": len(np.unique(ev)), "targets": int(mask.sum()),
            "event_fraction": len(np.unique(ev)) / len(np.unique(events)),
            "fallback_fraction": float(weights @ fallback[mask]),
            "a_fraction": float(weights @ (choices[mask] == 0)),
            "best_single": 5 + int(np.argmin(bs[5:7])),
            "scores": {"brier": bs.tolist(), "bi": bi(bs).tolist(), "ece": calibration}}


def split_rows(events, event_index, seed):
    folds = np.array([int.from_bytes(hashlib.sha256(
        f"{seed}|{source.casefold()}|{event}".encode()).digest()[:8], "big") % 2
        for source, event in events])
    return folds[event_index]


def summarize(rows):
    result = {}
    for scope in SCOPES:
        available = [r["scopes"][scope] for r in rows if r["scopes"][scope]["events"] > 0]
        summary = {"pairs": len(rows), "defined_pairs": len(available)}
        for key in ["events", "targets", "event_fraction", "fallback_fraction", "a_fraction"]:
            summary["mean_" + key] = float(np.mean([r[key] for r in available])) if available else None
        summary["scores"], summary["routing_win_rates"], summary["routing_gain_vs_best_single"] = {}, {}, {}
        for metric in METRICS:
            values = np.array([r["scores"][metric] for r in available])
            direction = 1 if metric == "bi" else -1
            summary["scores"][metric] = values.mean(axis=0).tolist() if available else [None] * len(METHODS)
            summary["routing_win_rates"][metric] = (
                ((values[:, [0]] - values) * direction > 1e-10).mean(axis=0).tolist()
                if available else [None] * len(METHODS))
            summary["routing_gain_vs_best_single"][metric] = float(np.mean([
                direction * (r["scores"][metric][0] - r["scores"][metric][r["best_single"]])
                for r in available])) if available else None
        result[scope] = summary
    return result


def in_scope(row, scope):
    return scope == "all" or (scope == "different_model_version" and not row["same_model_version"]) or (
        scope == "matched_conditions" and row["same_prompt"] and row["same_information"])


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")


def export(study, destination):
    import pandas as pd  # Only the reproduction CLI needs pandas.

    destination.mkdir(parents=True, exist_ok=True)
    protocol = ROOT / "docs/type-selection-protocol.md"
    started = time.monotonic()
    source_files = ["data/panel.npz", "data/models.json", "data/events.csv", "data/configurations.json",
                    "results/pair_results.csv.gz", "artifact_manifest.json"]
    hashes = {name: digest(study / name) for name in source_files}
    frozen_manifest = json.loads((study / "artifact_manifest.json").read_text())
    for name in source_files[:-1]:
        assert hashes[name] == frozen_manifest["files"][name]["sha256"], name
    panel = np.load(study / "data/panel.npz")
    p, y, events, types = [panel[k] for k in ["predictions", "outcome", "event", "topic"]]
    models = json.loads((study / "data/models.json").read_text())
    with (study / "data/events.csv").open() as f:
        catalog = [(r["source"], r["event_id"]) for r in csv.DictReader(f)]
    # The type partition must retain whole events so both existing conditional
    # category weights and the new within-scope event means have identical support.
    assert all(len(set(types[events == event])) == 1 for event in np.unique(events)), "Mixed-type event"
    splits = {seed: split_rows(catalog, events, seed) for seed in SEEDS}
    columns = ["i", "j", "split", "fold", "dimension", "train_gap", "train_coverage",
               "train_groups", "crossing", "same_model_version", "same_prompt", "same_information",
               *[m + suffix for m in METHODS[1:5] for suffix in ["_bi", "_raw"]]]
    frozen = pd.read_csv(study / "results/pair_results.csv.gz", usecols=columns)
    frozen = frozen[(frozen.dimension == "topic") & frozen.crossing & (frozen.train_gap <= 5)
                    & (frozen.train_groups >= 2) & (frozen.train_coverage >= .5)]
    frozen = frozen.sort_values(["i", "j", "split", "fold"])
    audit = {"status": "RUNNING", "train_only_selection": True, "test_scopes_nested": True,
             "event_disjointness_failures": 0, "source_pair_directions": len(frozen),
             "max_frozen_score_error": 0.0, "max_training_filter_error": 0.0,
             "tolerance": TOLERANCE, "protocol_sha256": digest(protocol)}
    write_json(destination / "running-audit.json", audit)
    rows, primary = [], []
    last_pair, common = None, None
    for number, record in enumerate(frozen.itertuples(index=False), start=1):
        i, j, seed, fold = int(record.i), int(record.j), int(record.split), int(record.fold)
        if (i, j) != last_pair:
            common = np.flatnonzero(np.isfinite(p[:, i]) & np.isfinite(p[:, j]))
            last_pair = (i, j)
        train, test = common[splits[seed][common] == fold], common[splits[seed][common] != fold]
        assert not np.intersect1d(events[train], events[test]).size
        assert min(len(np.unique(events[train])), len(np.unique(events[test]))) >= 100
        fit = fit_router(p[train][:, [i, j]], y[train], events[train], types[train], [models[i], models[j]])
        assert fit["crossing"] and fit["train_gap"] <= 5 + TIE and fit["train_coverage"] >= .5 - TIE
        audit["max_training_filter_error"] = max(audit["max_training_filter_error"],
            abs(fit["train_gap"] - record.train_gap), abs(fit["train_coverage"] - record.train_coverage))
        pred, fallback, choices = predictions_for(fit, p[test][:, [i, j]], types[test])
        masks = {"complementary": np.isin(types[test], fit["complementary"]), "all": np.ones(len(test), dtype=bool)}
        scopes = {scope: scope_scores(pred, y[test], events[test], mask, fallback, choices)
                  for scope, mask in masks.items()}
        assert scopes["complementary"]["events"] <= scopes["all"]["events"]
        for index, method in enumerate(METHODS[1:5], start=1):
            for metric, suffix in [("brier", "_raw"), ("bi", "_bi")]:
                error = abs(scopes["all"]["scores"][metric][index] - getattr(record, method + suffix))
                audit["max_frozen_score_error"] = max(audit["max_frozen_score_error"], error)
        row = {"id": pair_id(models[i], models[j]), "i": i, "j": j, "split": seed, "fold": fold,
               "train_gap": float(record.train_gap), "train_coverage": float(record.train_coverage),
               "same_model_version": bool(record.same_model_version), "same_prompt": bool(record.same_prompt),
               "same_information": bool(record.same_information), "scopes": scopes}
        rows.append(row)
        if seed == SEEDS[0] and fold == 0:
            primary.append({**row, "fallback": fit["fallback"], "routes": fit["routes"]})
        if number % 1000 == 0:
            print(f"Scored {number}/{len(frozen)} pair directions; {time.monotonic()-started:.0f}s; max frozen error {audit['max_frozen_score_error']:.2g}", flush=True)
    assert audit["max_frozen_score_error"] < TOLERANCE
    assert audit["max_training_filter_error"] < TOLERANCE
    print("Summarizing prespecified filters and all ten directions", flush=True)
    summaries = []
    for seed in SEEDS:
        for fold in [0, 1]:
            direction_rows = [r for r in rows if r["split"] == seed and r["fold"] == fold]
            for scope in ["all", "different_model_version", "matched_conditions"]:
                for gap in [3, 5]:
                    for coverage in [.5, .6, .7, .8]:
                        selected = [r for r in direction_rows if r["train_gap"] <= gap + TIE
                                    and r["train_coverage"] >= coverage and in_scope(r, scope)]
                        summaries.append({"split": seed, "fold": fold, "pair_scope": scope,
                                          "ability_gap": gap, "coverage": coverage, "scopes": summarize(selected)})
    assert len({r["id"] for r in primary}) == len(primary)
    original = json.loads((ROOT / "site/public/data/complementarity/study.json").read_text())
    original_ids = {r["id"] for r in original["pairs"] if r["dimension"] == "topic" and r["crossing"]}
    assert original_ids == {r["id"] for r in primary}, "Published pair universe changed"
    # This separate reconstruction uses explicit per-event means and scalar pools.
    from analysis.audit_type_selection import audit_sample
    audit["independent"] = audit_sample(primary, panel, models, splits)
    audit.update(status="PASS", primary_pairs=len(primary), evaluated_pair_directions=len(rows),
                 evaluated_scopes=2 * len(rows), elapsed_seconds=round(time.monotonic() - started, 2))
    payload = {"schema_version": 1, "date": "2026-09-07", "study": "Type-based selection on two nested test scopes",
               "primary_split": SEEDS[0], "primary_fold": 0, "methods": METHODS, "method_labels": LABELS,
               "metrics": METRICS, "weighting": "equal_events_within_event_equal_targets",
               "min_training_events": MIN_EVENTS, "complementary_margin_bi": MARGIN,
               "protocol_sha256": audit["protocol_sha256"], "source_hashes": hashes,
               "pairs": sorted(primary, key=lambda r: r["id"]), "summaries": summaries, "audit": audit}
    write_site_views(destination, payload)
    write_json(destination / "audit.json", audit)
    write_json(destination / "source-manifest.json", {"source_root": str(study), "files": hashes,
                 "protocol_sha256": digest(protocol), "code_sha256": digest(Path(__file__)),
                 "auditor_sha256": digest(ROOT / "analysis/audit_type_selection.py")})
    shutil.copyfile(protocol, destination / "PROTOCOL.md")
    write_pair_csv(destination / "primary-pairs.csv", primary, models)
    write_pair_csv(destination / "all-directions.csv.gz", rows, models)
    write_report(destination, payload)
    # Keep the initial protocol lock for provenance; it contains no reported scores.
    print(json.dumps(audit, indent=2), flush=True)


def write_site_views(destination, payload):
    """Keep the full archive downloadable; only load summaries and one pair shard in the UI."""
    shards = {f"{index:02d}": {} for index in range(32)}
    for pair in payload["pairs"]:
        shard = f"{int(pair['id'][2:], 16) % 32:02d}"
        shards[shard][pair["id"]] = pair
    payload["pair_shards"] = {pair_id: shard for shard, pairs in shards.items() for pair_id in pairs}
    write_json(destination / "study.json", payload)
    overview = {key: value for key, value in payload.items() if key != "pairs"}
    write_json(destination / "overview.json", overview)
    (destination / "pairs").mkdir(exist_ok=True)
    for shard, pairs in shards.items():
        write_json(destination / "pairs" / f"{shard}.json", pairs)


def write_pair_csv(path, rows, models):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "wt", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["pair_id", "model_a", "model_b", "split", "train_fold", "train_bi_gap",
                         "train_category_coverage", "test_scope", "test_events", "test_targets",
                         "test_event_fraction", "fallback_event_fraction", "method", *METRICS])
        for row in rows:
            for scope in SCOPES:
                value = row["scopes"][scope]
                for index, method in enumerate(METHODS):
                    writer.writerow([row["id"], models[row["i"]], models[row["j"]], row["split"], row["fold"],
                                     row["train_gap"], row["train_coverage"], scope, value["events"], value["targets"],
                                     value["event_fraction"], value["fallback_fraction"], method,
                                     *[value["scores"][metric][index] for metric in METRICS]])


def write_report(destination, payload):
    main = next(r for r in payload["summaries"] if r["split"] == SEEDS[0] and r["fold"] == 0
                and r["ability_gap"] == 3 and r["coverage"] == .5 and r["pair_scope"] == "all")
    lines = ["# Type-based model selection: results", "", "2026-09-07 · Primary direction 20260910 A→B.", "",
             "Training Overall BI gap ≤3; ≥50% supported training event mass; crossed strengths; all exact configurations.", "",
             "Each pair is equally weighted in these means; each event is equally weighted within a pair/scope.", ""]
    for scope in SCOPES:
        r = main["scopes"][scope]
        lines += [f"## {'Complementary events only' if scope == 'complementary' else 'All test events'}", "",
                  f"{r['defined_pairs']} / {r['pairs']} pairs defined; mean {r['mean_events']:.1f} test events per pair; "
                  f"mean {100*r['mean_event_fraction']:.1f}% of all test events; {100*r['mean_fallback_fraction']:.1f}% fallback event weight.", "",
                  "| Method | Mean Brier score ↓ | Mean BI ↑ | Mean ECE ↓ | Routing BI gain ↑ | Routing wins (BI) |",
                  "|---|---:|---:|---:|---:|---:|"]
        for index in range(8):
            bs, b, e = [r["scores"][metric][index] for metric in METRICS]
            gain = r["scores"]["bi"][0] - b
            win = r["routing_win_rates"]["bi"][index]
            lines.append(f"| {LABELS[index]} | {bs:.6f} | {b:.4f} | {e:.5f} | {gain:+.4f} | {100*win:.1f}% |")
        lines += ["", "Positive routing gain means selecting by historical type performs better than that row's method.", ""]
    lines += ["## Stability over ten prespecified event directions", "",
              "| Split | Train fold | Pairs | Routing BI gain vs Simple mean: complementary | All events |", "|---|---|---:|---:|---:|"]
    for r in payload["summaries"]:
        if r["ability_gap"] != 3 or r["coverage"] != .5 or r["pair_scope"] != "all":
            continue
        c, a = r["scopes"]["complementary"], r["scopes"]["all"]
        lines.append(f"| {r['split']} | {r['fold']} | {a['defined_pairs']} | "
                     f"{c['scores']['bi'][0]-c['scores']['bi'][1]:+.4f} | {a['scores']['bi'][0]-a['scores']['bi'][1]:+.4f} |")
    lines += ["", "The directions and model pairs share data; they are stability views, not independent replications. "
              "No test information selected categories, routes, pairs, or a reporting direction. "
              "The complementary scope includes all supported types with ≥1 BI historical advantage; other supported types "
              "still route by training Brier in the all-event scope. Sparse, tied or unknown types use the Overall training winner.", "",
              "See PROTOCOL.md, audit.json, primary-pairs.csv, and all-directions.csv.gz for definitions and auditable outputs.", "",
              "Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.", ""]
    (destination / "REPORT.md").write_text("\n".join(lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", required=True, type=Path)
    parser.add_argument("--destination", type=Path, default=ROOT / "site/public/data/type-selection")
    args = parser.parse_args()
    export(args.study.resolve(), args.destination.resolve())
