"""Post-hoc complementary teams; every model-count comparison shares support."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import time
import numpy as np
from analysis.type_selection import ROOT, brier, digest, event_weights, split_rows, write_json
from analysis.type_selection_mechanisms import TYPES, features, fit_logistic, logit, sigmoid, serialize
from analysis.aggregation_stability import scores, independent_score_error

METHODS = ['type_selection', 'strong_single', 'matched_calibrated', 'matched_uncalibrated', 'simple_mean']
LABELS = ['Type-based selection', 'Strong single-forecast baseline', 'Matched aggregation', 'Matched aggregation · no calibration', 'Simple mean']
SEED = 20260910
TOL = 1e-12


def team_id(names):
    ordered = sorted(names, key=lambda x: (x.casefold(), x))
    return 'g-' + hashlib.sha256('\0'.join(ordered).encode()).hexdigest()[:12]


def profile(raw, y, events, types, names):
    overall = brier(raw, y, events)
    order = sorted(range(len(names)), key=lambda i: (overall[i], names[i].casefold(), names[i]))
    tied = [i for i in order if abs(overall[i]-overall[order[0]]) <= TOL]
    fallback = min(tied, key=lambda i: (names[i].casefold(), names[i]))
    routes = []
    for t in TYPES:
        mask = types == t
        count = len(np.unique(events[mask]))
        if not count:
            continue
        loss = brier(raw[mask], y[mask], events[mask])
        rank = sorted(range(len(names)), key=lambda i: (loss[i], names[i].casefold(), names[i]))
        edge = 100*(np.sqrt(loss[rank[1]])-np.sqrt(loss[rank[0]]))
        supported = count >= 30
        selected = rank[0] if supported and loss[rank[1]]-loss[rank[0]] > TOL else fallback
        routes.append(dict(type=t, train_events=count, train_brier=loss.tolist(), selected=selected,
                           complementary=bool(supported and edge >= 1), train_edge_bi=float(edge)))
    supported = [r['type'] for r in routes if r['train_events'] >= 30]
    coverage = float(event_weights(events) @ np.isin(types, supported))
    return dict(overall_brier=overall.tolist(), overall_order=order, fallback=fallback, routes=routes,
                train_events=len(np.unique(events)), coverage=coverage,
                ability_range=float(100*(np.sqrt(overall.max())-np.sqrt(overall.min()))))


def classify(fit, raw, y, events, types):
    routes = []
    status = 'eligible'
    if min(fit['train_events'], len(np.unique(events))) < 100:
        status = 'insufficient_events'
    elif fit['ability_range'] > 3+TOL:
        status = 'ability_range'
    elif fit['coverage'] < .5-TOL or sum(r['train_events'] >= 30 for r in fit['routes']) < 2:
        status = 'insufficient_types'
    elif len({r['selected'] for r in fit['routes'] if r['complementary']}) < raw.shape[1]:
        status = 'missing_specialist'
    for route in fit['routes']:
        mask = types == route['type']
        count = len(np.unique(events[mask]))
        loss = brier(raw[mask], y[mask], events[mask]) if count else np.full(raw.shape[1], np.nan)
        retained = count > 0 and loss[route['selected']] <= np.min(loss)+TOL
        if route['complementary'] and not retained and status == 'eligible':
            status = 'type_reversal' if count else 'missing_test_type'
        routes.append({**route, 'test_events':count, 'test_brier':loss.tolist() if count else [None]*raw.shape[1],
                       'test_status':'retained' if retained else 'reversed' if count else 'missing'})
    return dict(status=status, routes=routes)


def choices(fit, types):
    mapping = {r['type']:r['selected'] for r in fit['routes']}
    return np.array([mapping.get(t, fit['fallback']) for t in types])


def fusion_features(raw, selected, order):
    rows = np.arange(len(raw))
    s = raw[rows, selected]
    ordered = np.broadcast_to(np.array(order), raw.shape)
    others = ordered[ordered != selected[:,None]].reshape(len(raw), raw.shape[1]-1)
    x = (logit(np.take_along_axis(raw, others, axis=1))-logit(s)[:,None])/4
    return s, x


def fit_subset(raw, y, events, types, names):
    router = profile(raw, y, events, types, names)
    selected = choices(router, types)
    s, extra = fusion_features(raw, selected, router['overall_order'])
    x, z = features(s, s, types, 'flexible')
    w = event_weights(events)
    fitted = {'router':router}
    for mode, design in [('single',x), ('joint',np.column_stack([x,extra])), ('raw',np.column_stack([np.zeros(len(z)),extra]))]:
        coef, audit = fit_logistic(design, z, y, w)
        fitted[mode] = dict(coef=coef.tolist(), **audit)
    return fitted


def predict_subset(fit, raw, types):
    selected = choices(fit['router'], types)
    s, extra = fusion_features(raw, selected, fit['router']['overall_order'])
    x, z = features(s, s, types, 'flexible')
    single = sigmoid(z+x@np.array(fit['single']['coef']))
    joint = sigmoid(z+np.column_stack([x,extra])@np.array(fit['joint']['coef']))
    uncalibrated = sigmoid(z+np.column_stack([np.zeros(len(z)),extra])@np.array(fit['raw']['coef']))
    return np.column_stack([s,single,joint,uncalibrated,raw.mean(axis=1)])


class Study:
    def __init__(self, path):
        self.path = Path(path)
        panel = np.load(self.path/'data/panel.npz')
        self.p,self.y,self.events,self.types = [panel[k] for k in ['predictions','outcome','event','topic']]
        self.names = json.loads((self.path/'data/models.json').read_text())
        with (self.path/'data/events.csv').open() as f:
            catalog = [(r['source'],r['event_id']) for r in csv.DictReader(f)]
        self.split = split_rows(catalog,self.events,SEED)
        self.type_codes = np.array([TYPES.index(t)+1 if t in TYPES else 0 for t in self.types])
        self.loss = (self.p-self.y[:,None])**2
        self.bits = [int.from_bytes(np.packbits(np.isfinite(self.p[:,i]),bitorder='little').tobytes(),'little') for i in range(len(self.names))]
        self.bit_length = (len(self.y)+7)//8

    def common(self, group):
        key = self.bits[group[0]]
        for m in group[1:]:
            key &= self.bits[m]
        return key

    def rows(self, key):
        mask = np.unpackbits(np.frombuffer(key.to_bytes(self.bit_length,'little'),dtype=np.uint8),bitorder='little')[:len(self.y)].astype(bool)
        return np.flatnonzero(mask & (self.split==0)),np.flatnonzero(mask & (self.split==1))

    def discover(self, parents):
        candidates = {tuple(sorted((*group,m))) for group in parents for m in range(len(self.names)) if m not in group}
        grouped = defaultdict(list)
        for group in sorted(candidates):
            grouped[self.common(group)].append(group)
        retained, reasons = [], Counter()
        for key, groups in grouped.items():
            if not key:
                reasons['no_common_forecasts'] += len(groups)
                continue
            train,test = self.rows(key)
            counts_total = [len(np.unique(self.events[r])) for r in [train,test]]
            if min(counts_total)<100:
                reasons['insufficient_events'] += len(groups)
                continue
            columns = sorted({m for g in groups for m in g})
            position = {m:j for j,m in enumerate(columns)}
            counts, losses = [], []
            for rows in [train,test]:
                bs, ns = np.full((8,len(columns)),np.nan), []
                for k in range(8):
                    inside = rows if k==0 else rows[self.type_codes[rows]==k]
                    ns.append(len(np.unique(self.events[inside])))
                    if len(inside):
                        bs[k] = event_weights(self.events[inside]) @ self.loss[np.ix_(inside,columns)]
                counts.append(np.array(ns));losses.append(bs)
            supported = np.flatnonzero(counts[0][1:]>=30)+1
            if len(supported)<2 or counts[0][supported].sum()/counts_total[0]<.5-TOL:
                reasons['insufficient_types'] += len(groups)
                continue
            for group in groups:
                cols = [position[m] for m in group]
                tr,te = losses[0][:,cols],losses[1][:,cols]
                if 100*(np.sqrt(tr[0].max())-np.sqrt(tr[0].min()))>3+TOL:
                    reasons['ability_range'] += 1
                    continue
                risks = tr[supported]
                order = np.argsort(risks,axis=1,kind='stable')
                ranked = np.take_along_axis(risks,order,axis=1)
                edges = 100*(np.sqrt(ranked[:,1])-np.sqrt(ranked[:,0]))
                complementary,winners = supported[edges>=1],order[edges>=1,0]
                if len(set(winners))<len(group):
                    reasons['missing_specialist'] += 1
                    continue
                if any(counts[1][t]==0 or te[t,w]>np.min(te[t])+TOL for t,w in zip(complementary,winners)):
                    reasons['type_reversal'] += 1
                    continue
                retained.append(group)
        assert len(retained)+sum(reasons.values())==len(candidates)
        return retained,dict(candidates=len(candidates),retained=len(retained),reasons=dict(reasons))

    def evaluate(self, group):
        train,test = self.rows(self.common(group))
        full = self.p[np.ix_(train,group)]
        names = [self.names[i] for i in group]
        full_fit = profile(full,self.y[train],self.events[train],self.types[train],names)
        full_class = classify(full_fit,self.p[np.ix_(test,group)],self.y[test],self.events[test],self.types[test])
        assert full_class['status']=='eligible'
        complementary = [r['type'] for r in full_fit['routes'] if r['complementary']]
        masks = {'all':np.ones(len(test),bool),'complementary':np.isin(self.types[test],complementary)}
        subsets, fits, error = {}, {}, 0.
        for size in range(2,len(group)+1):
            for subset in itertools.combinations(group,size):
                key = ','.join(map(str,subset))
                raw_train,raw_test = self.p[np.ix_(train,subset)],self.p[np.ix_(test,subset)]
                fitted = fit_subset(raw_train,self.y[train],self.events[train],self.types[train],[self.names[i] for i in subset])
                status = classify(fitted['router'],raw_test,self.y[test],self.events[test],self.types[test])
                pred = predict_subset(fitted,raw_test,self.types[test])
                values = {}
                for scope,mask in masks.items():
                    values[scope] = scores(pred[mask],self.y[test][mask],self.events[test][mask])
                    if size==len(group):
                        error = max(error,independent_score_error(pred[mask],self.y[test][mask],self.events[test][mask],values[scope]))
                subsets[key] = dict(models=list(subset),status=status['status'],scopes=values)
                fits[key] = fitted
        paths = [list(path) for path in itertools.permutations(group)
                 if all(subsets[','.join(map(str,sorted(path[:k])))]['status']=='eligible' for k in range(2,len(group)+1))]
        return dict(id=team_id(names),models=list(group),paths=paths,train_events=len(np.unique(self.events[train])),
                    test_events=len(np.unique(self.events[test])),train_targets=len(train),test_targets=len(test),
                    complementary_types=complementary,coverage=full_fit['coverage'],ability_range=full_fit['ability_range'],
                    routes=full_class['routes'],subsets=subsets),fits,error


def export(study_path, destination):
    started=time.monotonic();destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    (destination/'teams').mkdir(exist_ok=True)
    old_root=ROOT/'site/public/data/aggregation-stability'
    source=json.loads((old_root/'source-manifest.json').read_text())
    for relative,expected in source['files'].items():
        assert digest(Path(study_path)/relative)==expected, f'Source changed: {relative}'
    for relative,expected in source['reused_code_hashes'].items():
        assert digest(ROOT/'analysis'/relative)==expected, f'Reused implementation changed: {relative}'
    study=Study(study_path)
    index=json.loads((old_root/'index.json').read_text())
    names={name:i for i,name in enumerate(study.names)}
    pair_meta=[r for r in index['pairs'] if r['stability']=='no_reversal' and r['train_gap']<=3+TOL and r['train_coverage']>=.5]
    parents=[tuple(sorted([names[r['model_a']],names[r['model_b']]])) for r in pair_meta]
    protocol=ROOT/'docs/multi-model-aggregation-protocol.md'
    write_json(destination/'protocol-lock.json',dict(protocol_sha256=digest(protocol),started_at_unix=time.time()))
    triples,a3=study.discover(parents);print(f'Three-model teams: {len(triples)}',flush=True)
    quads,a4=study.discover(triples);print(f'Four-model teams: {len(quads)}',flush=True)
    shards=defaultdict(dict);meta=[];all_fits={};max_error=0.;max_gradient=0.;no_paths=Counter()
    # Existing two-model results are reused exactly; no scoring changes.
    source_shards={prefix:json.loads((old_root/f'pairs/{prefix}.json').read_text()) for prefix in {r['id'][2:4] for r in pair_meta}}
    for row,group in zip(pair_meta,parents):
        old=source_shards[row['id'][2:4]][row['id']]
        assert [old['model_a'],old['model_b']]==[study.names[i] for i in group], 'Pair route orientation changed'
        key=','.join(map(str,group));scopes={}
        for scope,values in old['scopes'].items():
            scopes[scope]={k:values[k] for k in ['events','targets']}
            for metric in ['brier','ece']:
                scopes[scope][metric]=[values[metric][0],values[metric][6],values[metric][7],values['pools']['raw'][metric][7],values[metric][1]]
        routes=[dict(type=r['type'],train_events=r['train_events'],test_events=r['test_events'],selected=r['selected'],
                     train_brier=[r['train_brier_a'],r['train_brier_b']],test_brier=[r['test_brier_a'],r['test_brier_b']],
                     complementary=r['complementary'],test_status=r['test_status']) for r in old['routes']]
        record=dict(id=team_id([study.names[i] for i in group]),models=list(group),paths=[list(group),list(reversed(group))],
                    train_events=sum(r['train_events'] for r in routes),test_events=scopes['all']['events'],test_targets=scopes['all']['targets'],
                    complementary_types=[r['type'] for r in routes if r['complementary']],coverage=old['train_coverage'],ability_range=old['train_gap'],routes=routes,
                    subsets={key:dict(models=list(group),status='eligible',scopes=scopes)},source_pair=old['id'])
        # Training event total also includes events with no displayed type.
        tr,_=study.rows(study.common(group));record['train_events']=len(np.unique(study.events[tr]));record['train_targets']=len(tr)
        shards[record['id'][2:4]][record['id']]=record
        meta.append({k:record[k] for k in ['id','models','paths','train_events','test_events','complementary_types']})
    for number,group in enumerate([*triples,*quads],1):
        record,fits,error=study.evaluate(group)
        max_error=max(max_error,error)
        max_gradient=max(max_gradient,*[f[mode]['gradient'] for f in fits.values() for mode in ['single','joint','raw']])
        if not record['paths']:
            no_paths[len(group)]+=1
            continue
        shards[record['id'][2:4]][record['id']]=record
        meta.append({k:record[k] for k in ['id','models','paths','train_events','test_events','complementary_types']})
        all_fits[record['id']]=fits
        if number%50==0:print(f'Fitted {number}/{len(triples)+len(quads)} teams · {time.monotonic()-started:.1f}s',flush=True)
    for shard,records in shards.items():write_json(destination/f'teams/{shard}.json',records)
    with gzip.open(destination/'primary-fits.json.gz','wt') as f:json.dump(serialize(all_fits),f,separators=(',',':'),allow_nan=False)
    audit=dict(status='PASS',max_independent_error=max_error,max_gradient=max_gradient,counts=dict(Counter(len(r['models']) for r in meta)),
               growth_paths_filtered=dict(no_paths),search={'three':a3,'four':a4},elapsed_seconds=time.monotonic()-started,
               post_hoc=True,common_support_for_all_counts=True)
    assert max_error<1e-9 and max_gradient<1e-7
    write_json(destination/'index.json',dict(schema_version=1,primary_split=SEED,primary_fold=0,post_hoc=True,models=study.names,
               methods=METHODS,method_labels=LABELS,groups=sorted(meta,key=lambda r:(len(r['models']),r['models'])),counts=audit['counts']))
    write_json(destination/'audit.json',audit)
    source['multi_model_code_sha256']=digest(Path(__file__));source['multi_model_protocol_sha256']=digest(protocol)
    write_json(destination/'source-manifest.json',source)
    (destination/'PROTOCOL.md').write_text(protocol.read_text())
    lines=['# Complementary model-count exploration','', 'Post-hoc primary split; all count comparisons share the final team\'s common train and test targets.','',
           f"Eligible team counts: {audit['counts']}",f"Teams excluded because no fully eligible inclusion path remained: {dict(no_paths)}",'',
           'Every member owns a training type edge and its advantage does not reverse on test. Search expands the existing stable pairs; it is not exhaustive over all possible teams.',
           '', 'Brier is event-equal. Coefficients use training labels only. Test outcomes define the displayed cohort. Overlapping teams and paths are not independent samples.']
    (destination/'REPORT.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(audit),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--study',type=Path,required=True);parser.add_argument('--destination',type=Path,default=ROOT/'site/public/data/multi-model-aggregation')
    args=parser.parse_args();export(args.study,args.destination)
