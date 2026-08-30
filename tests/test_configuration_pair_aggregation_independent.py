"""Independent, hand-checkable cases for exact-configuration pair aggregation."""
from copy import deepcopy
import csv
import gzip
import json

import pytest

from analysis.audit_configuration_pair_aggregation import (
    METHODS, METRICS, SEEDS, adjusted_losses, aggregate_reference, compare_expected,
    directional_weights, event_half, pool_predictions, reference_folds,
    reference_views, support_folds, train_coordinates, audit_artifacts,
    file_sha256, mean, brier_index,
)
from analysis.configuration_pair_aggregation import build_views, evaluate_pair


def row(p, outcome=0, *, offset=0):
    return {"prediction": str(p), "outcome": str(outcome), "origin_type": "Market",
            "question_fixed_effect": "0", "normalization_term": str(offset)}


def key(index, date="2025-01-01", source="polymarket", horizon=""):
    return (date, source, str(index), horizon)


def basic_panels(n=24):
    first = {key(i): row((i % 7 + 1) / 10, i % 2, offset=0.02) for i in range(n)}
    second = {k: row(0.8 - (i % 5) / 10, i % 2, offset=0.02) for i, k in enumerate(first)}
    market = {k: row(0.3 + (i % 3) / 10, i % 2, offset=0.02) for i, k in enumerate(first)}
    return first, second, market


def test_cf_two_base_algebra_and_empty_training_direction():
    first = {key(i): row(0.2 if i < 4 else 0.8, y) for i, y in enumerate([0, 0, 0, 1, 0, 1])}
    second = {k: {**r, "prediction": str(0.6 if i < 4 else 0.4)} for i, (k, r) in enumerate(first.items())}
    forward = directional_weights(first, second, list(first))
    reverse = directional_weights(second, first, list(first))
    assert forward == pytest.approx((0.125, 0.75))
    assert reverse == pytest.approx((0.25, 0.875))
    for p, q in ((0.1, 0.9), (0.9, 0.1)):
        assert pool_predictions(p, q, forward)["cf_directional"] == pytest.approx(
            pool_predictions(q, p, reverse)["cf_directional"])
    only_up = list(first)[:4]
    f, r = directional_weights(first, second, only_up), directional_weights(second, first, only_up)
    assert pool_predictions(0.8, 0.4, f)["cf_directional"] == 0.8
    assert pool_predictions(0.4, 0.8, r)["cf_directional"] == 0.4


def test_tv_original_endpoints_and_histogram_not_marginal_distance():
    first = {key(0): row(0), key(1): row(1)}
    second = {key(0): row(1), key(1): row(0)}
    assert train_coordinates(first, second, list(first))["total_variation"] == 1.0
    assert train_coordinates(first, first, list(first))["total_variation"] == 0.0
    assert pool_predictions(0, 0, (0, 0))["simple_mean"] == 0
    assert pool_predictions(0, 0, (0, 0))["log_odds_mean"] > 0


def test_support_is_three_way_market_only_and_event_disjoint_across_dates_horizons():
    first, second, market = basic_panels()
    second.pop(key(0))
    market.pop(key(1))
    extra = key(2, "2025-02-01", horizon="30")
    for panel in (first, second, market):
        panel[extra] = deepcopy(panel[key(2)])
        panel[key("same-id", source="acled")] = row(0.4)
    common, folds = support_folds(first, second, market)
    assert len(common) == 23
    assert len(folds) == 20
    assert all(k[1] == "polymarket" for k in common)
    for fold in folds:
        train_events = {(k[1], k[2]) for k in fold["train_keys"]}
        test_events = {(k[1], k[2]) for k in fold["test_keys"]}
        assert not train_events & test_events
        assert event_half(key(2), fold["seed"]) == event_half(extra, fold["seed"])


