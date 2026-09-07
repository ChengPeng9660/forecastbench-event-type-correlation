import gzip
import json
from pathlib import Path
import numpy as np
from analysis.type_selection import digest, event_weights, in_scope
from analysis.type_selection_mechanisms import fit_logistic, logit, sigmoid
from analysis.type_selection_calibrated_pooling import calibrate, fit_calibrators, fit_pipeline, apply_pipeline


def test_batched_calibration_matches_scalar_solver_including_extreme_inputs():
    rng = np.random.default_rng(551)
    p = rng.uniform(0,1,(120,10))
    p[:3,:3] = [[0,1,.5],[1,0,.5],[0,0,.5]]
    y, events = rng.binomial(1,.4,120), np.repeat(np.arange(40),3)
    coef,audit = fit_calibrators(p,y,events)
    assert max(audit['gradient'])<1e-8
    for k in range(10):
        z = logit(p[:,k])
        expected,_ = fit_logistic(np.column_stack([np.ones(len(z)),z/4]),z,y,event_weights(events))
        np.testing.assert_allclose(coef[k],expected,atol=1e-9)
    assert np.isfinite(calibrate(p,coef)).all()


def test_known_overconfidence_is_corrected_on_unseen_events():
    rng = np.random.default_rng(186)
    truth = rng.uniform(.1,.9,16000)
    p = sigmoid(2.5*logit(truth)+.8)[:,None]
    y = rng.binomial(1,truth)
    coef,_ = fit_calibrators(p[:8000],y[:8000],np.arange(8000))
    q = calibrate(p[8000:],coef)[:,0]
    assert 0<1+coef[0,1]/4<.7
    assert ((p[8000:,0]-y[8000:])**2).mean()-((q-y[8000:])**2).mean()>.015


def test_calibration_respects_event_weighting_under_within_event_replication():
    p = np.array([[.1,.8],[.3,.5],[.8,.2],[.9,.4]])
    y,events = np.array([0,1,0,1]),np.array([0,0,0,1])
    coef,_ = fit_calibrators(p,y,events)
    repeats = [4,4,4,1]
    repeated,_ = fit_calibrators(np.repeat(p,repeats,axis=0),np.repeat(y,repeats),np.repeat(events,repeats))
    np.testing.assert_allclose(coef,repeated,atol=1e-10)


def test_fixed_router_and_duplicate_preserve_selected_model_calibration():
    rng = np.random.default_rng(200)
    raw = rng.uniform(.02,.98,(1000,2))
    y = rng.binomial(1,.15+.7*raw[:,0])
    choices = np.arange(1000)%2
    fit = fit_pipeline(raw,choices,y,np.arange(1000))
    test = raw[:30]
    _,outputs = apply_pipeline(fit,test,choices[:30])
    c = calibrate(test,fit['input_coef'])
    expected = c[np.arange(30),choices[:30]]
    np.testing.assert_allclose(outputs['input'][0][:,0],expected)
    np.testing.assert_allclose(outputs['input'][1][:,0],expected)
    np.testing.assert_allclose(outputs['input'][1][:,1],expected)
    for k in [2,3,7,8,9]:
        np.testing.assert_allclose(outputs['input'][1][:,k],expected,atol=1e-12)
    # Output duplication keeps each real-pair calibrator, so duplicate other-only
    # is deliberately different from separately calibrated selection.
    assert not np.allclose(outputs['output'][1][:,1],outputs['output'][1][:,0])
    assert np.max(np.abs(outputs['input'][0]-outputs['output'][0]))>.01
    y[:] = 1-y
    again = apply_pipeline(fit,test,choices[:30])[1]
    for stage in ['input','output']:
        for k in [0,1]:
            np.testing.assert_array_equal(outputs[stage][k],again[stage][k])


def test_published_calibrated_views_and_frozen_provenance():
    root = Path(__file__).resolve().parents[1]
    path = root/'site/public/data/type-selection-calibrated-pooling'
    index = json.loads((path/'index.json').read_text())
    manifest = json.loads((path/'source-manifest.json').read_text())
    lock = json.loads((path/'protocol-lock.json').read_text())
    assert index['audit']['status']=='PASS'
    assert index['audit']['pair_directions']==29011
    assert index['audit']['calibrator_fits']==348132
    assert index['audit']['independent_pairs']==148
    for name,expected in manifest['code_hashes'].items():
        assert digest(root/name)==expected
    assert digest(root/'docs/type-selection-calibrated-pooling-protocol.md')==manifest['protocol_sha256']==lock['protocol_sha256']
    with gzip.open(path/'primary-pair-results.json.gz','rt') as f:
        pairs = json.load(f)
    assert len(pairs)==2805
    for p in pairs:
        assert np.array(p['fit']['input_coef']).shape==(2,2)
        assert np.array(p['fit']['output_coef']).shape==(10,2)
    for key in index['views']:
        view = json.loads((path/f'views/{key}.json').read_text())
        eligible = [p for p in pairs if p['train_gap']<=view['gap']+1e-12 and p['train_coverage']>=view['coverage'] and in_scope(p,view['pair_scope'])]
        for stage in ['input','output']:
            for scope in ['all','complementary']:
                expected = view['primary']['stages'][stage][scope]
                rows = [p['stages'][stage][scope] for p in eligible if p['stages'][stage][scope]]
                assert len(rows)==expected['pairs']
                if rows:
                    for metric in ['brier','ece','raw_brier','raw_ece','duplicate_brier','wins','duplicate_wins','calibration_wins']:
                        np.testing.assert_allclose(np.mean([r[metric] for r in rows],axis=0),expected[metric],atol=1e-12)
