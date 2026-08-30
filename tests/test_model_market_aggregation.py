import copy
import gzip
import json
from pathlib import Path

import pytest

from analysis import configuration_pair_aggregation as pair
from analysis import model_market_aggregation as experiment
from analysis.pair_aggregation import event_fold, sha256_file


def fixture_panels():
    model, market = {}, {}
    for index in range(60):
        for date, horizon in (("2026-01-01", "7"), ("2026-01-02", "6")):
            key = (date, "polymarket", f"event-{index}", horizon)
            common = {"outcome": str(index % 2), "origin_type": "Market", "question_fixed_effect": "0",
                      "normalization_term": "0.03", "source_file": "fixture.json"}
            market[key] = {**dict(zip(pair.KEY, key)), **common, "prediction": str(0.2 + (index % 4) * 0.15)}
            model[key] = {**dict(zip(pair.KEY, key)), **common, "prediction": str(0.1 + (index % 5) * 0.2)}
    return model, market


def evaluate(model, market, **kwargs):
    return experiment.evaluate_model_market("Model (zero shot with freeze values)", pair.prepare_panel(model),
                                             pair.prepare_panel(market), **kwargs)


def direct_market_cf(model, market, train, test):
    alphas = []
    for upward in (True, False):
        numerator = denominator = 0.0
        for key in train:
            p, q = float(market[key]["prediction"]), float(model[key]["prediction"])
            if (q >= p) == upward:
                numerator += (float(market[key]["outcome"]) - p) * (q - p)
                denominator += (q - p) ** 2
        alphas.append(min(1.0, max(0.0, numerator / denominator)) if denominator else 0.0)
    losses = []
    for key in test:
        p, q = float(market[key]["prediction"]), float(model[key]["prediction"])
        probability = p + alphas[0 if q >= p else 1] * (q - p)
        losses.append((probability - float(market[key]["outcome"])) ** 2)
    return alphas, sum(losses) / len(losses)


def test_cf_fixes_market_anchor_and_repeated_events_stay_together():
    model, market = fixture_panels()
    result = evaluate(model, market)
    assert result["first_configuration"] == "Polymarket Freeze"
    assert result["second_configuration"] == "Model (zero shot with freeze values)"
    assert result["unique_event_count"] == 60
    assert result["n_common"] == 120
    assert len(result["folds"]) == 20
    for fold in result["folds"]:
        train = [key for key in model if event_fold(key[1], key[2], fold["seed"]) == fold["train_fold"]]
        test = [key for key in model if event_fold(key[1], key[2], fold["seed"]) == fold["test_fold"]]
        assert {key[2] for key in train}.isdisjoint({key[2] for key in test})
        weights, raw = direct_market_cf(model, market, train, test)
        assert list(fold["weights_first"].values()) == pytest.approx(weights)
        assert fold["cf_first"]["raw_brier"] == pytest.approx(raw)
        assert fold["first"] == fold["market"]
    view = pair.build_views(result)["all"]["combined"]
    assert view["base"] == view["market"]
    cf = view["methods"]["cf_directional"]
    expected = sum(fold["cf_first"]["raw_brier"] * fold["n_test"] for fold in result["folds"])
    assert cf["raw_brier"] == pytest.approx(expected / view["test_target_cells"])
    assert cf["gain_vs_base"] == cf["gain_vs_market"]


def test_test_outcomes_cannot_change_train_diversity_selection_or_cf_weights():
    model, market = fixture_panels()
    before = evaluate(model, market)["folds"][0]
    changed_model, changed_market = copy.deepcopy((model, market))
    for key in model:
        if event_fold(key[1], key[2], before["seed"]) == before["test_fold"]:
            changed_model[key]["outcome"] = changed_market[key]["outcome"] = str(1 - float(model[key]["outcome"]))
            changed_model[key]["prediction"] = "0.999"
    after = evaluate(changed_model, changed_market)["folds"][0]
    for field in ("train_diversity", "train_cf_statistics", "train_bi_gap", "train_near_bi", "weights_first"):
        assert after[field] == before[field]
    assert after["cf_first"]["raw_brier"] != before["cf_first"]["raw_brier"]


def test_unavailable_or_undefined_metrics_are_not_filled():
    model, market = fixture_panels()
    for row in market.values():
        row["prediction"] = "0.1"
    view = pair.build_views(evaluate(model, market))["all"]["combined"]
    assert view["train_diversity"]["prediction_diversity"] is None
    assert view["train_diversity"]["total_variation"] is not None
    assert "first_vector_constant" in view["train_metric_reasons"]["prediction_diversity"]
    one_event = {key: row for key, row in model.items() if key[2] == "event-0"}
    unavailable = evaluate(one_event, market)
    assert unavailable["status"] == "insufficient_split_support"
    assert all(view is None for sample in pair.build_views(unavailable).values() for view in sample.values())