def test_test_fold_outcomes_cannot_change_its_train_coordinates_or_weights():
    first, second, market = basic_panels()
    old = reference_folds(first, second, market, seeds=[SEEDS[0]])[0]
    produced_old = evaluate_pair("A (zero shot)", "B (scratchpad)", first, second, market,
                                 split_seeds=[SEEDS[0]])["folds"][0]
    for panel in (first, second, market):
        for k in old["test_keys"]:
            panel[k]["outcome"] = str(1 - float(panel[k]["outcome"]))
            panel[k]["prediction"] = str(1 - float(panel[k]["prediction"]))
    new = reference_folds(first, second, market, seeds=[SEEDS[0]])[0]
    assert new["weights"] == old["weights"]
    assert new["train_diversity"] == old["train_diversity"]
    assert new["train_near_bi"] == old["train_near_bi"]
    assert new["train_bi_gap"] == old["train_bi_gap"]
    produced_new = evaluate_pair("A (zero shot)", "B (scratchpad)", first, second, market,
                                 split_seeds=[SEEDS[0]])["folds"][0]
    for field in ("train_diversity", "train_cf_statistics", "weights_first", "weights_second",
                  "train_near_bi", "train_bi_gap"):
        assert produced_new[field] == produced_old[field]


def test_near_bi_is_directional_train_filter_and_empty_has_no_fallback():
    first, second, market = basic_panels()
    for k in first:
        first[k] = row(0.4, 0)
        second[k] = row(0.4 if event_half(k, SEEDS[0]) == "A" else 0.9, 0)
        market[k] = row(0.5, 0)
    folds = reference_folds(first, second, market, seeds=[SEEDS[0]])
    views = reference_views(folds)
    assert views["all"]["combined"]["fold_count"] == 2
    assert views["near_bi"]["combined"]["fold_count"] == 1
    assert views["near_bi"]["a_to_b"] is not None
    assert views["near_bi"]["b_to_a"] is None
    assert views["near_bi"]["a_to_b"]["train_bi_gap"] == 0


def test_best_single_is_one_constituent_per_test_fold_not_per_question():
    first = {key(i): row(i % 2, 0) for i in range(30)}
    second = {k: row(1 - float(r["prediction"]), 0) for k, r in first.items()}
    market = {k: row(0.5, 0) for k in first}
    for fold in reference_folds(first, second, market, seeds=[SEEDS[0]]):
        best = fold["methods"]["best_single"]["raw_brier"]
        assert best == min(fold["base"]["raw_brier"], fold["partner"]["raw_brier"])
        assert best > 0  # A per-question oracle would have zero loss.
        assert set(fold["methods"]) == set(METHODS)
        assert set(fold["train_diversity"]) == set(METRICS)


def test_aggregation_uses_train_and_test_weights_and_ratio_of_pooled_losses():
    first, second, market = basic_panels()
    folds = reference_folds(first, second, market, seeds=[SEEDS[0]])
    result = aggregate_reference(folds)
    n = sum(len(f["test_keys"]) for f in folds)
    expected = sum(f["methods"]["simple_mean"]["brier_index"] * len(f["test_keys"]) for f in folds) / n
    assert result["methods"]["simple_mean"]["brier_index"] == pytest.approx(expected)
    base_loss = result["base"]["adjusted_brier"]
    pool_loss = result["methods"]["simple_mean"]["adjusted_brier"]
    assert result["methods"]["simple_mean"]["gain_vs_base"] == pytest.approx((base_loss - pool_loss) / base_loss)


def test_empty_halves_do_not_become_estimates_and_zero_gain_denominator_is_null():
    first = {key("one-event", date=f"2025-01-{i + 1:02d}"): row(0, 0) for i in range(20)}
    assert reference_folds(first, first, first) == []
    first = {key(i): row(0, 0) for i in range(30)}
    output = reference_views(reference_folds(first, first, first))["all"]["combined"]
    assert output["methods"]["simple_mean"]["gain_vs_base"] is None
    assert output["methods"]["simple_mean"]["beats_market"] is False


