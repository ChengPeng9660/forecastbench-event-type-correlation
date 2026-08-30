"""Tamper tests for independent diagnostics-only provenance and scalar checks."""
from copy import deepcopy
import json
import math
import subprocess

import pytest

from analysis.audit_high_loss_refresh import audit_refresh, compare_payload, file_checksum, validate_high_loss_summaries


def diagnostic(missing=1):
    return {"threshold": .25, "included_fold_count": 2, "defined_fold_count": 2 - missing,
            "undefined_fold_count": missing, "train_target_cells": 100,
            "valid_train_target_cells": 100 - 50 * missing,
            "reason_counts": {"model_a_marginal_high_loss_rate_zero": missing} if missing else {},
            "reason": "one_or_more_included_fold_lifts_undefined" if missing else ""}


def refreshed(value=None):
    return {"fold_count": 2, "score": .12, "train_diversity": {"high_loss_lift": value, "total_variation": 0.0},
            "train_diversity_target_cells": {"high_loss_lift": 50}, "high_loss_diagnostics": diagnostic()}


def original():
    row = refreshed(.7)
    row.pop("high_loss_diagnostics")
    return row


def test_accepts_only_explained_coordinate_null_and_keeps_zero_and_support():
    counts = compare_payload(original(), refreshed())
    assert counts["coordinates_changed_to_null"] == 1
    assert counts["diagnostic_objects"] == 1
    assert counts["preserved_scalars"] == 4


@pytest.mark.parametrize("tamper", ["score", "tv", "support", "membership", "new_field", "finite_change", "missing_diagnostic", "false_missing"])
def test_rejects_protected_or_unjustified_changes(tamper):
    row = refreshed()
    if tamper == "score": row["score"] = math.nextafter(row["score"], 1)
    if tamper == "tv": row["train_diversity"]["total_variation"] = .1
    if tamper == "support": row["train_diversity_target_cells"]["high_loss_lift"] = 49
    if tamper == "membership": row.pop("fold_count")
    if tamper == "new_field": row["new_score"] = .1
    if tamper == "finite_change": row["train_diversity"]["high_loss_lift"] = .6
    if tamper == "missing_diagnostic": row.pop("high_loss_diagnostics")
    if tamper == "false_missing": row["high_loss_diagnostics"] = diagnostic(0)
    with pytest.raises(ValueError): compare_payload(original(), row)


def test_raw_and_complementarity_null_together_and_reason_is_bound():
    old = {"metrics": {"high_loss_lift": {"raw": .3, "complementarity": .7, "reason": "", "label": "High loss"}}}
    new = deepcopy(old)
    new["high_loss_diagnostics"] = diagnostic()
    new["metrics"]["high_loss_lift"].update(raw=None, complementarity=None, reason=diagnostic()["reason"])
    assert compare_payload(old, new)["coordinates_changed_to_null"] == 1
    new["metrics"]["high_loss_lift"]["raw"] = .3
    with pytest.raises(ValueError, match="inconsistent null"): compare_payload(old, new)


def test_allows_new_reason_only_for_an_explained_null_coordinate():
    old = {"metrics": {"high_loss_lift": {"raw": 1.3, "complementarity": -.3}}}
    new = {"metrics": {"high_loss_lift": {"raw": None, "complementarity": None, "reason": diagnostic()["reason"]}},
           "high_loss_diagnostics": diagnostic()}
    assert compare_payload(old, new)["coordinates_changed_to_null"] == 1
    new["metrics"]["high_loss_lift"]["reason"] = "invented reason"
    with pytest.raises(ValueError, match="new missing reason"): compare_payload(old, new)


def test_derived_summary_is_recomputed_on_refreshed_raw_values_with_average_tie_ranks():
    points = [{"base_model": "A", "combined": {"train_diversity": {"high_loss_lift": x},
               "aggregation": {"mean": {"gain_vs_base": y}}, "near_bi": True}}
              for x, y in ((-35, .1), (1, .2), (1, .4), (None, .8))]
    summary = {"base_model": "A", "method": "mean", "metric": "high_loss_lift", "defined_pair_count": 3,
               "pearson": 0.7559289460184544, "spearman": 0.8660254037844387, "near_bi_pearson": 0.7559289460184544}
    payload = {"points": points, "evaluation": {"focal_correlation_summary": [summary]}}
    assert validate_high_loss_summaries(payload) == 1
    summary["pearson"] = 1.0
    with pytest.raises(ValueError, match="does not match"): validate_high_loss_summaries(payload)


