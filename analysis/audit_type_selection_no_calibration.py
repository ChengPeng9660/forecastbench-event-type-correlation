"""Independent formulas, event means and optimality checks for raw pooling."""
import numpy as np


def weights(events):
    unique, counts = np.unique(events,return_counts=True)
    lookup = dict(zip(unique,counts))
    return np.array([1/(len(unique)*lookup[e]) for e in events])


def reconstruct(s,o,fit):
    a,b = np.clip(s,1e-6,1-1e-6),np.clip(o,1e-6,1-1e-6)
    za,zb = np.log(a)-np.log1p(-a),np.log(b)-np.log1p(-b)
    def logistic(x):
        return np.exp(x-np.logaddexp(0,x))
    product = a*b/((1-a)*(1-b)+a*b)
    zsum = za+zb
    piece = zsum/2
    piece[zsum>=np.log(5)] = zsum[zsum>=np.log(5)]-np.log(5)/2
    piece[zsum<=-np.log(5)] = zsum[zsum<=-np.log(5)]+np.log(5)/2
    return np.column_stack([s,o,(s+o)/2,logistic(zsum/2),logistic(.56*zsum),logistic(piece),product,
                            logistic((1-fit['log_weight'])*za+fit['log_weight']*zb),
                            logistic((1-fit['bounded_weight'])*za+fit['bounded_weight']*zb),
                            (1-fit['probability_weight'])*s+fit['probability_weight']*o])


def independent_check(train_s,train_o,train_y,train_events,s,o,y,events,raw,fallback,fit,pred,duplicate,masks,values):
    q,d = reconstruct(s,o,fit),reconstruct(s,s,fit)
    error = max(float(np.max(np.abs(q-pred))),float(np.max(np.abs(d-duplicate))))
    tw = weights(train_events)
    a,b = np.clip(train_s,1e-6,1-1e-6),np.clip(train_o,1e-6,1-1e-6)
    za,zb = np.log(a/(1-a)),np.log(b/(1-b))
    difference = zb-za
    lam = fit['log_weight']
    z = za+lam*difference
    train_q = np.exp(z-np.logaddexp(0,z))
    gradient = tw@(difference*(train_q-train_y))+.08*lam
    assert abs(gradient)<1e-8
    def objective(value):
        linear = za+value*difference
        return float(tw@(np.logaddexp(0,linear)-train_y*linear)+.04*value**2)
    finite_difference = (objective(lam+1e-5)-objective(lam-1e-5))/2e-5
    assert abs(finite_difference)<1e-7
    assert fit['bounded_weight']==np.clip(lam,0,1)
    raw_difference = train_o-train_s
    linear_gradient = float(2*tw@(raw_difference*(train_s+fit['probability_weight']*raw_difference-train_y)))
    kkt = max(0.,-linear_gradient) if fit['probability_weight']==0 else max(0.,linear_gradient) if fit['probability_weight']==1 else abs(linear_gradient)
    assert kkt<1e-9
    for scope,mask in masks.items():
        if values[scope] is None:
            assert not mask.any()
            continue
        expected = values[scope]
        qq,dd,yy,ee,rr = q[mask],d[mask],y[mask],events[mask],raw[mask]
        losses,dlosses = (qq-yy[:,None])**2,(dd-yy[:,None])**2
        manual = np.mean([losses[ee==e].mean(axis=0) for e in np.unique(ee)],axis=0)
        dmanual = np.mean([dlosses[ee==e].mean(axis=0) for e in np.unique(ee)],axis=0)
        error = max(error,float(np.max(np.abs(manual-expected['brier']))),float(np.max(np.abs(dmanual-expected['duplicate_brier']))))
        ww = weights(ee)
        groups = np.full(len(yy),3)
        groups[((rr[:,0]<.5)&(rr[:,1]>.5))|((rr[:,0]>.5)&(rr[:,1]<.5))] = 2
        groups[(rr[:,0]>=.7)&(rr[:,1]>=.7)] = 0
        groups[(rr[:,0]<=.3)&(rr[:,1]<=.3)] = 1
        for k in range(4):
            inside = groups==k
            for name,array in [('loss',losses),('duplicate_loss',dlosses)]:
                error = max(error,float(np.max(np.abs(ww[inside]@array[inside]-expected['group'][name][k]))))
        fb = fallback[mask]
        error = max(error,float(np.max(np.abs((ww*fb)@losses-expected['fallback_loss']))))
    assert error<1e-9
    return error