def test_independent_comparison_rejects_boolean_zero_and_missing_metric():
    assert compare_expected({"value": 0.0}, {"value": False})
    assert compare_expected({"total_variation": 0.2}, {})
    assert not compare_expected({"value": None}, {"value": None, "provenance": "extra allowed"})


def test_one_invalid_fold_bi_is_not_silently_omitted_from_average():
    first = {key(i): row(0, 0, offset=-0.01 if event_half(key(i), SEEDS[0]) == "A" else 0.04) for i in range(24)}
    folds = reference_folds(first, first, first, seeds=[SEEDS[0]])
    assert sorted(fold["base"]["brier_index"] is None for fold in folds) == [False, True]
    combined = aggregate_reference(folds)
    assert combined["base"]["brier_index"] is None
    assert combined["methods"]["simple_mean"]["brier_index"] is None
    assert combined["methods"]["simple_mean"]["beats_market"] is False


def test_partial_event_splits_report_actual_directions_and_small_support():
    first = {key(i): row(0.3, i % 2) for i in range(2)}
    folds = reference_folds(first, first, first)
    expected_directions = 2 * sum(event_half(key(0), seed) != event_half(key(1), seed) for seed in SEEDS)
    assert 0 < expected_directions < 20
    output = aggregate_reference(folds)
    assert output["fold_count"] == expected_directions
    assert output["small_support"] is True
    assert output["min_train_rows"] == output["min_test_rows"] == 1


@pytest.mark.parametrize("case", ["ordinary", "missing_market", "endpoints", "invalid_bi", "two_events", "one_event"])
def test_producer_matches_independent_direct_arrays_in_both_base_directions(case):
    first, second, market = basic_panels()
    if case == "missing_market":
        second.pop(key(0))
        market.pop(key(1))
    elif case == "endpoints":
        for i, k in enumerate(first):
            first[k]["prediction"], second[k]["prediction"] = str(i % 2), str(1 - i % 2)
    elif case == "invalid_bi":
        first = {key(i): row(0, 0, offset=-0.01 if event_half(key(i), SEEDS[0]) == "A" else 0.04) for i in range(24)}
        second, market = deepcopy(first), deepcopy(first)
    elif case == "two_events":
        first = {key(i): row(0.3, i % 2) for i in range(2)}
        second, market = deepcopy(first), deepcopy(first)
    elif case == "one_event":
        first = {key("one-event", date=f"2025-01-{i + 1:02d}"): row(0, 0) for i in range(20)}
        second, market = deepcopy(first), deepcopy(first)
    name_a = "Grok-4-0709 (zero shot with freeze values)"
    name_b = "Grok-4-0709 (scratchpad)"
    actual = evaluate_pair(name_a, name_b, first, second, market)
    assert actual["first_configuration"] == name_a
    assert actual["second_configuration"] == name_b
    assert actual["n_common"] == len(set(first) & set(second) & set(market))
    for reverse in (False, True):
        a, b = (second, first) if reverse else (first, second)
        expected_folds = reference_folds(a, b, market)
        assert len(actual["folds"]) == len(expected_folds)
        for expected, produced in zip(expected_folds, actual["folds"]):
            subset = {field: expected[field] for field in ("fold_id", "seed", "train_fold", "test_fold", "train_bi_gap", "train_near_bi", "train_diversity")}
            subset.update(n_train=len(expected["train_keys"]), n_test=len(expected["test_keys"]))
            assert compare_expected(subset, produced) == []
            assert compare_expected(expected["base"], produced["second" if reverse else "first"]) == []
            assert compare_expected(expected["partner"], produced["first" if reverse else "second"]) == []
            assert compare_expected(expected["market"], produced["market"]) == []
            assert compare_expected(expected["methods"]["cf_directional"], produced["cf_second" if reverse else "cf_first"]) == []
            weights = produced["weights_second" if reverse else "weights_first"]
            assert (weights["upward_alpha"], weights["downward_alpha"]) == pytest.approx(expected["weights"])
        assert compare_expected(reference_views(expected_folds), build_views(actual, reverse=reverse)) == []


