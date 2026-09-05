import copy
import csv
import gzip
import json
from pathlib import Path

import pytest

import analysis.configuration_pair_aggregation as experiment
from analysis.pair_aggregation import event_fold, predictions


def row(key, p, outcome, adjustment=0.03):
    return {**dict(zip(experiment.KEY, key)), "prediction": str(p), "outcome": str(outcome),
            "origin_type": "Market", "question_fixed_effect": "0", "normalization_term": str(adjustment),
            "source_file": "fixture.json"}


def panels(n=60):
    first, second, market = {}, {}, {}
    for i in range(n):
        key = ("2026-01-01", "polymarket", f"event-{i}", "")
        first[key] = row(key, 0.1 + (i % 8) * 0.1, i % 2)
        second[key] = row(key, 0.15 + (i % 7) * 0.1, i % 2)
        market[key] = row(key, 0.5, i % 2)
    return first, second, market


def direct_cf(base, partner, train, test):
    weights = []
    for upward in (True, False):
        values = [(float(partner[k]["prediction"]) - float(base[k]["prediction"]),
                   float(base[k]["outcome"]) - float(base[k]["prediction"])) for k in train
                  if (float(partner[k]["prediction"]) >= float(base[k]["prediction"])) == upward]
        c = sum(d * residual for d, residual in values)
        d2 = sum(d * d for d, _ in values)
        weights.append(min(1, max(0, c / d2)) if d2 else 0)
    forecasts = []
    for key in test:
        p, q = float(base[key]["prediction"]), float(partner[key]["prediction"])
        forecasts.append(p + weights[0 if q >= p else 1] * (q - p))
    return weights, sum((q - float(base[k]["outcome"])) ** 2 for k, q in zip(test, forecasts)) / len(test)


def test_all_six_methods_match_direct_predictions_on_identical_pair_market_support():
    first, second, market = panels()
    omitted = next(iter(market))
    del market[omitted]
    result = experiment.evaluate_pair("first exact", "second exact", first, second, market)
    common = set(first) & set(second) & set(market)
    assert result["status"] == "eligible"
    assert result["n_common"] == 59
    assert len(result["folds"]) == 20
    for fold in result["folds"]:
        train = sorted(k for k in common if event_fold(k[1], k[2], fold["seed"]) == fold["train_fold"])
        test = sorted(common - set(train))
        assert fold["n_train"] == len(train)
        assert fold["n_test"] == len(test)
        assert fold["train_diversity"]["total_variation"] == pytest.approx(
            sum(abs(float(first[k]["prediction"]) - float(second[k]["prediction"])) for k in train) / len(train)
        )
        for base, partner, name in ((first, second, "first"), (second, first, "second")):
            weights, raw = direct_cf(base, partner, train, test)
            assert list(fold[f"weights_{name}"].values()) == pytest.approx(weights)
            assert fold[f"cf_{name}"]["raw_brier"] == pytest.approx(raw, abs=1e-12)
        for method in experiment.FIXED_METHODS:
            expected = sum((predictions(float(first[k]["prediction"]), float(second[k]["prediction"]), 0.56, 5)[method]
                            - float(first[k]["outcome"])) ** 2 for k in test) / len(test)
            assert fold["methods"][method]["raw_brier"] == pytest.approx(expected)
        assert fold["methods"]["best_single"]["raw_brier"] == min(fold["first"]["raw_brier"], fold["second"]["raw_brier"])
        assert fold["market"]["raw_brier"] == 0.25


def test_test_changes_do_not_change_training_weights_diversity_or_near_bi():
    first, second, market = panels()
    before = experiment.evaluate_pair("first", "second", first, second, market)["folds"][0]
    changed = [copy.deepcopy(p) for p in (first, second, market)]
    for key in first:
        if event_fold(key[1], key[2], before["seed"]) == before["test_fold"]:
            for panel in changed:
                panel[key]["outcome"] = str(1 - float(panel[key]["outcome"]))
            changed[1][key]["prediction"] = "0.99"
    after = experiment.evaluate_pair("first", "second", *changed)["folds"][0]
    for field in ("train_diversity", "train_bi_gap", "train_near_bi", "train_cf_statistics", "weights_first", "weights_second"):
        assert after[field] == before[field]
    assert after["cf_first"] != before["cf_first"]