def provenance_fixture(tmp_path):
    repo = tmp_path
    def write(relative, value):
        path = repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value) if not isinstance(value, str) else value)
        return path
    producer = write("analysis/configuration_pair_aggregation.py", "original producer")
    catalog = write("site/public/data/polymarket-aggregation/market-diversity-performance.json", {"points": []})
    clean = write("data/derived/configuration_pair_aggregation/clean_panel.csv.gz", "clean cache")
    shard_path = write("site/public/data/configuration-pair-aggregation/configurations/a.json", original())
    manifest = {"provenance": {"producer_sha256": file_checksum(producer), "catalog": str(catalog.relative_to(repo)),
                              "catalog_sha256": file_checksum(catalog)},
                "audit": {"clean_intermediate": str(clean.relative_to(repo)), "clean_intermediate_sha256": file_checksum(clean)},
                "configurations": [{"file": "configurations/a.json"}]}
    manifest_path = write("site/public/data/configuration-pair-aggregation/manifest.json", manifest)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=audit@example.invalid", "-c", "user.name=Audit Fixture", "commit", "-qm", "original"], check=True)
    baseline = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    before = file_checksum(shard_path)
    write(str(shard_path.relative_to(repo)), refreshed())
    producer.write_text("original producer plus diagnostics")
    script = write("analysis/refresh_high_loss_diagnostics.py", "refresh script")
    report = {"baseline_ref": baseline, "script_sha256": file_checksum(script), "clean_cache_sha256": file_checksum(clean),
              "scores_or_weights_refit": False, "non_high_loss_changes": 0, "file_count": 1,
              "files": [{"file": "configuration-pair-aggregation/configurations/a.json", "before_sha256": before,
                         "after_sha256": file_checksum(shard_path)}]}
    report_path = write("data/derived/high_loss_diagnostics_audit/report-final.json", report)
    manifest["provenance"]["diagnostics_refresh"] = {
        "kind": "high_loss_diagnostics_only", "baseline_ref": baseline,
        "aggregation_producer_sha256": manifest["provenance"]["producer_sha256"], "current_producer_sha256": file_checksum(producer),
        "refresh_script": str(script.relative_to(repo)), "refresh_script_sha256": file_checksum(script),
        "audit_report": str(report_path.relative_to(repo)), "audit_report_sha256": file_checksum(report_path),
        "clean_intermediate_sha256": file_checksum(clean), "original_catalog_sha256": file_checksum(catalog),
        "current_catalog_sha256": file_checksum(catalog)}
    write(str(manifest_path.relative_to(repo)), manifest)
    return repo, manifest, shard_path, report_path


def test_provenance_verifies_original_and_current_sources_without_overwriting_original_sha(tmp_path):
    repo, manifest, _, _ = provenance_fixture(tmp_path)
    result = audit_refresh(repo, repo / "site/public/data", manifest)
    assert result["passed"] and result["file_count"] == 1
    assert result["coordinates_changed_to_null"] == 1
    refresh = manifest["provenance"]["diagnostics_refresh"]
    assert refresh["aggregation_producer_sha256"] != refresh["current_producer_sha256"]


def test_new_unrelated_public_payload_is_not_mistaken_for_a_changed_baseline(tmp_path):
    repo, manifest, _, _ = provenance_fixture(tmp_path)
    added = repo / "site/public/data/new-independent-experiment.json"
    added.write_text('{"new_experiment":true}')
    subprocess.run(["git", "-C", str(repo), "add", str(added)], check=True)
    assert audit_refresh(repo, repo / "site/public/data", manifest)["passed"]


@pytest.mark.parametrize("target", ["producer", "report", "payload", "original_sha", "unreported_json", "rehashed_score"])
def test_provenance_rejects_checksum_bypass_and_rehashed_non_high_loss_changes(tmp_path, target):
    repo, manifest, shard_path, report_path = provenance_fixture(tmp_path)
    if target == "producer": (repo / "analysis/configuration_pair_aggregation.py").write_text("changed again")
    if target == "report": report_path.write_text(report_path.read_text() + " ")
    if target == "payload": shard_path.write_text(shard_path.read_text() + " ")
    if target == "original_sha": manifest["provenance"]["producer_sha256"] = "0" * 64
    if target == "unreported_json":
        (repo / "site/public/data/polymarket-aggregation/market-diversity-performance.json").write_text('{"points":[1]}')
    if target == "rehashed_score":
        payload = json.loads(shard_path.read_text()); payload["score"] = .4
        shard_path.write_text(json.dumps(payload))
        report = json.loads(report_path.read_text()); report["files"][0]["after_sha256"] = file_checksum(shard_path)
        report_path.write_text(json.dumps(report))
        manifest["provenance"]["diagnostics_refresh"]["audit_report_sha256"] = file_checksum(report_path)
    try:
        result = audit_refresh(repo, repo / "site/public/data", manifest)
    except ValueError:
        return
    assert result["passed"] is False
