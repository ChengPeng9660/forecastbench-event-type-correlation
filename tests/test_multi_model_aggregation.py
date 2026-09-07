import itertools
from pathlib import Path
import numpy as np
from analysis.multi_model_aggregation import (Study, classify, fit_subset, predict_subset, profile, team_id)
from analysis.type_selection_mechanisms import fit_controls, apply_controls
from analysis.type_selection_no_calibration import fit_weights, predictions
from analysis.type_selection import apply_router, fit_router


def synthetic(k=3, n=40):
    types=np.repeat(['finance','health','politics','technology'][:k],n)
    events=np.arange(len(types));y=(events%2).astype(float)
    confidence=np.full((len(y),k),.65)
    for j in range(k):confidence[j*n:(j+1)*n,j]=.8
    raw=np.where(y[:,None]==1,confidence,1-confidence)
    return raw,y,events,types,[f'Model {i}' for i in range(k)]


def test_every_member_must_have_its_own_type_and_test_advantage():
    raw,y,e,t,names=synthetic();fit=profile(raw,y,e,t,names)
    assert classify(fit,raw,y,e,t)['status']=='eligible'
    changed=y.copy();changed[t=='health']=1-changed[t=='health']
    assert classify(fit,raw,changed,e,t)['status']=='type_reversal'
    redundant=np.column_stack([raw,raw[:,0]])
    f=profile(redundant,y,e,t,[*names,'Duplicate'])
    assert classify(f,redundant,y,e,t)['status']=='missing_specialist'


def test_two_model_predictions_match_existing_matched_and_uncalibrated_models():
    raw,y,e,t,names=synthetic(2,70)
    # Vary confidence so the fitted design exercises every retained feature.
    raw=np.clip(raw+np.sin(e[:,None]*np.array([.37,.61]))*.15,.01,.99)
    router=fit_router(raw,y,e,t,names)
    selected,_,chosen=apply_router(router,raw,t);other=raw[np.arange(len(y)),1-chosen]
    old=fit_controls(raw,selected,other,t,y,e)
    old_pred=apply_controls(old,raw,selected,other,t)
    raw_pred=predictions(selected,other,fit_weights(selected,other,y,e))
    fitted=fit_subset(raw,y,e,t,names);actual=predict_subset(fitted,raw,t)
    np.testing.assert_allclose(actual[:,1],old_pred[:,1],atol=1e-10)
    np.testing.assert_allclose(actual[:,2],old_pred[:,2],atol=1e-10)
    np.testing.assert_allclose(actual[:,3],raw_pred[:,7],atol=1e-6)


def test_duplicate_fusion_has_no_hidden_calibration():
    raw,y,e,t,names=synthetic(3)
    raw[:]=raw[:,0,None]
    fitted=fit_subset(raw,y,e,t,names)
    result=predict_subset(fitted,raw,t)
    np.testing.assert_allclose(result[:,3],raw[:,0],atol=1e-12)
    assert fitted['raw']['coef']==[0.,0.,0.]


def test_growth_subsets_use_final_team_common_targets_and_type_mask(tmp_path):
    raw,y,e,t,names=synthetic(3,90)
    # The third model is absent on some rows; pair baselines must lose them too.
    raw[:8,2]=np.nan
    root=tmp_path/'data';root.mkdir()
    np.savez(root/'panel.npz',predictions=raw,outcome=y,event=e,topic=t)
    import json,csv
    (root/'models.json').write_text(json.dumps(names))
    with (root/'events.csv').open('w') as f:
        w=csv.writer(f);w.writerow(['source','event_id']);w.writerows([['fixture',str(i)] for i in e])
    study=Study(tmp_path);record,fits,error=study.evaluate((0,1,2))
    assert record['paths'] and error<1e-12
    assert record['train_targets']+record['test_targets']==len(y)-8
    for scope in ['all','complementary']:
        rows=[s['scopes'][scope] for s in record['subsets'].values()]
        assert len({(s['events'],s['targets']) for s in rows})==1
    training,_=study.rows(study.common((0,1,2)))
    direct=fit_subset(raw[training,:2],y[training],e[training],t[training],names[:2])
    assert fits['0,1']['joint']['coef']==direct['joint']['coef']
    assert team_id(names)==team_id(list(reversed(names)))