def test_missing_train_direction_retains_each_selected_base_independently():
    seed = experiment.DEFAULT_SEEDS[0]
    keys = {fold: next(("2026-01-01", "polymarket", f"event-{i}", "") for i in range(100)
                       if event_fold("polymarket", f"event-{i}", seed) == fold) for fold in ("A", "B")}
    first = {keys["A"]: row(keys["A"], 0.2, 0), keys["B"]: row(keys["B"], 0.8, 1)}
    second = {keys["A"]: row(keys["A"], 0.6, 0), keys["B"]: row(keys["B"], 0.4, 1)}
    market = {key: row(key, 0.5, float(first[key]["outcome"])) for key in first}
    result = experiment.evaluate_pair("first", "second", first, second, market, split_seeds=[seed])
    fold = result["folds"][0]
    assert fold["weights_first"]["downward_alpha"] == 0
    assert fold["weights_second"]["upward_alpha"] == 0
    assert fold["cf_first"]["raw_brier"] == pytest.approx(0.04)
    assert fold["cf_second"]["raw_brier"] == pytest.approx(0.36)


def test_partial_folds_and_small_support_are_explicit_and_zero_overlap_is_not_filled():
    first, second, market = panels(2)
    result = experiment.evaluate_pair("first", "second", first, second, market)
    keys = list(first)
    expected = 2 * sum(event_fold(k1[1], k1[2], seed) != event_fold(k2[1], k2[2], seed)
                       for seed in experiment.DEFAULT_SEEDS for k1, k2 in [keys])
    assert result["status"] == "eligible"
    assert 0 < expected < 20
    assert len(result["folds"]) == expected
    assert len(result["skipped_splits"]) == (20 - expected) // 2
    view = experiment.build_views(result)["all"]["combined"]
    assert view["fold_count"] == expected
    assert view["small_support"] is True
    assert view["min_train_rows"] == view["min_test_rows"] == 1
    assert view["train_diversity"]["prediction_diversity"] is None
    assert view["train_diversity"]["total_variation"] is not None
    empty = experiment.evaluate_pair("first", "second", first, {}, market)
    assert empty["status"] == "zero_common_support"
    assert all(leaf is None for sample in experiment.build_views(empty).values() for leaf in sample.values())
    one = next(iter(first))
    same_event = ("2026-02-01", *one[1:])
    for panel in (first, second, market):
        panel.clear()
        panel.update({one: row(one, 0.5, 1), same_event: row(same_event, 0.5, 0)})
    inseparable = experiment.evaluate_pair("first", "second", first, second, market)
    assert inseparable["n_common"] == 2
    assert inseparable["unique_event_count"] == 1
    assert inseparable["status"] == "insufficient_split_support"


def test_view_metrics_and_bi_do_not_silently_drop_undefined_folds():
    result = experiment.evaluate_pair("first", "second", *panels())
    folds = copy.deepcopy(result["folds"][:2])
    folds[0]["train_diversity"]["total_variation"] = None
    folds[0]["train_metric_reasons"]["total_variation"] = "fixture_missing"
    folds[0]["methods"]["simple_mean"]["raw_brier"] = None
    for fold in folds:
        fold["first"]["raw_brier"] = None
    view = experiment.aggregate_view(folds)
    assert view["train_diversity"]["total_variation"] is None
    assert view["train_diversity_target_cells"]["total_variation"] == folds[1]["n_train"]
    assert view["methods"]["simple_mean"]["brier_index"] is None
    assert view["methods"]["simple_mean"]["beats_market"] is False
    assert all(method["gain_vs_base"] is None for method in view["methods"].values())


