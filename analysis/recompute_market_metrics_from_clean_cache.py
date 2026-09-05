"""Recompute the Markets overview from its audited clean probability cache.

The cache fixes the exact configuration identities, target support, model
probabilities, outcomes, and matched freeze-time market probabilities.  This
command changes only the score definition: Brier scores give every event equal
mass, and BI is transformed once from that event-averaged Brier score.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
from datetime import date
from pathlib import Path

from analysis.event_weighted_scoring import brier_index, event_count, event_weighted_mean
from analysis.pair_aggregation import KEY, sha256_file


def _score(rows: list[dict[str, str]], prediction_field: str) -> dict[str, float]:
    keys = [tuple(row[field] for field in KEY) for row in rows]
    raw_losses = [
        (float(row[prediction_field]) - float(row["outcome"])) ** 2 for row in rows
    ]
    offsets = [
        float(row["normalization_term"]) - float(row["question_fixed_effect"])
        for row in rows
    ]
    raw = event_weighted_mean(keys, raw_losses)
    adjusted = raw + event_weighted_mean(keys, offsets)
    return {"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": brier_index(raw)}


def recompute(catalog_path: Path, clean_path: Path) -> dict:
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    prior_audit = json.loads((clean_path.parent / "audit.json").read_text(encoding="utf-8"))
    clean_hash = sha256_file(clean_path)
    if clean_hash != prior_audit["clean_intermediate_sha256"]:
        raise ValueError("clean cache SHA-256 differs from its recorded audit")

    rows_by_name: dict[str, list[dict[str, str]]] = {}
    with gzip.open(clean_path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            rows_by_name.setdefault(row["exact_configuration"], []).append(row)
    points_by_name = {point["exact_configuration"]: point for point in payload["points"]}
    if set(points_by_name) != set(rows_by_name):
        raise ValueError("catalog and clean cache contain different exact configurations")

    for name, point in points_by_name.items():
        rows = rows_by_name[name]
        if len(rows) != point["n_common"]:
            raise ValueError(f"catalog support changed for {name}")
        keys = [tuple(row[field] for field in KEY) for row in rows]
        point["n_events"] = event_count(keys)
        point["model"] = _score(rows, "prediction")
        point["matched_market"] = _score(rows, "market_prediction")

    payload["schema_version"] = "2.0.0"
    payload["generated_at"] = date.today().isoformat()
    payload["outcomes"]["raw_brier"] = {
        "label": "Brier Score",
        "axis": "Brier Score (lower is better)",
        "higher_is_better": False,
        "formula": "mean over events of the within-event mean squared probability error",
        "weighting": "equal events; equal targets within each event",
    }
    payload["outcomes"]["brier_index"] = {
        "label": "Brier Index",
        "axis": "Brier Index (higher is better)",
        "higher_is_better": True,
        "formula": "100 × (1 - sqrt(event-averaged Brier Score))",
        "weighting": "transform once after event averaging",
    }
    payload["audit"].update(
        model_unique_event_cells=sum(point["n_events"] for point in payload["points"]),
        brier_score_weighting="equal events; equal targets within event",
        brier_index_uses_ordinary_brier_score=True,
        brier_index_transformed_after_event_averaging=True,
        scoring_cache_rows=sum(map(len, rows_by_name.values())),
    )
    payload["provenance"].update(
        scoring_cache=str(clean_path),
        scoring_cache_sha256=clean_hash,
        score_recompute_producer="analysis/recompute_market_metrics_from_clean_cache.py",
        score_recompute_producer_sha256=sha256_file(Path(__file__)),
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("site/public/data/polymarket-aggregation/market-diversity-performance.json"))
    parser.add_argument("--clean", type=Path, default=Path("data/derived/configuration_pair_aggregation/clean_panel.csv.gz"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = recompute(args.catalog, args.clean)
    output = args.output or args.catalog
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "configurations": len(payload["points"]),
        "configuration_target_rows": payload["audit"]["scoring_cache_rows"],
        "configuration_event_cells": payload["audit"]["model_unique_event_cells"],
    }, indent=2))


if __name__ == "__main__":
    main()