def test_producer_rejects_nonmarket_or_mismatched_target_metadata():
    first, second, market = basic_panels()
    second[key(0)]["outcome"] = "0.3"
    with pytest.raises(ValueError, match="metadata disagree"):
        evaluate_pair("A (zero shot)", "B (scratchpad)", first, second, market)
    first[key("dataset", source="acled")] = row(0.5)
    with pytest.raises(ValueError, match="non-Polymarket"):
        evaluate_pair("A (zero shot)", "B (scratchpad)", first, second, market)


def test_partial_missing_train_metric_does_not_pair_partial_x_with_full_y():
    first, second, market = basic_panels(5)
    folds = reference_folds(first, second, market, seeds=[SEEDS[0]])
    assert len(folds) == 2
    combined = aggregate_reference(folds)
    support = combined["train_diversity_target_cells"]["prediction_diversity"]
    assert 0 < support < combined["train_target_cells"]
    assert combined["train_diversity"]["prediction_diversity"] is None
    actual = evaluate_pair("A (zero shot)", "B (scratchpad)", first, second, market, split_seeds=[SEEDS[0]])
    assert compare_expected(reference_views(folds), build_views(actual)) == []


def test_subpicopoint_market_difference_is_not_a_win():
    first, second, market = basic_panels()
    folds = reference_folds(first, second, market, seeds=[SEEDS[0]])
    for fold in folds:
        fold["methods"]["simple_mean"]["brier_index"] = fold["market"]["brier_index"] + 5e-13
    assert aggregate_reference(folds)["methods"]["simple_mean"]["beats_market"] is False


@pytest.mark.parametrize("half_count", [3, 12])
@pytest.mark.parametrize("constant_field", ["prediction", "adjusted_loss"])
def test_exact_constant_probability_is_undefined_even_when_centered_roundoff_is_nonzero(half_count, constant_field):
    groups = {"A": [], "B": []}
    index = 0
    while min(map(len, groups.values())) < half_count:
        k = key(index)
        side = event_half(k, SEEDS[0])
        if len(groups[side]) < half_count:
            groups[side].append(k)
        index += 1
    keys = groups["A"] + groups["B"]
    if constant_field == "prediction":
        first = {k: row(0.1, i % 2) for i, k in enumerate(keys)}
        second = {k: row((i % 6 + 1) / 10, i % 2) for i, k in enumerate(keys)}
        market = {k: row(0.4, i % 2) for i, k in enumerate(keys)}
        metric = "prediction_diversity"
    else:
        first = {k: row((i % 3) / 4, 0, offset=0.1 - ((i % 3) / 4) ** 2) for i, k in enumerate(keys)}
        second = {k: {**r, "prediction": str(0.6 + (i % 3) / 10)} for i, (k, r) in enumerate(first.items())}
        market = {k: {**r, "prediction": "0.4"} for k, r in first.items()}
        assert len(set(adjusted_losses(first, keys))) == 1
        metric = "adjusted_loss_corr"
    expected = reference_views(reference_folds(first, second, market, seeds=[SEEDS[0]]))
    assert expected["all"]["combined"]["train_diversity"][metric] is None
    actual = evaluate_pair("A (zero shot)", "B (scratchpad)", first, second, market, split_seeds=[SEEDS[0]])
    assert compare_expected(expected, build_views(actual)) == []


