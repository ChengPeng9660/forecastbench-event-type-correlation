"""Frozen input- and output-calibrated extensions of the raw pooling study."""
from __future__ import annotations
import argparse
import csv
import gzip
import json
from pathlib import Path
import shutil
import time
import numpy as np
from analysis.type_selection import ROOT, SEEDS, apply_router, digest, event_weights, fit_router, in_scope, pair_id, split_rows, write_json
from analysis.type_selection_mechanisms import logit, sigmoid, serialize, view_key
from analysis.type_selection_no_calibration import METHODS, LABELS as RAW_LABELS, SCOPES, fit_weights, predictions, score_scope, empty_aggregate, add_aggregate, finish

STAGES = ['input', 'output']
LABELS = list(RAW_LABELS)
LABELS[0], LABELS[1], LABELS[7] = 'Calibrated type selection', 'Calibrated other forecast alone', 'One-weight log-odds pool'
PENALTY = np.array([.0005, .005])


def calibrate(p, coef):
    z = logit(p)
    return sigmoid(z + coef[:, 0] + z * coef[:, 1] / 4)


def fit_calibrators(p, y, events):
    """Independent two-coefficient convex fits, batched without sharing coefficients."""
    z = logit(p)
    x, w = z / 4, event_weights(events)[:, None]
    coef = np.zeros((p.shape[1], 2))
    counts = np.zeros(p.shape[1], int)
    def objective(c):
        eta = z + c[:, 0] + x * c[:, 1]
        return (w * (np.logaddexp(0, eta) - y[:, None] * eta)).sum(axis=0) + .5 * (PENALTY * c**2).sum(axis=1)
    for _ in range(60):
        q = calibrate(p, coef)
        residual = w * (q - y[:, None])
        g = np.column_stack([residual.sum(axis=0), (residual*x).sum(axis=0)]) + PENALTY * coef
        active = np.max(np.abs(g), axis=1) >= 1e-8
        if not active.any():
            break
        counts[active] += 1
        v = w * q * (1-q)
        h00, h01, h11 = v.sum(axis=0)+PENALTY[0], (v*x).sum(axis=0), (v*x*x).sum(axis=0)+PENALTY[1]
        det = h00*h11-h01*h01
        step = np.column_stack([(h11*g[:, 0]-h01*g[:, 1])/det, (h00*g[:, 1]-h01*g[:, 0])/det])
        step[~active] = 0
        old, scale = objective(coef), np.ones(p.shape[1])
        for _ in range(30):
            failed = objective(coef-scale[:, None]*step) > old-1e-4*scale*(g*step).sum(axis=1)+1e-15
            if not failed.any():
                break
            scale[failed] /= 2
        coef -= scale[:, None]*step
    q = calibrate(p, coef)
    residual = w*(q-y[:, None])
    g = np.column_stack([residual.sum(axis=0), (residual*x).sum(axis=0)])+PENALTY*coef
    gradients = np.max(np.abs(g), axis=1)
    assert gradients.max() < 1e-7
    return coef, {'gradient': gradients.tolist(), 'iterations': counts.tolist(), 'objective': objective(coef).tolist()}


def fit_pipeline(raw, choices, y, events):
    rows = np.arange(len(y))
    s, o = raw[rows, choices], raw[rows, 1-choices]
    raw_weights = fit_weights(s, o, y, events)
    raw_predictions = predictions(s, o, raw_weights)
    input_coef, input_audit = fit_calibrators(raw, y, events)
    calibrated = calibrate(raw, input_coef)
    input_weights = fit_weights(calibrated[rows, choices], calibrated[rows, 1-choices], y, events)
    output_coef, output_audit = fit_calibrators(raw_predictions, y, events)
    return {'raw_weights': raw_weights, 'input_weights': input_weights,
            'input_coef': input_coef, 'output_coef': output_coef,
            'input_audit': input_audit, 'output_audit': output_audit}


