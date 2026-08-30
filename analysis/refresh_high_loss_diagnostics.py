"""Refresh published high-loss coverage/counts without rerunning aggregators.

Saved training-fold values repair partial-X/all-Y displays. The audited clean
cache supplies counts where saved records omitted them. All pre-existing values
outside high-loss fields are compared exactly before any public file is replaced.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import subprocess
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from analysis.high_loss_diagnostics import details_from_metric_row, fold_diagnostics, high_loss_details, oriented_diagnostics
from analysis.pair_aggregation import event_fold


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fold_id(repetition, seed, train, test):
    return f"split_{int(repetition):02d}_seed_{int(seed)}__{train}_train__{test}_test"


def csv_folds(path: Path, *, upper_left=False):
    groups = defaultdict(list)
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if not upper_left and row["method"] != "anchor":
                continue
            field = "diversity_high_loss_diversity" if upper_left else "train_high_loss_lift_complementarity"
            value = None if row[field] == "" else float(row[field])
            record = {"fold_id": fold_id(row["repetition"], row["seed"], row["train_fold"], row["test_fold"]),
                      "seed": int(row["seed"]), "train_fold": row["train_fold"],
                      "n_train": int(row["n_train"]), "n_test": int(row["n_test"]), "value": value,
                      "reason": row.get("train_high_loss_lift_reason", "")}
            key = (row["model_a"], row["model_b"], row["method"]) if upper_left else (row["model_a"], row["model_b"])
            groups[key].append(record)
    return groups


def coverage(records, *, reverse=False, equal_fold=False):
    diagnostic = fold_diagnostics(
        [r["value"] for r in records], [r["n_train"] for r in records],
        reasons=[r.get("reason", "") for r in records], details=[r.get("details") for r in records],
        aggregation="equal-fold mean of fold lifts" if equal_fold else "train-target-weighted mean of fold lifts",
    )
    return oriented_diagnostics(diagnostic, reverse)


def update_coordinate(owner, container, key, records, *, reverse=False, equal_fold=False):
    if not records:
        raise ValueError("cannot refresh a published view without its saved folds")
    diagnostic = coverage(records, reverse=reverse, equal_fold=equal_fold)
    value = container[key]
    numeric = value.get("complementarity") if isinstance(value, dict) else value
    valid = [r for r in records if r["value"] is not None]
    if numeric is None and not diagnostic["undefined_fold_count"]:
        raise ValueError('published high-loss null has no undefined included fold')
    if numeric is not None and valid:
        weights = [1 if equal_fold else r["n_train"] for r in valid]
        expected = sum(r["value"] * w for r, w in zip(valid, weights)) / sum(weights)
        if not math.isclose(numeric, expected, rel_tol=1e-11, abs_tol=1e-12):
            raise ValueError(f"saved high-loss fold values disagree with published coordinate: {numeric} != {expected}")
    if diagnostic["undefined_fold_count"]:
        if isinstance(value, dict):
            value.update(raw=None, complementarity=None, reason=diagnostic["reason"])
        else:
            container[key] = None
    owner["high_loss_diagnostics"] = diagnostic


class CleanCounts:
    def __init__(self, path: Path):
        audit = json.loads((path.parent / "audit.json").read_text())
        if digest(path) != audit["clean_intermediate_sha256"]:
            raise ValueError("clean-cache SHA mismatch")
        self.panels = defaultdict(dict)
        self.market = {}
        self.memo = {}
        self.assignments = {}
        self.sha256 = digest(path)
        with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                key = tuple(row[k] for k in ("date", "source", "event_id", "horizon"))
                p, market, y, fe, norm = (float(row[k]) for k in
                    ("prediction", "market_prediction", "outcome", "question_fixed_effect", "normalization_term"))
                losses = ((p-y)**2-fe+norm, (p-y)**2+(norm-fe))
                self.panels[row["exact_configuration"]][key] = losses
                self.market[key] = ((market-y)**2-fe+norm, (market-y)**2+(norm-fe))
                if key not in self.assignments:
                    self.assignments[key] = tuple(event_fold(key[1], key[2], seed) for seed in range(20260825, 20260835))
        self.panels["Polymarket Freeze"] = self.market

    def full_pair(self, first, second):
        a, b = self.panels[first], self.panels[second]
        keys = sorted(a.keys() & b.keys())
        return high_loss_details([a[key][0] for key in keys], [b[key][0] for key in keys])

    def pair(self, first, second, *, configuration=False):
        cache_key = (first, second, configuration)
        if cache_key in self.memo:
            return self.memo[cache_key]
        if first not in self.panels or second not in self.panels:
            raise ValueError(f"exact configuration absent from validated clean cache: {first}, {second}")
        a, b = self.panels[first], self.panels[second]
        keys = sorted(a.keys() & b.keys())
        column = 1 if configuration else 0
        output = []
        for repetition, seed in enumerate(range(20260825, 20260835), start=1):
            for train, test in (("A", "B"), ("B", "A")):
                selected = [key for key in keys if self.assignments[key][repetition-1] == train]
                n = len(selected)
                if not n or n == len(keys):
                    continue
                na = sum(a[k][column] > .25 for k in selected)
                nb = sum(b[k][column] > .25 for k in selected)
                nab = sum(a[k][column] > .25 and b[k][column] > .25 for k in selected)
                reason = ("both_marginal_high_loss_rates_zero" if not na and not nb else
                          "model_a_marginal_high_loss_rate_zero" if not na else
                          "model_b_marginal_high_loss_rate_zero" if not nb else "")
                lift = None if reason else (nab/n)/((na/n)*(nb/n))
                details = {"threshold": .25, "n_targets": n, "high_count_a": na, "high_count_b": nb,
                           "joint_high_count": nab, "expected_joint_count": na*nb/n, "reason": reason}
                output.append({"fold_id": fold_id(repetition,seed,train,test), "seed": seed, "train_fold": train,
                               "n_train": n, "n_test": len(keys)-n, "value": None if lift is None else 1-lift,
                               "reason": reason, "details": details})
        self.memo[cache_key] = output
        return output


def annotate_saved(records, computed):
    by_id = {r["fold_id"]: r for r in computed}
    for record in records:
        other = by_id[record["fold_id"]]
        if (record["n_train"], record["n_test"]) != (other["n_train"], other["n_test"]):
            raise ValueError("saved fold / clean cache support mismatch")
        if (record["value"] is None) != (other["value"] is None):
            raise ValueError("saved fold / clean cache high-loss validity mismatch")
        if record["value"] is not None and not math.isclose(record["value"], other["value"], rel_tol=1e-11, abs_tol=1e-12):
            raise ValueError("saved fold / clean cache high-loss value mismatch")
        record.update(details=other["details"], reason=other["reason"])


def verify_preserved(before, after, path=()):
    """Only high-loss fields and new diagnostics may differ, even at one ULP."""
    if any(k in {"high_loss_lift", "high_loss_diversity", "high_loss_diagnostics"} for k in path):
        return 0
    if isinstance(before, dict):
        if before.get("metric") == "high_loss_lift" or before.get("metric_id") == "high_loss_lift":
            return 0
        added = set(after) - set(before)
        if added - {"high_loss_diagnostics"}:
            raise ValueError(f"unexpected fields at {path}: {added}")
        if set(before) - set(after):
            raise ValueError(f"removed fields at {path}")
        return sum(verify_preserved(v, after[k], (*path,k)) for k,v in before.items())
    if isinstance(before, list):
        if len(before) != len(after):
            raise ValueError(f"array membership changed at {path}")
        return sum(verify_preserved(a,b,(*path,str(i))) for i,(a,b) in enumerate(zip(before,after)))
    if before != after:
        raise ValueError(f"non-high-loss value changed at {path}: {before!r} -> {after!r}")
    return 1


def high_loss_null_changes(before, after, path=()):
    """Count coordinate null repairs, not their duplicate raw/axis representations."""
    if path and path[-1] in {"high_loss_lift", "high_loss_diversity"}:
        first = before.get("complementarity") if isinstance(before, dict) else before
        second = after.get("complementarity") if isinstance(after, dict) else after
        return int(isinstance(first, (int, float)) and second is None)
    if isinstance(before, dict):
        return sum(high_loss_null_changes(v,after[k],(*path,k)) for k,v in before.items())
    if isinstance(before, list):
        return sum(high_loss_null_changes(a,b,(*path,str(i))) for i,(a,b) in enumerate(zip(before,after)))
    return 0


def validate_full_detail(point, detail, numeric, n):
    if detail['n_targets'] != n:
        raise ValueError('full-sample clean support mismatch')
    lift = (detail['joint_high_count'] / n) / ((detail['high_count_a'] / n) * (detail['high_count_b'] / n)) if not detail['reason'] else None
    if (numeric is None) != (lift is None):
        raise ValueError('full-sample high-loss validity mismatch')
    if numeric is not None and not math.isclose(numeric,1-lift,rel_tol=1e-11,abs_tol=1e-12):
        raise ValueError('full-sample high-loss value mismatch')
    point['high_loss_diagnostics'] = detail


def run(site: Path, derived: Path, report_path: Path, *, include_configuration=True, baseline_ref=None):
    fixed = csv_folds(derived/'fixed_focal_without_freeze/fold_method_results.csv.gz')
    freeze = csv_folds(derived/'freeze_exposed_market_aggregation/fold_method_results.csv.gz')
    without = csv_folds(derived/'freeze_exposed_market_aggregation/without_freeze_base_fold_method_results.csv.gz')
    upper = csv_folds(derived/'upper_left_model_pair_aggregation/crossfit_fold_methods.csv.gz',upper_left=True)
    clean = CleanCounts(derived/'configuration_pair_aggregation/clean_panel.csv.gz')
    for groups in (freeze, without):
        for (a,b), records in groups.items():
            if a == 'Polymarket Freeze':
                annotate_saved(records, clean.pair(a,b))
    for (a,b,_), records in upper.items():
        annotate_saved(records, clean.pair(a,b))
    fixed_payload = json.loads((site/'pair-aggregation/fixed-focal-without-freeze.json').read_text())
    canonical = {}
    for name, configs in fixed_payload['audit']['model_configurations'].items():
        if len(configs)==1:
            canonical[name] = f'{name} ({configs[0]})' if configs[0] else name
    for (a,b), records in without.items():
        version = a.removesuffix(' (without freeze values)')
        if version in canonical and canonical[version] in clean.panels:
            annotate_saved(records,clean.pair(canonical[version],b))
    reports=[]
    with tempfile.TemporaryDirectory(prefix='forecastbench-high-loss-refresh-') as staging:
        staged=[]
        def save(relative, payload, before):
            baseline_bytes = None
            if baseline_ref:
                repo = Path(__file__).resolve().parents[1]
                repository_path = (site/relative).resolve().relative_to(repo)
                baseline_bytes = subprocess.check_output(['git','-C',str(repo),'show',f'{baseline_ref}:{repository_path.as_posix()}'])
                before = json.loads(baseline_bytes)
            preserved=verify_preserved(before,payload)
            source=site/relative
            target=Path(staging)/str(len(staged))
            compact=relative.startswith('configuration-pair-aggregation/')
            target.write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False,
                             separators=(',',':') if compact else None,indent=None if compact else 2)+'\n')
            reports.append({'file':relative,'before_sha256':hashlib.sha256(baseline_bytes).hexdigest() if baseline_bytes is not None else digest(source),'after_sha256':digest(target),
                            'preserved_non_high_loss_scalars':preserved,
                            'high_loss_coordinates_changed_to_null':high_loss_null_changes(before,payload)})
            staged.append((source,target))
        def load(relative):
            before=json.loads((site/relative).read_text())
            return before,json.loads(json.dumps(before))
        for relative,kind,groups in [
            ('pair-aggregation/all-six-family-pairs.json','pair',fixed),
            ('pair-aggregation/fixed-focal-without-freeze.json','fixed',fixed),
            ('polymarket-aggregation/freeze-exposed-correlation.json','freeze',freeze),
            ('polymarket-aggregation/without-freeze-base.json','fixed',without),
            ('pair-aggregation/upper-left-model-pairs.json','upper',upper),
            ('polymarket-aggregation/freeze-baseline.json','baseline',None),
        ]:
            before,payload=load(relative)
            if kind in {'pair','baseline'}:
                cross=payload['cross_fit']
                lists=[cross['eligible_points'],cross['near_bi_points']]
                for direction in cross['directional_points'].values():
                    lists.extend([direction['eligible_points'],direction['near_bi_points']])
                for points in lists:
                    for point in points:
                        a,b=point['model_a'],point['model_b']
                        records=(clean.pair(a,canonical[b]) if kind=='baseline' else groups[(a,b)])
                        ids=set(point['cross_fit']['fold_ids'])
                        selected=[r for r in records if r['fold_id'] in ids]
                        if len(selected)!=len(ids):raise ValueError('missing saved pair fold')
                        if sum(r['n_train'] for r in selected)!=point['cross_fit']['train_target_rows']:
                            raise ValueError('published train support mismatch')
                        update_coordinate(point,point['metrics'],'high_loss_lift',selected)
            elif kind in {'fixed','freeze'}:
                for point in payload['points']:
                    if kind=='freeze':
                        records=groups[('Polymarket Freeze',point['exact_configuration'])]
                        combined=point
                    else:
                        combined=point['combined']
                        records=groups[(combined['base_name'],combined['partner_name'])]
                    update_coordinate(combined,combined['train_diversity'],'high_loss_lift',records)
                    for direction,view in point['directions'].items():
                        selected=[r for r in records if r['train_fold']==('A' if direction=='a_to_b' else 'B')]
                        update_coordinate(view,view['train_diversity'],'high_loss_lift',selected)
                if relative=='pair-aggregation/fixed-focal-without-freeze.json':
                    from analysis.fixed_focal_without_freeze import focal_correlation_summary
                    refreshed={(row['base_model'],row['method']):row for row in focal_correlation_summary(payload['points']) if row['metric']=='high_loss_lift'}
                    payload['evaluation']['focal_correlation_summary']=[
                        refreshed[(row['base_model'],row['method'])] if row['metric']=='high_loss_lift' else row
                        for row in payload['evaluation']['focal_correlation_summary']]
            elif kind=='upper':
                for point in payload['crossfit']['rows']:
                    records=groups[(point['model_a'],point['model_b'],point['method'])]
                    update_coordinate(point,point['mean_train_diversity'],'high_loss_diversity',records,equal_fold=True)
                for point in payload['fixed']['rows']:
                    validate_full_detail(point,clean.full_pair(point['model_a'],point['model_b']),
                                         point['diversity']['high_loss_diversity'],point['n_pair'])
            save(relative,payload,before)
        relative='polymarket-aggregation/market-diversity-performance.json'
        before,payload=load(relative)
        for point in payload['points']:
            validate_full_detail(point,clean.full_pair(point['exact_configuration'],'Polymarket Freeze'),
                                 point['diversity']['high_loss_lift'],point['n_common'])
        save(relative,payload,before)
        relative='focal-gain/gpt-4-1-2025-04-14.json'
        before,payload=load(relative)
        focal=payload['focal_model']
        metric_rows={}
        with gzip.open(site/'global-baseline/pair-metrics.csv.gz','rt',encoding='utf-8',newline='') as handle:
            for row in csv.DictReader(handle):
                if row['global_scope']=='official_full' and focal in (row['model_a'],row['model_b']):
                    partner=row['model_b'] if row['model_a']==focal else row['model_a']
                    metric_rows[partner]=row
        for point in payload['points']:
            row=metric_rows[point['partner']]
            detail=details_from_metric_row(row,reverse=row['model_a']!=focal)
            if detail.get('count_diagnostics_available'):
                validate_full_detail(point,detail,point['metrics']['high_loss_lift']['complementarity'],point['n_overlap'])
            else:
                point['high_loss_diagnostics']=detail
        save(relative,payload,before)
        if include_configuration:
            manifest=json.loads((site/'configuration-pair-aggregation/manifest.json').read_text())
            for configuration in manifest['configurations']:
                relative='configuration-pair-aggregation/'+configuration['file']
                before,payload=load(relative)
                for partner in payload['partners']:
                    if partner['status']!='eligible':continue
                    records=clean.pair(payload['base_configuration'],partner['partner']['exact_configuration'],configuration=True)
                    by_id={r['fold_id']:r for r in records}
                    for views in partner['views'].values():
                        for view in views.values():
                            if view is None:continue
                            selected=[by_id[key] for key in view['fold_ids']]
                            if sum(r['n_train'] for r in selected)!=view['train_target_cells']:
                                raise ValueError('configuration train support mismatch')
                            update_coordinate(view,view['train_diversity'],'high_loss_lift',selected)
                save(relative,payload,before)
                clean.memo.clear() # Bound memory; no forecast aggregation is repeated.
        for source,target in staged:
            os.replace(target,source)
    report={'generated_at':datetime.now(timezone.utc).isoformat(),'files':reports,
            'file_count':len(reports),'preserved_non_high_loss_scalars':sum(r['preserved_non_high_loss_scalars'] for r in reports),
            'non_high_loss_changes':0,'scores_or_weights_refit':False,'clean_cache_sha256':clean.sha256,
            'baseline_ref':baseline_ref,
            'high_loss_coordinates_changed_to_null':sum(row['high_loss_coordinates_changed_to_null'] for row in reports),
            'script_sha256':digest(Path(__file__))}
    report_path.parent.mkdir(parents=True,exist_ok=True)
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='files'},indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-data',type=Path,default=Path('site/public/data'))
    parser.add_argument('--derived-data',type=Path,default=Path('data/derived'))
    parser.add_argument('--report',type=Path,default=Path('data/derived/high_loss_diagnostics_audit/report.json'))
    parser.add_argument('--skip-configuration',action='store_true')
    parser.add_argument('--baseline-ref',help='Optional immutable Git revision for the before/after audit; never changes the checkout.')
    args=parser.parse_args()
    run(args.site_data,args.derived_data,args.report,include_configuration=not args.skip_configuration,baseline_ref=args.baseline_ref)