def test_brier_score_weights_events_equally_and_transforms_bi_once():
    seed = experiment.DEFAULT_SEEDS[0]
    event_ids = {fold: next(f"event-{i}" for i in range(1000)
                            if event_fold("polymarket", f"event-{i}", seed) == fold)
                 for fold in ("A", "B")}
    keys = [
        ("2026-01-01", "polymarket", event_ids["A"], "h1"),
        ("2026-01-02", "polymarket", event_ids["A"], "h2"),
        ("2026-01-01", "polymarket", event_ids["B"], "h1"),
    ]
    # Event A has two perfect targets; event B has one maximally wrong target.
    # The event-equal Brier score is therefore (0 + 1) / 2 = 0.5 rather than 1/3.
    first = {key: row(key, probability, outcome, adjustment=0)
             for key, probability, outcome in zip(keys, (0, 1, 0), (0, 1, 1))}
    second = {key: row(key, 0.5, outcome, adjustment=0)
              for key, outcome in zip(keys, (0, 1, 1))}
    market = {key: row(key, 0.5, outcome, adjustment=0)
              for key, outcome in zip(keys, (0, 1, 1))}
    result = experiment.evaluate_pair("first", "second", first, second, market, split_seeds=[seed])
    view = experiment.build_views(result)["all"]["combined"]
    assert view["base"]["raw_brier"] == pytest.approx(0.5)
    assert view["base"]["brier_index"] == pytest.approx(100 * (1 - 0.5 ** 0.5))
    assert view["test_event_cells"] == 2
    assert view["test_target_cells"] == 3


def test_near_bi_is_filtered_per_training_fold_and_market_wins_use_tolerance():
    result = experiment.evaluate_pair("first", "second", *panels())
    folds = result["folds"]
    for index, fold in enumerate(folds):
        fold["train_near_bi"] = index % 3 == 0
        fold["methods"]["simple_mean"]["brier_index"] = fold["market"]["brier_index"] + 5e-13
    views = experiment.build_views(result)
    expected = [fold["fold_id"] for fold in folds if fold["train_near_bi"]]
    assert views["near_bi"]["combined"]["fold_ids"] == expected
    assert views["all"]["combined"]["methods"]["simple_mean"]["beats_market"] is False
    for fold in folds:
        fold["train_near_bi"] = False
    assert experiment.build_views(result)["near_bi"]["combined"] is None


def test_run_writes_exact_identity_shards_and_small_reusable_diagnostics(tmp_path, monkeypatch):
    first, second, market = panels()
    names = ["Grok-Test (zero shot)", "Grok-Test (scratchpad with freeze values)"]
    identities = {name: {field: name if field == "exact_configuration" else "fixture" for field in experiment.IDENTITY_FIELDS} for name in names}
    monkeypatch.setattr(experiment, "load_inputs", lambda *_: ({names[0]: first, names[1]: second}, market, identities, {}))
    input_file = tmp_path / "input.json"
    input_file.write_text("{}", encoding="utf-8")
    derived, public = tmp_path / "derived", tmp_path / "public"
    manifest = experiment.run_experiment(input_file, input_file, tmp_path, input_file, derived, public)
    assert manifest["audit"]["configuration_count"] == 2
    assert manifest["audit"]["unordered_fold_records"] == 20
    for config in manifest["configurations"]:
        shard = json.loads((public / config["file"]).read_text())
        assert shard["base_configuration"] == config["exact_configuration"]
        assert len(shard["partners"]) == 1
        assert set(shard["partners"][0]["views"]["all"]["combined"]["methods"]) == set(experiment.METHOD_ORDER)
    index = json.loads((derived / "fold-results-manifest.json").read_text())
    assert index["row_count"] == sum(file["row_count"] for file in index["files"]) == 20
    with gzip.open(derived / index["files"][0]["file"], "rt") as handle:
        assert len(list(handle)) == 20
    with gzip.open(derived / "clean_panel.csv.gz", "rt") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 120
    assert {row["exact_configuration"] for row in rows} == set(names)
    assert all(row["market_prediction"] == "0.5" for row in rows)


@pytest.mark.parametrize("n", [3, 12])
def test_exact_constants_are_undefined_before_roundoff_variance(n):
    variable = [i / n for i in range(n)]
    for first, second in (([0.1] * n, variable), (variable, [0.1] * n), ([0.1] * n, [0.1] * n)):
        correlation, reason = experiment._correlation(first, second)
        assert correlation is None
        assert "constant" in reason
    cells = [experiment.PairCell(("2026-01-01", "polymarket", str(i), ""), 0.1, variable[i], 0.0,
                                 (0.1, variable[i], 0.2, 0.2, 0.2, 0.2, 0.2), 0.0, 0.0)
             for i in range(n)]
    summary = experiment._half_summary(cells)
    for metric in ("prediction_diversity", "adjusted_loss_corr"):
        assert summary["diversity"][metric] is None
        assert "constant" in summary["metric_reasons"][metric]
    assert summary["diversity"]["total_variation"] is not None