def apply_pipeline(fit, raw, choices):
    rows = np.arange(len(raw))
    s, o = raw[rows, choices], raw[rows, 1-choices]
    raw_pred = predictions(s, o, fit['raw_weights'])
    raw_duplicate = predictions(s, s, fit['raw_weights'])
    c = calibrate(raw, fit['input_coef'])
    cs, co = c[rows, choices], c[rows, 1-choices]
    return raw_pred, {
        'input': (predictions(cs, co, fit['input_weights']), predictions(cs, cs, fit['input_weights'])),
        'output': (calibrate(raw_pred, fit['output_coef']), calibrate(raw_duplicate, fit['output_coef']))}


def new_aggregate():
    a = empty_aggregate()
    a.update(raw_brier=np.zeros(10), raw_ece=np.zeros(10), calibration_wins=np.zeros(10))
    return a


def add(a, row, fitted):
    add_aggregate(a, row, fitted)
    if row:
        for k in ['raw_brier', 'raw_ece', 'calibration_wins']:
            a[k] += row[k]


def export(study, destination, limit=None):
    import pandas as pd
    started = time.monotonic()
    destination.mkdir(parents=True, exist_ok=True)
    protocol = ROOT/'docs/type-selection-calibrated-pooling-protocol.md'
    parent_dir = ROOT/'site/public/data/type-selection-no-calibration'
    source = json.loads((parent_dir/'source-manifest.json').read_text())
    for name, expected in source['files'].items():
        assert digest(study/name) == expected, name
    code_paths = ['analysis/type_selection_calibrated_pooling.py', 'analysis/audit_type_selection_calibrated_pooling.py',
                  'analysis/type_selection_no_calibration.py', 'analysis/type_selection.py', 'analysis/type_selection_mechanisms.py']
    source = {'files': source['files'], 'protocol_sha256': digest(protocol),
              'code_hashes': {p: digest(ROOT/p) for p in code_paths}, 'parent_raw_index_sha256': digest(parent_dir/'index.json')}
    write_json(destination/'protocol-lock.json', {'protocol_sha256': digest(protocol), 'started_at_unix': time.time()})
    panel = np.load(study/'data/panel.npz')
    p, y, events, types = [panel[k] for k in ['predictions', 'outcome', 'event', 'topic']]
    models = json.loads((study/'data/models.json').read_text())
    with (study/'data/events.csv').open() as f:
        catalog = [(r['source'], r['event_id']) for r in csv.DictReader(f)]
    splits = {seed: split_rows(catalog, events, seed) for seed in SEEDS}
    columns = ['i','j','split','fold','dimension','train_gap','train_coverage','train_groups','crossing','same_model_version','same_prompt','same_information']
    frozen = pd.read_csv(study/'results/pair_results.csv.gz', usecols=columns)
    frozen = frozen[(frozen.dimension=='topic') & frozen.crossing & (frozen.train_gap<=5) & (frozen.train_groups>=2) & (frozen.train_coverage>=.5)].sort_values(['split','fold','i','j'])
    if limit:
        frozen = frozen.head(limit)
    with gzip.open(parent_dir/'primary-pair-results.json.gz', 'rt') as f:
        old_pairs = {r['id']: r for r in json.load(f)}
    filters = [(g,c,s) for g in [3,5] for c in [.5,.6,.7,.8] for s in ['all','different_model_version','matched_conditions']]
    aggregates, primary = {}, []
    audit = {'status':'RUNNING', 'pair_directions':0, 'independent_pairs':0, 'max_gradient':0.,
             'max_parent_score_error':0., 'max_parent_calibrated_selection_error':0., 'max_independent_error':0.,
             'max_additivity_error':0., 'event_overlap_failures':0, 'train_only_calibration':True,
             'input_nonpositive_slopes':0, 'output_nonpositive_slopes':0, 'calibrator_fits':0, 'protocol_sha256':digest(protocol)}
    with gzip.open(destination/'all-direction-scores.csv.gz', 'wt', newline='') as stream:
        writer = csv.writer(stream, lineterminator='\n')
        writer.writerow(['pair_id','model_a','model_b','split','train_fold','train_gap','train_coverage','stage','test_scope','events','targets','method','brier','ece','raw_brier','raw_ece','duplicate_brier'])
        for number, record in enumerate(frozen.itertuples(index=False), 1):
            i,j,seed,fold = int(record.i),int(record.j),int(record.split),int(record.fold)
            common = np.flatnonzero(np.isfinite(p[:,i]) & np.isfinite(p[:,j]))
            train,test = common[splits[seed][common]==fold],common[splits[seed][common]!=fold]
            assert not np.intersect1d(events[train], events[test]).size
            raw_train,raw_test = p[train][:,[i,j]],p[test][:,[i,j]]
            router = fit_router(raw_train,y[train],events[train],types[train],[models[i],models[j]])
            assert router['crossing'] and abs(router['train_gap']-record.train_gap)<1e-9
            assert abs(router['train_coverage']-record.train_coverage)<1e-9
            _,_,train_choices = apply_router(router,raw_train,types[train])
            _,fallback,test_choices = apply_router(router,raw_test,types[test])
            fit = fit_pipeline(raw_train,train_choices,y[train],events[train])
            raw_pred, outputs = apply_pipeline(fit,raw_test,test_choices)
            masks = {'all':np.ones(len(test),bool), 'complementary':np.isin(types[test],router['complementary'])}
            raw_values = {s:score_scope(raw_pred[m],raw_pred[m],raw_test[m],y[test][m],events[test][m],fallback[m]) for s,m in masks.items()}
            values = {}
            for stage,(pred,dup) in outputs.items():
                values[stage] = {}
                for scope,mask in masks.items():
                    row = score_scope(pred[mask],dup[mask],raw_test[mask],y[test][mask],events[test][mask],fallback[mask])
                    if row:
                        row.update(raw_brier=raw_values[scope]['brier'],raw_ece=raw_values[scope]['ece'])
                        row['calibration_wins'] = (row['raw_brier']-row['brier']>1e-10).astype(float)
                    values[stage][scope] = row
            pid = pair_id(models[i],models[j])
            metadata = {'id':pid,'i':i,'j':j,'split':seed,'fold':fold,'train_gap':float(record.train_gap),'train_coverage':float(record.train_coverage),
                        **{k:bool(getattr(record,k)) for k in ['same_model_version','same_prompt','same_information']}}
            is_primary = seed==SEEDS[0] and fold==0
            for stage in STAGES:
                for scope,row in values[stage].items():
                    if not row:
                        continue
                    for k,score_key in [('loss','brier'),('duplicate_loss','duplicate_brier')]:
                        audit['max_additivity_error'] = max(audit['max_additivity_error'],float(np.max(np.abs(row['group'][k].sum(axis=0)-row[score_key]))))
                    if is_primary:
                        prior = old_pairs[pid]['scopes'][scope]
                        assert row['events']==prior['events'] and row['targets']==prior['targets']
                        for k in ['brier','ece']:
                            audit['max_parent_score_error'] = max(audit['max_parent_score_error'],float(np.max(np.abs(row['raw_'+k]-prior[k]))))
                    for k,method in enumerate(METHODS):
                        writer.writerow([pid,models[i],models[j],seed,fold,record.train_gap,record.train_coverage,stage,scope,row['events'],row['targets'],method,row['brier'][k],row['ece'][k],row['raw_brier'][k],row['raw_ece'][k],row['duplicate_brier'][k]])
            for gap,coverage,identity in filters:
                if record.train_gap<=gap+1e-12 and record.train_coverage>=coverage and in_scope(metadata,identity):
                    key = (seed,fold,view_key(gap,coverage,identity))
                    if key not in aggregates:
                        aggregates[key] = {stage:{scope:new_aggregate() for scope in SCOPES} for stage in STAGES}
                    for stage in STAGES:
                        for scope in SCOPES:
                            add(aggregates[key][stage][scope],values[stage][scope],fit['input_weights' if stage=='input' else 'raw_weights'])
            if is_primary:
                primary.append({**metadata,'fit':serialize(fit),'stages':serialize(values)})
                if len(primary)%19==1:
                    from analysis.audit_type_selection_calibrated_pooling import independent_check
                    error = independent_check(raw_train,train_choices,y[train],events[train],raw_test,test_choices,y[test],events[test],fallback,fit,outputs,masks,values)
                    audit['independent_pairs'] += 1
                    audit['max_independent_error'] = max(audit['max_independent_error'],error)
            for stage in STAGES:
                audit['max_gradient'] = max(audit['max_gradient'],max(fit[stage+'_audit']['gradient']))
                audit[stage+'_nonpositive_slopes'] += int(np.sum(1+fit[stage+'_coef'][:,1]/4<=0))
            audit['calibrator_fits'] += 12
            audit['pair_directions'] += 1
            if number%500==0:
                print(f'{number}/{len(frozen)} pair directions · {time.monotonic()-started:.1f}s',flush=True)
    assert max(audit['max_parent_score_error'],audit['max_additivity_error'])<1e-9
    assert audit['max_independent_error']<1e-6
    if not limit:
        assert {r['id'] for r in primary}==set(old_pairs)
    (destination/'views').mkdir(exist_ok=True)
    for gap,coverage,identity in filters:
        key = view_key(gap,coverage,identity)
        directions = []
        for seed in SEEDS:
            for fold in [0,1]:
                a = aggregates.get((seed,fold,key),{stage:{scope:new_aggregate() for scope in SCOPES} for stage in STAGES})
                directions.append({'split':seed,'fold':fold,'stages':{stage:{s:finish(a[stage][s]) for s in SCOPES} for stage in STAGES}})
        if not limit:
            parent = json.loads((parent_dir/f'views/{key}.json').read_text())
            mechanism = json.loads((ROOT/f'site/public/data/type-selection-mechanisms/views/{key}.json').read_text())
            for d,prior,mech in zip(directions,parent['directions'],mechanism['directions']):
                for scope in SCOPES:
                    for stage in STAGES:
                        current,previous = d['stages'][stage][scope],prior['scopes'][scope]
                        assert current['pairs']==previous['pairs']
                        if current['pairs']:
                            for metric in ['brier','ece']:
                                error = float(np.max(np.abs(np.array(current['raw_'+metric])-previous[metric])))
                                assert error<1e-9
                                audit['max_parent_score_error'] = max(audit['max_parent_score_error'],error)
                    r = d['stages']['output'][scope]
                    if r['pairs']:
                        error = abs(r['brier'][0]-mech['scopes'][scope]['brier'][5])
                        assert error<1e-8
                        audit['max_parent_calibrated_selection_error'] = max(audit['max_parent_calibrated_selection_error'],error)
        write_json(destination/'views'/f'{key}.json',{'key':key,'gap':gap,'coverage':coverage,'pair_scope':identity,'primary':directions[0],'directions':directions})
    with gzip.open(destination/'primary-pair-results.json.gz','wt') as f:
        json.dump(primary,f,ensure_ascii=False,allow_nan=False,separators=(',',':'))
    audit.update(status='SMOKE' if limit else 'PASS',primary_pairs=len(primary),elapsed_seconds=round(time.monotonic()-started,2))
    write_json(destination/'index.json',{'schema_version':1,'date':'2026-09-07','exploratory':True,'stages':STAGES,'methods':METHODS,'method_labels':LABELS,'fixed_methods':[2,3,4,5,6],'learned_methods':[7,8,9],'views':[view_key(*v) for v in filters],'audit':audit})
    write_json(destination/'audit.json',audit)
    write_json(destination/'source-manifest.json',source)
    shutil.copyfile(protocol,destination/'PROTOCOL.md')
    if not limit:
        write_report(destination)
    print(json.dumps(audit,indent=2),flush=True)


