from __future__ import annotations

import csv
import json
from pathlib import Path

from analysis.model_versions import (
    build_model_version_panel,
    configuration_preference,
    split_model_version,
)


def test_split_model_version_removes_only_run_configuration() -> None:
    assert split_model_version(
        "Gemini-2.5-Pro-Exp-03-25 (scratchpad with freeze values)"
    ) == ("Gemini-2.5-Pro-Exp-03-25", "scratchpad with freeze values")
    assert split_model_version("Gemini-2.5-Pro-Preview-03-25 (zero shot)") == (
        "Gemini-2.5-Pro-Preview-03-25",
        "zero shot",
    )
    assert split_model_version("Model-X (research preview)") == (
        "Model-X (research preview)",
        "",
    )


def test_plain_zero_shot_is_preferred_without_outcome_information() -> None:
    assert configuration_preference("zero shot") < configuration_preference(
        "zero shot with freeze values"
    )
    assert configuration_preference("zero shot with web search") < configuration_preference(
        "scratchpad"
    )


def test_build_panel_keeps_one_actual_variant_and_preserves_version_tokens(
    tmp_path: Path,
) -> None:
    source = tmp_path / "scored.csv"
    fields = [
        "date",
        "source",
        "event_id",
        "horizon",
        "origin_type",
        "model_name",
        "model_organization",
        "prediction",
        "outcome",
        "adjusted_brier",
    ]
    rows = []
    for model, predictions in (
        ("Gemini-2.5-Pro-Exp-03-25 (scratchpad)", [0.7, 0.8]),
        ("Gemini-2.5-Pro-Exp-03-25 (zero shot)", [0.2, 0.3]),
        ("Gemini-2.5-Pro-Preview-03-25 (zero shot)", [0.4, 0.5]),
    ):
        for index, prediction in enumerate(predictions, start=1):
            rows.append(
                {
                    "date": "2025-01-01",
                    "source": "fred",
                    "event_id": f"e{index}",
                    "horizon": "30",
                    "origin_type": "Dataset",
                    "model_name": model,
                    "model_organization": "Google",
                    "prediction": prediction,
                    "outcome": 1,
                    "adjusted_brier": (1 - prediction) ** 2,
                }
            )
    with source.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    output = tmp_path / "versions.csv"
    mapping = tmp_path / "mapping.csv"
    audit_path = tmp_path / "audit.json"
    audit = build_model_version_panel(source, output, mapping, audit_path)

    kept = list(csv.DictReader(output.open(encoding="utf-8", newline="")))
    assert {row["model_name"] for row in kept} == {
        "Gemini-2.5-Pro-Exp-03-25",
        "Gemini-2.5-Pro-Preview-03-25",
    }
    exp_rows = [row for row in kept if row["model_name"] == "Gemini-2.5-Pro-Exp-03-25"]
    assert [float(row["prediction"]) for row in exp_rows] == [0.2, 0.3]
    assert {row["exact_model_name"] for row in exp_rows} == {
        "Gemini-2.5-Pro-Exp-03-25 (zero shot)"
    }
    assert audit["input_exact_model_names"] == 3
    assert audit["output_model_versions"] == 2
    assert audit["removed_configuration_variants"] == 1
    assert json.loads(audit_path.read_text(encoding="utf-8")) == audit