@pytest.fixture
def clean_cache_fixture(tmp_path):
    first, second, market = panels()
    all_panels = {"First exact": first, "Second exact": second}
    points = []
    for name, panel in all_panels.items():
        point = {field: name if field == "exact_configuration" else "fixture" for field in experiment.IDENTITY_FIELDS}
        point["n_common"] = len(panel)
        for source, label in ((panel, "model"), (market, "matched_market")):
            prepared = experiment.prepare_panel(source)
            point[label] = experiment._score(sum(row.raw_loss for row in prepared.values()) / len(source), 0.03)
        points.append(point)
    panel_path, taxonomy_path, catalog_path = (tmp_path / file for file in ("panel.csv", "taxonomy.csv", "catalog.json"))
    panel_path.write_text("fixture panel", encoding="utf-8")
    taxonomy_path.write_text("fixture taxonomy", encoding="utf-8")
    catalog_path.write_text(json.dumps({"points": points}), encoding="utf-8")
    clean_path = tmp_path / "derived" / "clean_panel.csv.gz"
    experiment.write_clean_intermediate(clean_path, all_panels, market)
    audit = {"clean_intermediate_sha256": experiment.sha256_file(clean_path), "configuration_target_rows": 120,
             "inputs": {"imputation": {"policy": "fixture clean snapshot"}},
             "provenance": {f"{name}_sha256": experiment.sha256_file(path)
                            for name, path in (("panel", panel_path), ("taxonomy", taxonomy_path), ("catalog", catalog_path))}}
    (clean_path.parent / "audit.json").write_text(json.dumps(audit), encoding="utf-8")
    return clean_path, panel_path, taxonomy_path, catalog_path, all_panels, market


def test_verified_clean_cache_reconstructs_identical_pair_results(clean_cache_fixture):
    clean, panel_path, taxonomy_path, catalog_path, original, original_market = clean_cache_fixture
    panel, market, identities, audit = experiment.load_clean_cache(clean, panel_path, taxonomy_path, catalog_path)
    assert set(identities) == set(original)
    assert panel == original
    assert audit["verified_clean_cache"]["panel_taxonomy_catalog_hashes_verified"] is True
    assert audit["verified_clean_cache"]["processed_raw_files_reread"] is False
    actual = experiment.evaluate_pair("First exact", "Second exact", panel["First exact"], panel["Second exact"], market)
    expected = experiment.evaluate_pair("First exact", "Second exact", original["First exact"], original["Second exact"], original_market)
    assert actual == expected
    rewritten = clean.with_name("roundtrip.csv.gz")
    experiment.write_clean_intermediate(rewritten, panel, market)
    assert experiment.sha256_file(rewritten) == experiment.sha256_file(clean)


@pytest.mark.parametrize("changed", ["cache", "panel", "taxonomy", "catalog"])
def test_clean_cache_rejects_changed_snapshot_or_input_hashes(clean_cache_fixture, changed):
    clean, panel_path, taxonomy_path, catalog_path, _, _ = clean_cache_fixture
    path = {"cache": clean, "panel": panel_path, "taxonomy": taxonomy_path, "catalog": catalog_path}[changed]
    path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(ValueError, match="SHA-256"):
        experiment.load_clean_cache(clean, panel_path, taxonomy_path, catalog_path)


def test_clean_cache_checks_reconstructed_scores_after_hash_validation(clean_cache_fixture):
    clean, panel_path, taxonomy_path, catalog_path, _, _ = clean_cache_fixture
    with gzip.open(clean, "rt") as handle:
        rows = list(csv.DictReader(handle))
    rows[0]["prediction"] = "0.99"
    with experiment.gzip_text_writer(clean) as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    audit_path = clean.parent / "audit.json"
    audit = json.loads(audit_path.read_text())
    audit["clean_intermediate_sha256"] = experiment.sha256_file(clean)
    audit_path.write_text(json.dumps(audit), encoding="utf-8")
    with pytest.raises(ValueError, match="catalog score changed"):
        experiment.load_clean_cache(clean, panel_path, taxonomy_path, catalog_path)
