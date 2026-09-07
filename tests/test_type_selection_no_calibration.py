import numpy as np
import pytest

from analysis.type_selection import event_weights
from analysis.type_selection_mechanisms import logit,sigmoid,features
from analysis.type_selection_no_calibration import fit_weights,predictions,score_scope


def test_duplicate_control_separates_information_from_fixed_extremization():
    s = np.array([.2,.8,.5,0.,1.])
    fit = fit_weights(s,s,np.array([0,1,0,0,1]),np.arange(5))
    assert fit['log_weight']==fit['bounded_weight']==fit['probability_weight']==0
    q = predictions(s,s,fit)
    np.testing.assert_allclose(q[:,[0,1,2,9]],np.broadcast_to(s[:,None],(5,4)))
    np.testing.assert_allclose(q[:,[3,7,8]],np.broadcast_to(np.clip(s,1e-6,1-1e-6)[:,None],(5,3)),atol=1e-12)
    assert q[1,6]==pytest.approx(16/17)
    assert q[1,4]>.8 and q[1,5]>.8


def test_uncalibrated_joint_is_exact_removal_of_calibration_features():
    s,o = np.array([.2,.6,.9]),np.array([.8,.3,.7])
    fit = {'log_weight':.3,'bounded_weight':.3,'probability_weight':.3}
    x,z = features(s,o,np.array(['finance','health','politics']),'joint')
    coef = np.zeros(x.shape[1]); coef[-1]=1.2
    np.testing.assert_allclose(predictions(s,o,fit)[:,7],sigmoid(z+x@coef),atol=1e-14)


def test_bounded_pools_and_product_disagreement_boundaries():
    s = np.array([0.,.01,.3,.7,1.])
    o = 1-s
    fitted = fit_weights(s,o,np.ones(5),np.arange(5))
    q = predictions(s,o,fitted)
    assert 0<=fitted['bounded_weight']<=1 and 0<=fitted['probability_weight']<=1
    assert np.all(q[:,9]>=np.minimum(s,o)-1e-12) and np.all(q[:,9]<=np.maximum(s,o)+1e-12)
    assert np.all(q[:,8]>=np.minimum(np.clip(s,1e-6,1-1e-6),np.clip(o,1e-6,1-1e-6))-1e-12)
    np.testing.assert_allclose(q[:,6],.5,atol=1e-11)


def test_learned_weights_recover_signal_and_do_not_use_test_outcomes():
    rng = np.random.default_rng(8813)
    s,o = rng.uniform(.1,.9,(2,6000))
    y = rng.binomial(1,.25*s+.75*o)
    fitted = fit_weights(s[:3000],o[:3000],y[:3000],np.arange(3000))
    assert .6<fitted['probability_weight']<.9
    q = predictions(s[3000:],o[3000:],fitted)
    loss = ((q-y[3000:,None])**2).mean(axis=0)
    assert loss[0]-loss[9]>.025
    y[3000:] = 1-y[3000:]
    np.testing.assert_array_equal(q,predictions(s[3000:],o[3000:],fitted))


def test_one_dimensional_optimum_and_event_weighting():
    s,o,y,ev = np.array([.2,.8,.3,.9]),np.array([.9,.2,.6,.1]),np.array([1,0,0,1]),np.array([0,0,0,1])
    f = fit_weights(s,o,y,ev)
    w,z,x = event_weights(ev),logit(s),(logit(o)-logit(s))/4
    beta = f['log_weight']*4
    loss = lambda b: w@(np.logaddexp(0,z+b*x)-y*(z+b*x))+.005*b*b/2
    assert loss(beta)<min(loss(beta-.01),loss(beta+.01))
    assert f['gradient']<1e-9 and f['bounded_kkt']<1e-9
    f_repeated = fit_weights(np.repeat(s,[2,2,2,1]),np.repeat(o,[2,2,2,1]),np.repeat(y,[2,2,2,1]),np.repeat(ev,[2,2,2,1]))
    assert f_repeated['log_weight']==pytest.approx(f['log_weight'])
    assert f_repeated['probability_weight']==pytest.approx(f['probability_weight'])


def test_group_contributions_keep_scope_weights_and_duplicate_gains():
    s,o = np.array([.8,.2,.4,.5]),np.array([.9,.1,.8,.6])
    y,ev = np.array([1,0,1,0]),np.array([0,0,0,1])
    fit = {'log_weight':.2,'bounded_weight':.2,'probability_weight':.4}
    p,d = predictions(s,o,fit),predictions(s,s,fit)
    result = score_scope(p,d,np.column_stack([s,o]),y,ev,np.array([0,0,1,1]))
    np.testing.assert_allclose(result['group']['mass'],[1/6,1/6,1/6,1/2])
    np.testing.assert_allclose(result['group']['duplicate_loss'].sum(axis=0)-result['group']['loss'].sum(axis=0),result['duplicate_brier']-result['brier'],atol=1e-12)
    assert score_scope(p[:0],d[:0],np.empty((0,2)),y[:0],ev[:0],np.zeros(0)) is None


def test_published_results_reconstruct_from_pairs_and_keep_code_provenance():
    import gzip,json
    from pathlib import Path
    from analysis.type_selection import digest,in_scope
    root=Path(__file__).resolve().parents[1]
    path=root/'site/public/data/type-selection-no-calibration'
    with gzip.open(path/'primary-pair-results.json.gz','rt') as f:
        pairs=json.load(f)
    index=json.loads((path/'index.json').read_text())
    manifest=json.loads((path/'source-manifest.json').read_text())
    assert index['audit']['status']=='PASS' and index['audit']['pair_directions']==29011
    assert len(pairs)==2805 and index['audit']['independent_pairs']==148
    for name,expected in manifest['code_hashes'].items():
        assert digest(root/name)==expected
    assert digest(root/'docs/type-selection-no-calibration-protocol.md')==manifest['protocol_sha256']
    for key in index['views']:
        view=json.loads((path/f'views/{key}.json').read_text())
        eligible=[p for p in pairs if p['train_gap']<=view['gap']+1e-12 and p['train_coverage']>=view['coverage'] and in_scope(p,view['pair_scope'])]
        for scope in ['all','complementary']:
            expected=view['primary']['scopes'][scope]
            rows=[p['scopes'][scope] for p in eligible if p['scopes'][scope] is not None]
            assert len(rows)==expected['pairs']
            if rows:
                for metric in ['brier','duplicate_brier','wins','duplicate_wins','beat_both']:
                    np.testing.assert_allclose(np.mean([r[metric] for r in rows],axis=0),expected[metric],atol=1e-12)
