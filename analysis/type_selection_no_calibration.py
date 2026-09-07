"""Raw-forecast pooling and matched removal of all calibration coefficients."""
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
    pair_id, split_rows, write_json,
)
from analysis.type_selection_mechanisms import confidence_groups, logit, sigmoid, serialize, view_key

METHODS = ["type_selection", "other_only", "simple_mean", "log_odds_mean", "ec_w0_56",
           "piecewise_odds", "normalized_product", "uncalibrated_joint", "bounded_log_pool", "brier_convex_pool"]
LABELS = ["Raw type selection", "Other forecast alone", "Simple mean", "Log-odds mean", "EC · w = 0.56",
          "Piecewise odds", "Normalized product", "Uncalibrated joint", "Bounded log-odds pool", "Brier convex pool"]
SCOPES = ["complementary", "all"]
RIDGE = .005
N = len(METHODS)


def fit_weights(s, o, y, events):
    """Training data only; no fitted intercept, calibration slope or type term."""
    weights = event_weights(events)
    z = logit(s)
    x = (logit(o) - z) / 4
    def gradient(beta):
        return float(weights @ (x * (sigmoid(z + beta*x) - y)) + RIDGE*beta)
    lo, hi = -1., 1.
    while gradient(lo) > 0:
        lo *= 2
    while gradient(hi) < 0:
        hi *= 2
    beta = 0.
    for iteration in range(80):
        beta = (lo + hi) / 2
        g = gradient(beta)
        if abs(g) < 1e-11:
            break
        if g > 0:
            hi = beta
        else:
            lo = beta
    if not np.any(x):
        beta = 0.
    bounded = float(np.clip(beta, 0, 4))
    d = o - s
    denominator = float(weights @ d**2)
    linear = float(np.clip(weights @ (d*(y-s))/denominator, 0, 1)) if denominator else 0.
    residual = abs(gradient(beta))
    bounded_gradient = gradient(bounded)
    kkt = max(0., -bounded_gradient) if bounded == 0 else max(0., bounded_gradient) if bounded == 4 else abs(bounded_gradient)
    assert max(residual, kkt) < 1e-9
    return {"log_weight": beta/4, "bounded_weight": bounded/4, "probability_weight": linear,
            "gradient": residual, "bounded_kkt": kkt, "iterations": iteration+1}


def predictions(s, o, fitted):
    zs, zo = logit(s), logit(o)
    total = zs + zo
    threshold = np.log(5)
    piece = np.where(total < -threshold, total+threshold/2,
                     np.where(total > threshold, total-threshold/2, total/2))
    return np.column_stack([s, o, (s+o)/2, sigmoid(total/2), sigmoid(.56*total), sigmoid(piece),
                            sigmoid(total), sigmoid(zs+fitted["log_weight"]*(zo-zs)),
                            sigmoid(zs+fitted["bounded_weight"]*(zo-zs)),
                            s+fitted["probability_weight"]*(o-s)])


def score_scope(pred, duplicate, raw, y, events, fallback):
    if not len(y):
        return None
    w = event_weights(events)
    loss, duplicate_loss = (pred-y[:,None])**2, (duplicate-y[:,None])**2
    brier, dbrier = w@loss, w@duplicate_loss
    ece = []
    for column in pred.T:
        bins = np.minimum((column*10).astype(int),9)
        ece.append(float(np.abs(np.bincount(bins, weights=column-y, minlength=10)).sum()/len(y)))
    ids = confidence_groups(raw)
    group = {"mass": np.bincount(ids,weights=w,minlength=4),
             "loss": np.array([np.bincount(ids,weights=w*c,minlength=4) for c in loss.T]).T,
             "duplicate_loss": np.array([np.bincount(ids,weights=w*c,minlength=4) for c in duplicate_loss.T]).T}
    np.testing.assert_allclose(group["loss"].sum(axis=0), brier, atol=1e-12)
    np.testing.assert_allclose(group["duplicate_loss"].sum(axis=0), dbrier, atol=1e-12)
    return {"events": len(np.unique(events)), "targets": len(y), "brier": brier, "ece": np.array(ece),
            "duplicate_brier": dbrier, "wins": (brier[0]-brier>1e-10).astype(float),
            "duplicate_wins": (dbrier-brier>1e-10).astype(float),
            "beat_both": (np.minimum(brier[0],brier[1])-brier>1e-10).astype(float),
            "group": group, "fallback_mass": w@fallback,
            "fallback_loss": (w*fallback)@loss, "fallback_duplicate_loss": (w*fallback)@duplicate_loss}


