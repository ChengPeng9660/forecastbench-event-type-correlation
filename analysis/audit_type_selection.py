"""Independent event-mean and scalar-formula reconstruction of routing outputs."""
import math
import numpy as np


def grouped_risk(p, y, event):
    return np.mean([np.mean((p[event == e] - y[event == e, None]) ** 2, axis=0)
                    for e in sorted(set(event))], axis=0)


def audit_sample(rows, panel, names, splits):
    # Deterministically span the full primary configuration catalog.
    sample = rows[::19]
    errors, compared = [], 0
    for row in sample:
        i, j = row["i"], row["j"]
        common = np.where(np.isfinite(panel["predictions"][:, i]) & np.isfinite(panel["predictions"][:, j]))[0]
        fold = splits[row["split"]]
        train, test = common[fold[common] == row["fold"]], common[fold[common] != row["fold"]]
        events, labels, y = panel["event"], panel["topic"], panel["outcome"]
        p = panel["predictions"][:, [i, j]]
        train_bs = grouped_risk(p[train], y[train], events[train])
        global_winner = int(np.argmin(train_bs))
        if abs(train_bs[0] - train_bs[1]) <= 1e-12:
            global_winner = sorted([0, 1], key=lambda k: (names[[i, j][k]].casefold(), names[[i, j][k]]))[0]
        mapping, complementary = {}, set()
        for label in sorted(set(labels[train]) - {""}):
            ix = train[labels[train] == label]
            if len(set(events[ix])) < 30:
                continue
            risks = grouped_risk(p[ix], y[ix], events[ix])
            mapping[label] = global_winner if abs(risks[0] - risks[1]) <= 1e-12 else int(np.argmin(risks))
            if abs(100 * (math.sqrt(risks[1]) - math.sqrt(risks[0]))) >= 1:
                complementary.add(label)
        published_complementary = {r["type"] for r in row["routes"] if r["complementary"]}
        assert complementary == published_complementary
        for route in row["routes"]:
            assert route["selected"] == mapping.get(route["type"], global_winner)
        predictions = []
        for ix in test:
            a, b = p[ix]
            odds = [min(1 - 1e-6, max(1e-6, v)) for v in [a, b]]
            total = sum(math.log(v / (1 - v)) for v in odds)
            if total < -math.log(5):
                z = total + math.log(5) / 2
            elif total > math.log(5):
                z = total - math.log(5) / 2
            else:
                z = total / 2
            predictions.append([p[ix, mapping.get(labels[ix], global_winner)], (a + b) / 2,
                                1 / (1 + math.exp(-total / 2)), 1 / (1 + math.exp(-.56 * total)),
                                1 / (1 + math.exp(-z)), a, b, p[ix, global_winner]])
        pred = np.array(predictions)
        for scope in ["complementary", "all"]:
            mask = np.array([label in complementary for label in labels[test]]) if scope == "complementary" else np.ones(len(test), bool)
            expected = row["scopes"][scope]
            assert expected["events"] == len(set(events[test[mask]]))
            assert expected["targets"] == int(sum(mask))
            if not mask.any():
                assert all(v is None for v in expected["scores"]["brier"])
                continue
            pp, yy = pred[mask], y[test[mask]]
            losses = grouped_risk(pp, yy, events[test[mask]])
            values = {"brier": losses, "bi": 100 * (1 - np.sqrt(losses)), "ece": []}
            for column in pp.T:
                bins = np.minimum(np.floor(column * 10).astype(int), 9)
                value = 0.0
                for bin_id in range(10):
                    inside = bins == bin_id
                    if inside.any():
                        value += inside.mean() * abs(column[inside].mean() - yy[inside].mean())
                values["ece"].append(value)
            for metric in values:
                errors.append(float(np.max(np.abs(np.array(values[metric]) - expected["scores"][metric]))))
                compared += len(values[metric])
    maximum = max(errors, default=0)
    assert maximum < 1e-9, maximum
    return {"status": "PASS", "sampled_primary_pairs": len(sample), "compared_scores": compared,
            "max_absolute_error": maximum, "implementation": "separate scalar pools and grouped event means"}