def test_full_artifact_auditor_checks_shards_cache_chunks_and_old_file_hashes(tmp_path):
    first, second, market = basic_panels()
    names = ("Grok-Test (zero shot with freeze values)", "Grok-Test (scratchpad)")
    identities = {
        name: {"exact_configuration": name, "canonical_model_version": "Grok-Test",
               "model_configuration": config, "provider": "xAI", "prompt_type": prompt,
               "prompt_label": prompt, "information_type": information, "information_label": information}
        for name, config, prompt, information in zip(names, ("zero shot with freeze values", "scratchpad"),
                                                    ("zero_shot", "scratchpad"), ("freeze_values", "none"))}
    site_data, derived = tmp_path / "public", tmp_path / "derived"
    experiment = site_data / "configuration-pair-aggregation"
    experiment.mkdir(parents=True)
    derived.mkdir()
    catalog_path = site_data / "catalog.json"

    def score(panel):
        keys = list(first)
        raw = mean([(float(panel[k]["prediction"]) - float(panel[k]["outcome"])) ** 2 for k in keys])
        adjusted = mean(adjusted_losses(panel, keys))
        return {"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": brier_index(adjusted)}

    catalog_path.write_text(json.dumps({"points": [
        {**identities[name], "n_common": len(first), "model": score(panel), "matched_market": score(market)}
        for name, panel in zip(names, (first, second))]}))
    baseline_path = tmp_path / "before.json"
    baseline_path.write_text(json.dumps({"files": {"catalog.json": file_sha256(catalog_path)}}))
    fields = ("exact_configuration", "date", "source", "event_id", "horizon", "prediction", "outcome",
              "origin_type", "question_fixed_effect", "normalization_term", "market_prediction", "source_file")
    with gzip.open(derived / "clean_panel.csv.gz", "wt", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for name, panel in zip(names, (first, second)):
            for k, r in panel.items():
                writer.writerow({"exact_configuration": name, **dict(zip(("date", "source", "event_id", "horizon"), k)),
                                 **r, "market_prediction": market[k]["prediction"], "source_file": "fixture.json"})
    result = evaluate_pair(*names, first, second, market)
    configurations = []
    for index, name in enumerate(names):
        partner = names[1 - index]
        file = f"config-{index}.json"
        configurations.append({**identities[name], "file": file, "eligible_partner_count": 1})
        pair = {key: value for key, value in result.items() if key != "folds"}
        pair.update(partner=identities[partner], views=build_views(result, reverse=bool(index)))
        (experiment / file).write_text(json.dumps({"schema_version": 1, "base_configuration": name,
                                                  "base": identities[name], "partners": [pair]}))
    fold_path = derived / "part.jsonl.gz"
    with gzip.open(fold_path, "wt") as handle:
        for fold in result["folds"]:
            handle.write(json.dumps({"first_configuration": names[0], "second_configuration": names[1], **fold}) + "\n")
    (derived / "fold-results-manifest.json").write_text(json.dumps({
        "row_count": len(result["folds"]), "files": [{"file": fold_path.name, "row_count": len(result["folds"]),
                                                      "bytes": fold_path.stat().st_size, "sha256": file_sha256(fold_path)}]}))
    (experiment / "manifest.json").write_text(json.dumps({
        "schema_version": 1, "methods": dict.fromkeys(METHODS, {}), "method_order": METHODS,
        "metrics": dict.fromkeys(METRICS, {}), "metric_order": METRICS,
        "split": {"repetitions": 10, "seeds": SEEDS, "minimum_fold_overlap": 1, "near_bi_gap": 2},
        "configurations": configurations,
        "audit": {"configuration_count": 2, "candidate_unordered_pairs": 1,
                  "unordered_pair_status_counts": {"eligible": 1}, "unordered_fold_records": 20,
                  "configuration_target_rows": len(first) * 2}}))
    report = audit_artifacts(site_data, derived, catalog_path, baseline_path, sampled_pair_count=1)
    assert report["passed"], report["errors"]
    assert report["ordered_partner_records"] == 2
    assert report["sampled_unordered_pairs"] == 1
    assert report["fold_artifacts"]["row_count"] == 20
    assert report["pre_existing_public_json"]["checked"] == 1
    # A changed base prompt must fail even if every numeric result is untouched.
    path = experiment / "config-0.json"
    payload = json.loads(path.read_text())
    payload["base"]["model_configuration"] = "different prompt"
    path.write_text(json.dumps(payload))
    assert not audit_artifacts(site_data, derived, catalog_path, baseline_path, sampled_pair_count=1)["passed"]