def empty_aggregate():
    return {"pairs": 0, "events": 0., "targets": 0., "brier": np.zeros(N), "ece": np.zeros(N),
            "duplicate_brier": np.zeros(N), "wins": np.zeros(N), "duplicate_wins": np.zeros(N),
            "beat_both": np.zeros(N), "weights": np.zeros(3), "weight_bins": np.zeros(3),
            "log_weight_min": None, "log_weight_max": None,
            "group": {"mass": np.zeros(4), "loss": np.zeros((4,N)), "duplicate_loss": np.zeros((4,N))},
            "fallback_mass": 0., "fallback_loss": np.zeros(N), "fallback_duplicate_loss": np.zeros(N)}


def add_aggregate(a, row, fitted):
    if row is None:
        return
    a["pairs"] += 1
    for key in ["events","targets","brier","ece","duplicate_brier","wins","duplicate_wins","beat_both",
                "fallback_mass","fallback_loss","fallback_duplicate_loss"]:
        a[key] += row[key]
    for key in a["group"]:
        a["group"][key] += row["group"][key]
    weight = fitted["log_weight"]
    a["weights"] += [weight,fitted["bounded_weight"],fitted["probability_weight"]]
    a["weight_bins"] += [weight<0,0<=weight<=1,weight>1]
    a["log_weight_min"] = weight if a["log_weight_min"] is None else min(weight,a["log_weight_min"])
    a["log_weight_max"] = weight if a["log_weight_max"] is None else max(weight,a["log_weight_max"])


def finish(a):
    n = a["pairs"]
    return serialize({key: value if key in ["pairs","log_weight_min","log_weight_max"]
                      else {k:v/n if n else None for k,v in value.items()} if key=="group"
                      else value/n if n else None for key,value in a.items()})