@pytest.fixture
def verified_inputs(tmp_path):
    model, market = fixture_panels()
    identities = []
    panels = {}
    for condition in ("zero shot", "zero shot with freeze values"):
        name = f"Same-Model-Version ({condition})"
        identity = {"exact_configuration": name, "canonical_model_version": "Same-Model-Version",
                    "model_configuration": condition, "provider": "Test", "prompt_type": "zero_shot", "prompt_label": "Zero shot",
                    "information_type": "freeze_values" if "freeze" in condition else "none",
                    "information_label": "Freeze values" if "freeze" in condition else "No extra information"}
        point = {**identity, "n_common": len(model)}
        for source, label in ((model, "model"), (market, "matched_market")):
            observations = pair.prepare_panel(source)
            point[label] = pair._score(sum(row.raw_loss for row in observations.values()) / len(source), 0.03)
        identities.append(point)
        panels[name] = model
    panel_path, taxonomy_path, catalog_path = (tmp_path / name for name in ("panel.csv", "taxonomy.csv", "catalog.json"))
    panel_path.write_text("scored panel fixture", encoding="utf-8")
    taxonomy_path.write_text("taxonomy fixture", encoding="utf-8")
    catalog_path.write_text(json.dumps({"points": identities}), encoding="utf-8")
    cache = tmp_path / "upstream" / "clean_panel.csv.gz"
    pair.write_clean_intermediate(cache, panels, market)
    audit = {"clean_intermediate_sha256": sha256_file(cache), "configuration_target_rows": len(model) * 2,
             "inputs": {"imputation": {"policy": "fixture audited exclusion"}},
             "provenance": {"producer_sha256": sha256_file(Path(pair.__file__)),
                            **{f"{name}_sha256": sha256_file(path) for name, path in
                               (("panel", panel_path), ("taxonomy", taxonomy_path), ("catalog", catalog_path))}}}
    (cache.parent / "audit.json").write_text(json.dumps(audit), encoding="utf-8")
    return cache, panel_path, taxonomy_path, catalog_path


def test_writer_retains_exact_information_identity_and_auditable_market_reference(verified_inputs, tmp_path):
    derived, public = tmp_path / "derived", tmp_path / "public"
    summary = experiment.run_experiment(*verified_inputs, derived, public)
    written = (public / "summary.json").read_text()
    assert str(tmp_path) not in written
    catalog = json.loads(verified_inputs[3].read_text())
    assert len(summary["points"]) == 2
    expected = {row["exact_configuration"]: {field: row[field] for field in pair.IDENTITY_FIELDS} for row in catalog["points"]}
    assert {point["configuration"]["exact_configuration"]: point["configuration"] for point in summary["points"]} == expected
    assert summary["method_order"] == pair.METHOD_ORDER
    assert summary["metric_order"] == pair.METRIC_ORDER
    assert summary["methods"]["best_single"]["deployable"] is False
    for point in summary["points"]:
        for sample in point["views"].values():
            for view in sample.values():
                if view is None:
                    continue
                assert view["base"] == view["market"]
                for method in view["methods"].values():
                    assert method["beats_market"] == (method["brier_index"] > view["market"]["brier_index"] + 1e-12)
    manifest = json.loads((derived / "fold-results-manifest.json").read_text())
    assert manifest["row_count"] == 40
    assert manifest["market_base"] == "Polymarket Freeze"
    for chunk in manifest["files"]:
        path = derived / chunk["file"]
        assert sha256_file(path) == chunk["sha256"]
        with gzip.open(path, "rt") as handle:
            rows = [json.loads(line) for line in handle]
        assert len(rows) == chunk["row_count"]
        assert all(row["first_configuration"] == "Polymarket Freeze" for row in rows)
    audit = json.loads((derived / "audit.json").read_text())
    assert audit["public_summary_sha256"] == sha256_file(public / "summary.json")
    assert audit["inputs"]["verified_clean_cache"]["processed_raw_files_reread"] is False


@pytest.mark.parametrize("changed", ["cache", "panel", "taxonomy", "catalog", "producer"])
def test_new_experiment_rejects_unverified_cache_or_inputs(verified_inputs, changed):
    cache, panel, taxonomy, catalog = verified_inputs
    if changed == "producer":
        audit_path = cache.parent / "audit.json"
        audit = json.loads(audit_path.read_text())
        audit["provenance"]["producer_sha256"] = "not the recorded source"
        audit_path.write_text(json.dumps(audit), encoding="utf-8")
    else:
        path = {"cache": cache, "panel": panel, "taxonomy": taxonomy, "catalog": catalog}[changed]
        path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(ValueError, match="SHA-256"):
        experiment.load_verified_inputs(*verified_inputs)
