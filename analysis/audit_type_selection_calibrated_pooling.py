"""Separate scalar calibration solver and direct event/group reconstruction."""
import numpy as np
from analysis.audit_type_selection_no_calibration import weights, reconstruct
from analysis.type_selection_mechanisms import fit_logistic


def independent_calibration(train, y, events, test, expected_coef):
    columns, coefficients = [], []
    for j in range(train.shape[1]):
        p = np.clip(train[:,j],1e-6,1-1e-6)
        z = np.log(p)-np.log1p(-p)
        coef,_ = fit_logistic(np.column_stack([np.ones(len(z)),z/4]),z,y,weights(events))
        coefficients.append(coef)
        t = np.clip(test[:,j],1e-6,1-1e-6)
        tz = np.log(t)-np.log1p(-t)
        eta = coef[0]+(1+coef[1]/4)*tz
        columns.append(np.exp(eta-np.logaddexp(0,eta)))
    error = float(np.max(np.abs(np.array(coefficients)-expected_coef)))
    assert error<1e-6
    return np.column_stack(columns),error


def independent_check(train,tc,ty,te,test,vc,y,events,fallback,fit,outputs,masks,values):
    tr,vr = np.arange(len(train)),np.arange(len(test))
    ts,to = train[tr,tc],train[tr,1-tc]
    s,o = test[vr,vc],test[vr,1-vc]
    raw_train = reconstruct(ts,to,fit['raw_weights'])
    raw_test = reconstruct(s,o,fit['raw_weights'])
    raw_dup = reconstruct(s,s,fit['raw_weights'])
    calibrated,error = independent_calibration(train,ty,te,test,fit['input_coef'])
    # Separately reconstruct training inputs and check both learned objectives.
    ctr,e = independent_calibration(train,ty,te,train,fit['input_coef'])
    error = max(error,e)
    for train_s,train_o,weight_fit in [(ts,to,fit['raw_weights']),(ctr[tr,tc],ctr[tr,1-tc],fit['input_weights'])]:
        a,b = np.clip(train_s,1e-6,1-1e-6),np.clip(train_o,1e-6,1-1e-6)
        z,d = np.log(a/(1-a)),np.log(b/(1-b))-np.log(a/(1-a))
        lam = weight_fit['log_weight']
        eta = z+lam*d
        gradient = weights(te)@(d*(np.exp(eta-np.logaddexp(0,eta))-ty))+.08*lam
        assert abs(gradient)<1e-7
        assert weight_fit['bounded_weight']==np.clip(lam,0,1)
        delta = train_o-train_s
        plam = weight_fit['probability_weight']
        pg = float(2*weights(te)@(delta*(train_s+plam*delta-ty)))
        kkt = max(0.,-pg) if plam==0 else max(0.,pg) if plam==1 else abs(pg)
        assert kkt<1e-7
    cs,co = calibrated[vr,vc],calibrated[vr,1-vc]
    ip,idup = reconstruct(cs,co,fit['input_weights']),reconstruct(cs,cs,fit['input_weights'])
    op,e = independent_calibration(raw_train,ty,te,raw_test,fit['output_coef'])
    error = max(error,e)
    odup,e = independent_calibration(raw_train,ty,te,raw_dup,fit['output_coef'])
    error = max(error,e)
    for stage,(q,d) in {'input':(ip,idup),'output':(op,odup)}.items():
        error = max(error,float(np.max(np.abs(q-outputs[stage][0]))),float(np.max(np.abs(d-outputs[stage][1]))))
        for scope,mask in masks.items():
            expected = values[stage][scope]
            if expected is None:
                assert not mask.any()
                continue
            yy,ee,rr = y[mask],events[mask],test[mask]
            losses,dlosses = (q[mask]-yy[:,None])**2,(d[mask]-yy[:,None])**2
            for name,array in [('brier',losses),('duplicate_brier',dlosses)]:
                manual = np.mean([array[ee==e].mean(axis=0) for e in np.unique(ee)],axis=0)
                error = max(error,float(np.max(np.abs(manual-expected[name]))))
            ww = weights(ee)
            groups = np.full(len(yy),3)
            groups[((rr[:,0]<.5)&(rr[:,1]>.5))|((rr[:,0]>.5)&(rr[:,1]<.5))] = 2
            groups[(rr[:,0]>=.7)&(rr[:,1]>=.7)] = 0
            groups[(rr[:,0]<=.3)&(rr[:,1]<=.3)] = 1
            for k in range(4):
                for name,array in [('loss',losses),('duplicate_loss',dlosses)]:
                    error = max(error,float(np.max(np.abs(ww[groups==k]@array[groups==k]-expected['group'][name][k]))))
            error = max(error,float(np.max(np.abs((ww*fallback[mask])@losses-expected['fallback_loss']))))
            for k in range(q.shape[1]):
                column = q[mask,k]
                bins = np.minimum((column*10).astype(int),9)
                ece = sum(abs((column[ bins==b]-yy[bins==b]).sum()) for b in range(10))/len(yy)
                assert abs(ece-expected['ece'][k])<1e-6
    assert error<1e-6
    return error