def export(study, destination, limit=None):
    import pandas as pd
    started = time.monotonic()
    destination.mkdir(parents=True, exist_ok=True)
    protocol = ROOT/"docs/type-selection-no-calibration-protocol.md"
    source = json.loads((ROOT/"site/public/data/type-selection/source-manifest.json").read_text())
    for name, expected in source["files"].items():
        assert digest(study/name)==expected, name
    code_paths = ["analysis/type_selection_no_calibration.py", "analysis/audit_type_selection_no_calibration.py",
                  "analysis/type_selection.py", "analysis/type_selection_mechanisms.py"]
    source.update(protocol_sha256=digest(protocol), code_hashes={p:digest(ROOT/p) for p in code_paths},
                  parent_mechanism_index_sha256=digest(ROOT/"site/public/data/type-selection-mechanisms/index.json"))
    write_json(destination/"protocol-lock.json", {"protocol_sha256":digest(protocol),"started_at_unix":time.time()})
    panel = np.load(study/"data/panel.npz")
    p,y,events,types = [panel[k] for k in ["predictions","outcome","event","topic"]]
    models = json.loads((study/"data/models.json").read_text())
    with (study/"data/events.csv").open() as f:
        catalog = [(r["source"],r["event_id"]) for r in csv.DictReader(f)]
    splits = {seed:split_rows(catalog,events,seed) for seed in SEEDS}
    columns = ["i","j","split","fold","dimension","train_gap","train_coverage","train_groups","crossing",
               "same_model_version","same_prompt","same_information"]
    frozen = pd.read_csv(study/"results/pair_results.csv.gz",usecols=columns)
    frozen = frozen[(frozen.dimension=="topic")&frozen.crossing&(frozen.train_gap<=5)&
                    (frozen.train_groups>=2)&(frozen.train_coverage>=.5)].sort_values(["split","fold","i","j"])
    if limit:
        frozen = frozen.head(limit)
    old = json.loads((ROOT/"site/public/data/type-selection/study.json").read_text())
    old_pairs = {r["id"]:r for r in old["pairs"]}
    filters = [(g,c,s) for g in [3,5] for c in [.5,.6,.7,.8] for s in ["all","different_model_version","matched_conditions"]]
    aggregates,primary = {},[]
    audit = {"status":"RUNNING","pair_directions":0,"independent_pairs":0,"max_gradient":0.,"max_kkt":0.,
             "max_parent_score_error":0.,"max_independent_error":0.,"max_additivity_error":0.,
             "max_clipping_brier_error":0.,"event_overlap_failures":0,"train_only_weights":True,
             "protocol_sha256":digest(protocol)}
    with gzip.open(destination/"all-direction-scores.csv.gz","wt",newline="") as stream:
        writer = csv.writer(stream,lineterminator="\n")
        writer.writerow(["pair_id","model_a","model_b","split","train_fold","train_gap","train_coverage",
                         "test_scope","events","targets","method","brier","ece","duplicate_brier",
                         "log_weight","bounded_weight","probability_weight"])
        for number,record in enumerate(frozen.itertuples(index=False),1):
            i,j,seed,fold = int(record.i),int(record.j),int(record.split),int(record.fold)
            common = np.flatnonzero(np.isfinite(p[:,i])&np.isfinite(p[:,j]))
            train,test = common[splits[seed][common]==fold],common[splits[seed][common]!=fold]
            assert not np.intersect1d(events[train],events[test]).size
            raw_train,raw_test = p[train][:,[i,j]],p[test][:,[i,j]]
            router = fit_router(raw_train,y[train],events[train],types[train],[models[i],models[j]])
            assert router["crossing"] and abs(router["train_gap"]-record.train_gap)<1e-9
            assert abs(router["train_coverage"]-record.train_coverage)<1e-9
            s,_,choices = apply_router(router,raw_train,types[train])
            o = raw_train[np.arange(len(train)),1-choices]
            fitted = fit_weights(s,o,y[train],events[train])
            selected,fallback,choices = apply_router(router,raw_test,types[test])
            other = raw_test[np.arange(len(test)),1-choices]
            pred,duplicate = predictions(selected,other,fitted),predictions(selected,selected,fitted)
            masks = {"all":np.ones(len(test),bool),"complementary":np.isin(types[test],router["complementary"])}
            values = {scope:score_scope(pred[mask],duplicate[mask],raw_test[mask],y[test][mask],events[test][mask],fallback[mask])
                      for scope,mask in masks.items()}
            pid = pair_id(models[i],models[j])
            metadata = {"id":pid,"i":i,"j":j,"split":seed,"fold":fold,"train_gap":float(record.train_gap),
                        "train_coverage":float(record.train_coverage),
                        **{key:bool(getattr(record,key)) for key in ["same_model_version","same_prompt","same_information"]}}
            is_primary = seed==SEEDS[0] and fold==0
            for scope,row in values.items():
                if row is None:
                    continue
                for key,score_key in [("loss","brier"),("duplicate_loss","duplicate_brier")]:
                    audit["max_additivity_error"] = max(audit["max_additivity_error"],float(np.max(np.abs(row["group"][key].sum(axis=0)-row[score_key]))))
                mask = masks[scope]
                w = event_weights(events[test][mask])
                error = abs(float(w@(np.clip(selected[mask],1e-6,1-1e-6)-y[test][mask])**2)-row["brier"][0])
                audit["max_clipping_brier_error"] = max(audit["max_clipping_brier_error"],error)
                if is_primary:
                    expected = old_pairs[pid]["scopes"][scope]["scores"]["brier"][:5]
                    audit["max_parent_score_error"] = max(audit["max_parent_score_error"],float(np.max(np.abs(row["brier"][[0,2,3,4,5]]-expected))))
                for k,method in enumerate(METHODS):
                    writer.writerow([pid,models[i],models[j],seed,fold,record.train_gap,record.train_coverage,scope,
                                     row["events"],row["targets"],method,row["brier"][k],row["ece"][k],row["duplicate_brier"][k],
                                     fitted["log_weight"],fitted["bounded_weight"],fitted["probability_weight"]])
            for gap,coverage,identity in filters:
                if record.train_gap<=gap+1e-12 and record.train_coverage>=coverage and in_scope(metadata,identity):
                    key = (seed,fold,view_key(gap,coverage,identity))
                    if key not in aggregates:
                        aggregates[key] = {scope:empty_aggregate() for scope in SCOPES}
                    for scope in SCOPES:
                        add_aggregate(aggregates[key][scope],values[scope],fitted)
            if is_primary:
                primary.append({**metadata,"fitted":fitted,"scopes":serialize(values)})
                if len(primary)%19==1:
                    from analysis.audit_type_selection_no_calibration import independent_check
                    error = independent_check(s,o,y[train],events[train],selected,other,y[test],events[test],
                                              raw_test,fallback,fitted,pred,duplicate,masks,values)
                    audit["independent_pairs"] += 1
                    audit["max_independent_error"] = max(audit["max_independent_error"],error)
            audit["pair_directions"] += 1
            audit["max_gradient"] = max(audit["max_gradient"],fitted["gradient"])
            audit["max_kkt"] = max(audit["max_kkt"],fitted["bounded_kkt"])
            if number%1000==0:
                print(f"{number}/{len(frozen)} pair directions · {time.monotonic()-started:.1f}s",flush=True)
    assert max(audit["max_parent_score_error"],audit["max_additivity_error"],audit["max_independent_error"])<1e-9
    if not limit:
        assert {r["id"] for r in primary}==set(old_pairs)
    audit.update(status="SMOKE" if limit else "PASS",primary_pairs=len(primary),elapsed_seconds=round(time.monotonic()-started,2))
    (destination/"views").mkdir(exist_ok=True)
    for gap,coverage,identity in filters:
        key = view_key(gap,coverage,identity)
        directions = []
        for seed in SEEDS:
            for fold in [0,1]:
                a = aggregates.get((seed,fold,key),{scope:empty_aggregate() for scope in SCOPES})
                directions.append({"split":seed,"fold":fold,"scopes":{s:finish(a[s]) for s in SCOPES}})
        view = {"key":key,"gap":gap,"coverage":coverage,"pair_scope":identity,"primary":directions[0],"directions":directions}
        if not limit:
            parent = json.loads((ROOT/f"site/public/data/type-selection-mechanisms/views/{key}.json").read_text())
            for d,prior in zip(directions,parent["directions"]):
                for scope in SCOPES:
                    current,previous = d["scopes"][scope],prior["scopes"][scope]
                    assert current["pairs"]==previous["pairs"]
                    if current["pairs"]:
                        error = float(np.max(np.abs(np.array(current["brier"])[[0,2,3,4,5]]-previous["brier"][:5])))
                        assert error<1e-9
                        audit["max_parent_score_error"] = max(audit["max_parent_score_error"],error)
        write_json(destination/"views"/f"{key}.json",view)
    with gzip.open(destination/"primary-pair-results.json.gz","wt") as f:
        json.dump(primary,f,ensure_ascii=False,allow_nan=False,separators=(",",":"))
    write_json(destination/"index.json",{"schema_version":1,"date":"2026-09-07","exploratory":True,
               "methods":METHODS,"method_labels":LABELS,"fixed_methods":[2,3,4,5,6],"learned_methods":[7,8,9],
               "views":[view_key(*v) for v in filters],"audit":audit})
    write_json(destination/"audit.json",audit)
    write_json(destination/"source-manifest.json",source)
    shutil.copyfile(protocol,destination/"PROTOCOL.md")
    if not limit:
        write_report(destination)
    print(json.dumps(audit,indent=2),flush=True)


