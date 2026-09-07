"""Independent grouped-event scoring and fitted-prediction reconstruction."""
import numpy as np


def independent_check(train, test, yt, yy, et, ee, tt, types, router, fitted, published, masks, values):
    names = ["climate_weather", "entertainment_culture", "finance", "health", "politics", "sports", "technology"]
    mapping = {r["type"]: r["selected"] for r in router["routes"]}
    def inputs(raw, labels):
        choice = np.array([mapping.get(t, router["fallback"]) for t in labels])
        chosen = raw[np.arange(len(raw)), choice]
        other = raw[np.arange(len(raw)), 1 - choice]
        z = np.log(np.clip(chosen, 1e-6, 1-1e-6)) - np.log1p(-np.clip(chosen, 1e-6, 1-1e-6))
        zo = np.log(np.clip(other, 1e-6, 1-1e-6)) - np.log1p(-np.clip(other, 1e-6, 1-1e-6))
        base = [[1., a/4, max(a+2, 0)/4, max(a, 0)/4, max(a-2, 0)/4,
                 *[float(t == name) for name in names]] for a, t in zip(z, labels)]
        return chosen, z, {"calibrated": np.array(base)[:, :2], "flexible": np.array(base),
                           "joint": np.column_stack([base, (zo-z)/4])}
    _, zt, xt = inputs(train, tt)
    chosen, z, xx = inputs(test, types)
    output, errors = [], []
    _, inverse, counts = np.unique(et, return_inverse=True, return_counts=True)
    weights = np.array([1 / (len(counts) * counts[k]) for k in inverse])
    for mode in ["calibrated", "flexible", "joint"]:
        coef = np.array(fitted[mode]["coef"])
        predicted = 1 / (1 + np.exp(-(z + xx[mode] @ coef)))
        output.append(predicted)
        penalty = np.full(len(coef), .005)
        penalty[0] *= .1
        qt = 1 / (1 + np.exp(-(zt + xt[mode] @ coef)))
        grad = np.array([sum(weights * (qt-yt) * col) for col in xt[mode].T]) + penalty*coef
        assert max(abs(grad)) < 1e-7
        def risk(beta):
            linear = zt + xt[mode] @ beta
            return weights @ (np.logaddexp(0, linear) - yt * linear) + sum(penalty * beta**2)/2
        for k in [0, len(coef)-1]:
            direction = np.zeros(len(coef)); direction[k] = 1e-5
            finite = (risk(coef + direction) - risk(coef - direction)) / 2e-5
            assert abs(finite-grad[k]) < 1e-7
    alpha, gamma = fitted["alpha"], fitted["gamma"]
    pooled = alpha*test[:, 0] + (1-alpha)*test[:, 1]
    clipped = np.minimum(1-1e-6, np.maximum(1e-6, pooled))
    output += [pooled, 1 / (1 + ((1-clipped)/clipped)**gamma)]
    expected = np.column_stack(output)
    errors.append(float(np.max(abs(expected - published[:, 5:]))))
    errors.append(float(np.max(abs(chosen - published[:, 0]))))
    for scope, mask in masks.items():
        if not mask.any():
            assert values[scope] is None
            continue
        p, y, events, raw = published[mask], yy[mask], ee[mask], test[mask]
        loss = (p - y[:, None])**2
        unique = np.unique(events)
        expected_brier = np.mean([loss[events == e].mean(axis=0) for e in unique], axis=0)
        errors.append(float(np.max(abs(expected_brier-values[scope]["brier"]))))
        for t, cutoff in enumerate([.6, .7, .8]):
            labels = []
            for a, b in raw:
                labels.append(0 if min(a, b) >= cutoff else 1 if max(a, b) <= round(1-cutoff, 10)
                              else 2 if (a-.5)*(b-.5) < 0 else 3)
            labels = np.array(labels)
            for g in range(4):
                expected_contribution = np.mean([(loss[events == e] * (labels[events == e] == g)[:, None]).mean(axis=0) for e in unique], axis=0)
                errors.append(float(np.max(abs(expected_contribution-values[scope]["groups"][t]["loss"][g]))))
    maximum = max(errors)
    assert maximum < 1e-9, maximum
    return maximum
