from __future__ import annotations

import csv
import json
from pathlib import Path

from analysis.export_site import build_site_artifacts


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_exporter_writes_real_schema_and_explicit_nulls(tmp_path: Path) -> None:
    taxonomy_csv = tmp_path / "taxonomy.csv"
    write_csv(
        taxonomy_csv,
        [
            {
                "date": "2025-01-01",
                "source": "fred",
                "event_id": "event-1",
                "topic_id": "finance_economics",
                "origin_type": "Dataset",
                "official_source": "FRED",
                "topic_status": "source_rule",
                "topic_confidence": "high",
                "topic_rule_id": "source.fred",
                "topic_analysis_eligible": "true",
                "review_required": "false",
            }
        ],
    )
    scored_csv = tmp_path / "scored.csv"
    write_csv(
        scored_csv,
        [
            {
                "date": "2025-01-01", "source": "fred", "event_id": "event-1", "horizon": "7",
                "model_name": "Model A", "model_organization": "OpenAI", "adjusted_brier": "0.1",
            },
            {
                "date": "2025-01-01", "source": "fred", "event_id": "event-1", "horizon": "7",
                "model_name": "Model B", "model_organization": "Anthropic", "adjusted_brier": "0.2",
            },
        ],
    )
    pair_csv = tmp_path / "pairs.csv"
    write_csv(
        pair_csv,
        [
            {
                "slice_dimension": "topic", "slice_id": "finance_economics", "topic_id": "finance_economics",
                "model_a": "Model A", "model_b": "Model B",
                "organization_a": "OpenAI", "organization_b": "Anthropic", "n_overlap": "50",
                "n_dates": "1", "eligible": "1", "insufficient_overlap_reason": "",
                "adjusted_pog": "0.03", "adjusted_high_loss_lift_025": "",
                "adjusted_loss_pearson_corr": "0.2", "bi_gap_common": "1.5", "near_bi": "1",
                "pog_reason": "", "lift_reason": "both_marginal_high_loss_rates_zero", "corr_reason": "",
                "metric_status": "eligible_partial:lift",
            }
        ],
    )
    taxonomy_summary = {
        "taxonomy_version": "event-topic-v1", "row_count": 1,
        "unique_date_source_event_count": 1,
        "status_counts": {"source_rule": 1},
    }
    scoring_audit = {
        "fixed_effects_file": "official-fixed-effects.json",
        "fixed_effects_sha256": "f" * 64,
    }
    metrics_audit = {
        "min_overlap": 50, "near_bi_gap": 2.0, "high_adjusted_loss_threshold": 0.25,
        "join_counters": {"scored_rows_missing_taxonomy": 0},
    }
    for name, payload in (
        ("taxonomy-summary.json", taxonomy_summary),
        ("scoring-audit.json", scoring_audit),
        ("metrics-audit.json", metrics_audit),
    ):
        (tmp_path / name).write_text(json.dumps(payload), encoding="utf-8")

    site_data = tmp_path / "site" / "public" / "data"
    derived = tmp_path / "data" / "derived"
    summary = build_site_artifacts(
        pair_csv=pair_csv,
        taxonomy_csv=taxonomy_csv,
        taxonomy_summary_json=tmp_path / "taxonomy-summary.json",
        scored_panel=scored_csv,
        scoring_audit_json=tmp_path / "scoring-audit.json",
        metrics_audit_json=tmp_path / "metrics-audit.json",
        site_data_dir=site_data,
        derived_dir=derived,
        analysis_commit="abc123",
        built_at="2026-08-19T00:00:00+00:00",
    )

    assert summary["eligible_pair_slice_rows"] == 1
    manifest = json.loads((site_data / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["fixture"] is False
    assert manifest["source_snapshot"]["official_targets"] == 1
    finance = json.loads(
        (site_data / "event-types" / "finance_economics.json").read_text(encoding="utf-8")
    )
    assert finance["pairs"][0]["metrics"]["adjusted_pog"]["value"] == 0.03
    assert finance["pairs"][0]["metrics"]["high_loss_lift"]["value"] is None
    assert finance["pairs"][0]["metrics"]["high_loss_lift"]["reason"] == "both_marginal_high_loss_rates_zero"
    assert len(manifest["event_types"]) == 10
    assert (derived / "pair_metrics_all.csv.gz").exists()
    assert (derived / "pair_metrics_eligible.csv.gz").exists()