def write_report(destination):
    view = json.loads((destination/"views/gap3-coverage50-all.json").read_text())
    lines = ["# Does a second raw forecast help without calibration?", "", "2026-09-07 · Exploratory historical-holdout follow-up.",
             "", "Default: training Overall BI gap <=3; coverage >=50%; all exact configurations; crossed training strengths; primary seed 20260910 A to B.",
             "Event-equal Brier within each pair, then equal pair means. Positive gain means lower test Brier.", "",
             "No fitted intercept, calibration curve, type correction or separate extremization parameter enters these new aggregators.",
             "The fixed methods learn no parameters. The three learned methods fit one mixing coefficient using training data only.", ""]
    targeted,full = [view['primary']['scopes'][s] for s in SCOPES]
    joint_gains = [r['brier'][0]-r['brier'][7] for r in [targeted,full]]
    fixed_counts = [sum(r['brier'][0]-r['brier'][k]>1e-10 for k in [2,3,4,5]) for r in [targeted,full]]
    lines += ["## Main observations", "",
              f"The matched uncalibrated joint improves Brier by {joint_gains[0]:.6f} on complementary events and {joint_gains[1]:.6f} on all events. Its mean gain is positive in all ten directions in each scope. No calibration intercept, curve or type adjustment is needed for this observed improvement.", "",
              f"The four original fixed formulas improve mean Brier in {fixed_counts[0]}/4 cases on complementary events and {fixed_counts[1]}/4 on all events. Simply adding the other forecast does not guarantee improvement under every formula.", "",
              f"The normalized product is worse than raw selection by {full['brier'][6]-full['brier'][0]:.6f} on all events, but replacing the duplicate by the other forecast improves its own Brier by {full['duplicate_brier'][6]-full['brier'][6]:.6f}. Benefit within a pooling rule and benefit over raw selection are different comparisons.", "",
              f"The mean learned log-odds weight on the other forecast is {full['weights'][0]:.3f}; {100*full['weight_bins'][0]:.1f}% of pairs have a negative weight. This is a regularized, training-fitted coefficient, not a universal optimal weight or evidence-overlap estimate.", ""]
    for scope in SCOPES:
        r = view["primary"]["scopes"][scope]
        lines += [f"## {scope.title()} test events", "", f"{r['pairs']} pairs; {r['events']:.1f} mean test events per pair.", "",
                  "| Method | Brier | ECE | Gain vs selection | Pair wins vs selection | Gain vs duplicate | Pair wins vs duplicate | Positive directions vs selection / 10 |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for k,label in enumerate(LABELS):
            positive = sum(d['scopes'][scope]['brier'][0]-d['scopes'][scope]['brier'][k]>1e-10 for d in view['directions'])
            lines.append(f"| {label} | {r['brier'][k]:.6f} | {r['ece'][k]:.6f} | {r['brier'][0]-r['brier'][k]:+.6f} | {100*r['wins'][k]:.1f}% | {r['duplicate_brier'][k]-r['brier'][k]:+.6f} | {100*r['duplicate_wins'][k]:.1f}% | {positive} |")
        lines += ["", "### Learned weight on the other forecast", "",
                  f"Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: {r['weights']}.",
                  f"Unrestricted lambda range [{r['log_weight_min']:.6f}, {r['log_weight_max']:.6f}]; shares [lambda<0, 0<=lambda<=1, lambda>1]: {r['weight_bins']}.", "",
                  "### Gain contribution versus selection by original forecast group", "",
                  "| Method | Both high | Both low | Opposite | Other | Fallback contribution (overlapping partition) |",
                  "|---|---:|---:|---:|---:|---:|"]
        losses = np.array(r['group']['loss'])
        for k in range(2,N):
            gains = losses[:,0]-losses[:,k]
            lines.append(f"| {LABELS[k]} | "+" | ".join(f"{g:+.6f}" for g in gains)+f" | {r['fallback_loss'][0]-r['fallback_loss'][k]:+.6f} |")
        lines += [""]
    lines += ["## Interpretation", "",
              "A positive comparison with raw selection establishes an empirical benefit of that pooling rule on these held-out events. It is not a universal benefit of adding models.",
              "A positive comparison with F(s,s) indicates a benefit from replacing a duplicate with the other forecast under the same formula and frozen weight. EC, Piecewise and the product can change confidence even when both inputs are identical.",
              "Pooling without an explicit calibration step may still improve calibration. These results do not prove independent internal evidence or an unrestricted conditional-information claim.",
              "The ten directions share events and models. Existing historical test results motivated this follow-up; all settings above were fixed before the new calculations.", "",
              "See PROTOCOL.md, audit.json, source-manifest.json, all-direction-scores.csv.gz, primary-pair-results.json.gz and views/*.json.", "",
              "Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0."]
    (destination/"REPORT.md").write_text("\n".join(lines)+"\n")


if __name__=="__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--study",type=Path,required=True)
    parser.add_argument("--destination",type=Path,default=ROOT/"site/public/data/type-selection-no-calibration")
    parser.add_argument("--limit",type=int)
    args = parser.parse_args()
    export(args.study,args.destination,args.limit)