def write_report(destination):
    view = json.loads((destination/'views/gap3-coverage50-all.json').read_text())
    lines = ['# Does calibration change the value of a second forecast?', '',
             '2026-09-07 · Exploratory historical-holdout follow-up.', '',
             'Default: training Overall BI gap <=3, coverage >=50%, all exact configurations. Primary seed 20260910 A to B. The raw-training router, pair eligibility and test supports remain frozen.', '',
             'Input calibration separately calibrates the two exact models, then pools. Output calibration pools raw forecasts, then separately calibrates each method. Each version uses its own calibrated-selection baseline. Event-equal Brier within pair, then equal pair means. ECE is target-weighted within pair (ten bins), then equal pair means.', '']
    for stage in STAGES:
        lines += [f'## {stage.title()} calibration','']
        for scope in SCOPES:
            r = view['primary']['stages'][stage][scope]
            count = sum(r['brier'][0]-r['brier'][k]>1e-10 for k in [2,3,4,5])
            lines += [f'### {scope.title()} events', '',f"{r['pairs']} pairs; {r['events']:.1f} mean test events per pair. {count}/4 original fixed formulas improve mean Brier versus this version's calibrated selection.",'',
                      '| Method | Raw Brier | Calibrated Brier | Calibration gain | Gain vs calibrated selection | Pair wins | Gain vs duplicate | Positive directions / 10 | Raw ECE | Calibrated ECE |',
                      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
            for k,label in enumerate(LABELS):
                positive = sum(d['stages'][stage][scope]['brier'][0]-d['stages'][stage][scope]['brier'][k]>1e-10 for d in view['directions'])
                lines.append(f"| {label} | {r['raw_brier'][k]:.6f} | {r['brier'][k]:.6f} | {r['raw_brier'][k]-r['brier'][k]:+.6f} | {r['brier'][0]-r['brier'][k]:+.6f} | {100*r['wins'][k]:.1f}% | {r['duplicate_brier'][k]-r['brier'][k]:+.6f} | {positive} | {r['raw_ece'][k]:.6f} | {r['ece'][k]:.6f} |")
            lines += ['',f"Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: {r['weights']}.",'']
    lines += ['## Interpretation and limitations','',
              'Calibration can change a single model substantially. Aggregation benefit is therefore measured relative to the equally calibrated selection baseline of the same version. A calibration gain compares each complete method with its own raw version; it is a different comparison.',
              'Duplicate controls freeze every trained weight and calibration coefficient. Input: F(s_c,s_c). Output: C_m(F(s,s)). The latter reuses the calibrator fitted on the real two-model training outputs; it is a substitution diagnostic, not a separately optimized single-model pipeline.',
              'Calibrators minimize regularized training log loss, so neither held-out Brier nor ECE is guaranteed to improve. Output calibration and input calibration use different calibrated-selection baselines and answer different questions.',
              'Multiple fitted stages reuse the outer training sample; no inner cross-fitting is claimed. All complete pipelines are evaluated on disjoint frozen outer test events. Existing historical test reuse makes this exploratory. Ten directions reuse events and models and are not independent replications.',
              'A positive gain supports usefulness under the specified pipeline and comparator. It does not identify independent internal evidence or an unrestricted conditional-information mechanism. Normalized product is a heuristic pooling formula, not a joint probability of distinct events.', '',
              'See PROTOCOL.md, source-manifest.json, audit.json, all-direction-scores.csv.gz, primary-pair-results.json.gz (including all calibration coefficients) and all 24 views.', '',
              'Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.']
    (destination/'REPORT.md').write_text('\n'.join(lines)+'\n')


if __name__=='__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--study',type=Path,required=True)
    parser.add_argument('--destination',type=Path,default=ROOT/'site/public/data/type-selection-calibrated-pooling')
    parser.add_argument('--limit',type=int)
    args = parser.parse_args()
    export(args.study,args.destination,args.limit)
