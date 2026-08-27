"""Shared row-level cleaning for ForecastBench Polymarket experiments."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Mapping

from analysis.scoring import normalize_id


def exclude_imputed_polymarket_rows(
    panel: Mapping[str, Mapping[tuple[str, ...], Mapping[str, str]]],
    processed_root: Path,
) -> tuple[dict[str, dict[tuple[str, ...], dict[str, str]]], dict[str, Any]]:
    """Remove scored Polymarket rows backed only by imputed raw forecasts.

    The released scored panel predates row-level preservation of ForecastBench's
    ``imputed`` flag. The original processed JSON referenced by ``source_file``
    is therefore the authority. A collapsed duplicate is retained if at least
    one backing source contains a genuine forecast and is excluded only when
    every matched source forecast is imputed.
    """

    requested: dict[tuple[str, str], set[tuple[str, ...]]] = defaultdict(set)
    candidate_rows = 0
    for rows in panel.values():
        for key, row in rows.items():
            if key[1].casefold() != "polymarket":
                continue
            candidate_rows += 1
            source_files = [part for part in row.get("source_file", "").split(";") if part]
            if not source_files:
                raise ValueError(f"missing source_file for Polymarket row {key}")
            for source_file in source_files:
                requested[(key[0], source_file)].add(key)

    genuine_sources: set[tuple[str, str, tuple[str, ...]]] = set()
    imputed_sources: set[tuple[str, str, tuple[str, ...]]] = set()
    raw_polymarket_rows = 0
    for (date, source_file), target_keys in sorted(requested.items()):
        source_path = processed_root / date / source_file
        if not source_path.is_file():
            raise FileNotFoundError(f"processed ForecastBench source is missing: {source_path}")
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        for raw_row in payload.get("forecasts", []):
            if str(raw_row.get("source", "")).strip().casefold() != "polymarket":
                continue
            key = (date, "polymarket", normalize_id(raw_row.get("id")), "")
            if key not in target_keys:
                continue
            raw_polymarket_rows += 1
            marker = (date, source_file, key)
            if bool(raw_row.get("imputed")):
                imputed_sources.add(marker)
            else:
                genuine_sources.add(marker)

    filtered: dict[str, dict[tuple[str, ...], dict[str, str]]] = {}
    excluded_by_model: Counter[str] = Counter()
    retained_backed_by_genuine = 0
    for name, rows in panel.items():
        kept: dict[tuple[str, ...], dict[str, str]] = {}
        for key, row in rows.items():
            if key[1].casefold() != "polymarket":
                kept[key] = dict(row)
                continue
            source_files = [part for part in row["source_file"].split(";") if part]
            markers = [(key[0], source_file, key) for source_file in source_files]
            if any(marker in genuine_sources for marker in markers):
                kept[key] = dict(row)
                retained_backed_by_genuine += 1
                continue
            if any(marker in imputed_sources for marker in markers):
                excluded_by_model[name] += 1
                continue
            raise ValueError(
                "failed to recover ForecastBench imputed status for "
                f"model={name!r}, key={key!r}, source_files={source_files!r}"
            )
        filtered[name] = kept

    excluded = sum(excluded_by_model.values())
    return filtered, {
        "policy": (
            "exclude a scored Polymarket row only when every matched original "
            "ForecastBench source forecast has imputed=true"
        ),
        "candidate_scored_polymarket_rows": candidate_rows,
        "retained_non_imputed_rows": retained_backed_by_genuine,
        "excluded_imputed_rows": excluded,
        "excluded_imputed_share": excluded / candidate_rows if candidate_rows else 0.0,
        "processed_source_files_read": len(requested),
        "matched_raw_polymarket_rows": raw_polymarket_rows,
        "excluded_by_model": dict(sorted(excluded_by_model.items())),
    }
