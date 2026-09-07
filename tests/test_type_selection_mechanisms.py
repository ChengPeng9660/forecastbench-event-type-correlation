import numpy as np
import pytest

from analysis.type_selection import event_weights
from analysis.type_selection_mechanisms import (
    apply_controls, confidence_groups, decompose, features, fit_controls,
    fit_logistic, logit, matched_check, sigmoid,
)


def test_exhaustive_confidence_boundaries_and_equal_half():
    p = np.array([[.7,.7],[.3,.3],[.8,.2],[.5,.8],[.69,.9],[.7,.3],[0,1]])
    assert confidence_groups(p).tolist() == [0,1,2,3,3,2,2]
    assert confidence_groups(np.array([[.4,.4],[.6,.6]]),.6).tolist() == [1,0]


def test_contributions_preserve_original_weights_when_events_span_groups():
    singles = np.array([[.9,.8],[.1,.2],[.2,.9],[.6,.7]])
    y, ev = np.array([1.,1.,0.,0.]), np.array([0,0,0,1])
    pred = np.column_stack([singles, singles.mean(axis=1)])
    group = decompose(pred, singles, y, event_weights(ev))[1]
    np.testing.assert_allclose(group['mass'], [1/6,1/6,1/6,1/2])
    np.testing.assert_allclose(group['loss'].sum(axis=0), ((pred[:3]-y[:3,None])**2).mean(axis=0)/2+(pred[3]-y[3])**2/2)
    gain = group['loss'][:,0] - group['loss'][:,2]
    assert gain.sum() == pytest.approx(event_weights(ev) @ ((pred[:,0]-y)**2-(pred[:,2]-y)**2))


def test_duplicate_forecasts_add_no_joint_predictor_and_convex_tie_is_half():
    rng = np.random.default_rng(18)
    selected = rng.uniform(.05,.95,800)
    y = rng.binomial(1, selected*.7+.1)
    types, events = np.array(['finance']*800), np.arange(800)
    raw = np.column_stack([selected,selected])
    fit = fit_controls(raw,selected,selected,types,y,events)
    predicted = apply_controls(fit,raw,selected,selected,types)
    assert fit['alpha'] == .5
    assert fit['joint']['coef'][-1] == 0
    np.testing.assert_allclose(predicted[:,1],predicted[:,2],atol=1e-10)


def test_nested_joint_recovers_synthetic_incremental_signal_on_new_events():
    rng = np.random.default_rng(842)
    n = 5000
    s, o = rng.uniform(.1,.9,(2,n))
    true = sigmoid(.2 + .6*logit(s)+1.5*logit(o))
    y = rng.binomial(1,true)
    labels = np.array(['finance']*n)
    raw = np.column_stack([s,o])
    fit = fit_controls(raw[:2500],s[:2500],o[:2500],labels[:2500],y[:2500],np.arange(2500))
    prediction = apply_controls(fit,raw[2500:],s[2500:],o[2500:],labels[2500:])
    risk = np.mean((prediction-y[2500:,None])**2,axis=0)
    assert risk[1]-risk[2] > .03
    # Replacing evaluation labels cannot alter fitted predictions.
    before = prediction.copy()
    y[2500:] = 1-y[2500:]
    np.testing.assert_array_equal(before,apply_controls(fit,raw[2500:],s[2500:],o[2500:],labels[2500:]))


def test_matching_excludes_cells_without_support_and_adjusts_selected_level():
    s = np.full(21,.45)
    o = np.r_[np.full(10,.8),np.full(10,.2),.9]
    y = np.r_[np.ones(10),np.zeros(10),0.]
    types = np.array(['finance']*20+['politics'])
    result = matched_check(s,o,s,y,types,np.arange(21),np.ones(21)/21)
    assert result['cells'] == 1 and result['events'] == 20
    np.testing.assert_allclose(result['differences'],[1,0,1,.6])
    # Duplicated targets do not satisfy the distinct-event support screen.
    result = matched_check(s,o,s,y,types,np.zeros(21,int),np.ones(21)/21)
    assert result['cells'] == 0 and result['differences'] is None


def test_optimizer_converges_for_constant_outcomes_and_extreme_forecasts():
    s = np.r_[np.zeros(50),np.ones(50)]
    x,z = features(s,1-s,np.array(['unknown']*100),'joint')
    coef,audit = fit_logistic(x,z,np.ones(100),np.ones(100)/100)
    assert audit['gradient'] < 1e-7
    assert np.isfinite(coef).all()


def test_exported_primary_control_means_and_provenance():
    import gzip
    import json
    from pathlib import Path
    from analysis.type_selection import digest
    root=Path(__file__).resolve().parents[1]
    path=root/'site/public/data/type-selection-mechanisms'
    with gzip.open(path/'primary-pair-diagnostics.json.gz','rt') as f:
        rows=json.load(f)
    index=json.loads((path/'index.json').read_text())
    manifest=json.loads((path/'source-manifest.json').read_text())
    assert index['audit']['status']=='PASS' and index['audit']['pair_directions']==29011
    assert len(rows)==2805 and index['audit']['independent_pairs']==148
    assert manifest['mechanism_code_sha256']==digest(root/'analysis/type_selection_mechanisms.py')
    assert manifest['protocol_sha256']==digest(root/'docs/type-selection-mechanisms-protocol.md')
    for gap in [3,5]:
        selected=[r for r in rows if r['train_gap']<=gap+1e-12]
        view=json.loads((path/f'views/gap{gap}-coverage50-all.json').read_text())
        for scope in ['all','complementary']:
            expected=view['primary']['scopes'][scope]
            available=[r['scopes'][scope] for r in selected if r['scopes'][scope] is not None]
            np.testing.assert_allclose(np.mean([r['brier'] for r in available],axis=0),expected['brier'],atol=1e-12)
            for i in range(3):
                np.testing.assert_allclose(np.mean([r['groups'][i]['loss'] for r in available],axis=0),expected['groups'][i]['loss'],atol=1e-12)
