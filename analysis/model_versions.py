"""Collapse ForecastBench prompt/configuration variants to one model version.

The raw scored panel is preserved.  This module selects one real forecast
configuration per version using an outcome-blind, pre-declared preference:
plain zero shot first, then the least augmented zero-shot configuration.  It
never averages forecasts and never removes release/date/Preview/Exp tokens.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


CONFIGURATION_SUFFIX = re.compile(
    r"\s+\((?P<configuration>(?:scratchpad|zero shot)[^()]*)\)\s*$",
    re.IGNORECASE,
)
PROVENANCE_FIELDS = ["exact_model_name", "model_configuration"]
MAPPING_FIELDS = [
    "canonical_model_version",
    "exact_model_name",
    "model_organization",
    "model_configuration",
    "selected",
    "selection_rank",
    "selection_reason",
    "n_scored_rows",
    "n_dates",
    "date_min",
    "date_max",
]


@dataclass
class ModelStats:
    exact_name: str
    canonical_version: str
    organization: str
    configuration: str
    n_scored_rows: int = 0
    dates: set[str] = field(default_factory=set)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_model_version(model_name: str) -> tuple[str, str]:
    """Return the exact version token and its removable run configuration."""

    value = model_name.strip()
    match = CONFIGURATION_SUFFIX.search(value)
    if match is None:
        return value, ""
    canonical = value[: match.start()].strip()
    if not canonical:
        raise ValueError(f"model name contains only a configuration: {model_name!r}")
    return canonical, match.group("configuration").strip()


def configuration_preference(configuration: str) -> tuple[int, int, str]:
    """Outcome-blind ordering for the representative of one model version."""

    normalized = " ".join(configuration.casefold().split())
    if not normalized:
        return (0, 0, normalized)
    if normalized == "zero shot":
        return (1, 0, normalized)
    if normalized.startswith("zero shot"):
        modifiers = normalized.removeprefix("zero shot").strip().split()
        return (2, len(modifiers), normalized)
    if normalized == "scratchpad":
        return (3, 0, normalized)
    if normalized.startswith("scratchpad"):
        modifiers = normalized.removeprefix("scratchpad").strip().split()
        return (4, len(modifiers), normalized)
    return (5, len(normalized.split()), normalized)


def _read_stats(input_csv: Path) -> tuple[list[str], dict[str, ModelStats]]:
    stats: dict[str, ModelStats] = {}
    with input_csv.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        required = {"date", "model_name", "model_organization"}
        missing = required - set(fields)
        if missing:
            raise ValueError(f"scored panel missing columns: {sorted(missing)}")
        for row in reader:
            exact_name = row["model_name"].strip()
            canonical, configuration = split_model_version(exact_name)
            organization = row["model_organization"].strip()
            state = stats.get(exact_name)
            if state is None:
                state = ModelStats(
                    exact_name=exact_name,
                    canonical_version=canonical,
                    organization=organization,
                    configuration=configuration,
                )
                stats[exact_name] = state
            if state.canonical_version != canonical or state.configuration != configuration:
                raise ValueError(f"unstable model parsing for {exact_name!r}")
            if state.organization and organization and state.organization != organization:
                raise ValueError(
                    f"model {exact_name!r} has conflicting organizations: "
                    f"{state.organization!r} vs {organization!r}"
                )
            if not state.organization and organization:
                state.organization = organization
            state.n_scored_rows += 1
            state.dates.add(row["date"][:10])
    return fields, stats


def _select_representatives(
    stats: Iterable[ModelStats],
) -> tuple[dict[str, ModelStats], list[dict[str, Any]]]:
    groups: dict[str, list[ModelStats]] = {}
    for state in stats:
        groups.setdefault(state.canonical_version, []).append(state)

    selected: dict[str, ModelStats] = {}
    mapping: list[dict[str, Any]] = []
    for canonical, candidates in sorted(groups.items()):
        organizations = {state.organization for state in candidates if state.organization}
        if len(organizations) > 1:
            raise ValueError(
                f"canonical version {canonical!r} spans organizations: {sorted(organizations)}"
            )
        ordered = sorted(
            candidates,
            key=lambda state: (
                configuration_preference(state.configuration),
                -state.n_scored_rows,
                state.exact_name.casefold(),
                state.exact_name,
            ),
        )
        representative = ordered[0]
        selected[representative.exact_name] = representative
        for rank, state in enumerate(ordered, start=1):
            is_selected = state.exact_name == representative.exact_name
            mapping.append(
                {
                    "canonical_model_version": canonical,
                    "exact_model_name": state.exact_name,
                    "model_organization": state.organization,
                    "model_configuration": state.configuration,
                    "selected": int(is_selected),
                    "selection_rank": rank,
                    "selection_reason": (
                        "preferred_outcome_blind_zero_shot_configuration"
                        if is_selected and state.configuration
                        else "only_available_configuration"
                        if is_selected
                        else "same_model_version_nonrepresentative_configuration"
                    ),
                    "n_scored_rows": state.n_scored_rows,
                    "n_dates": len(state.dates),
                    "date_min": min(state.dates) if state.dates else "",
                    "date_max": max(state.dates) if state.dates else "",
                }
            )
    return selected, mapping


def build_model_version_panel(
    input_csv: Path,
    output_csv: Path,
    mapping_csv: Path,
    audit_json: Path,
) -> dict[str, Any]:
    input_fields, stats = _read_stats(input_csv)
    selected, mapping = _select_representatives(stats.values())
    output_fields = [*input_fields, *[field for field in PROVENANCE_FIELDS if field not in input_fields]]

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    output_rows = 0
    output_targets: set[tuple[str, str, str, str, str]] = set()
    with input_csv.open(encoding="utf-8", newline="") as input_handle, output_csv.open(
        "w", encoding="utf-8", newline=""
    ) as output_handle:
        reader = csv.DictReader(input_handle)
        writer = csv.DictWriter(output_handle, fieldnames=output_fields, lineterminator="\n")
        writer.writeheader()
        for row in reader:
            exact_name = row["model_name"].strip()
            representative = selected.get(exact_name)
            if representative is None:
                continue
            row["exact_model_name"] = exact_name
            row["model_configuration"] = representative.configuration
            row["model_name"] = representative.canonical_version
            target_key = (
                row["date"][:10], row["source"], row["event_id"], row["horizon"], row["model_name"]
            )
            if target_key in output_targets:
                raise ValueError(f"duplicate canonical model-target row: {target_key!r}")
            output_targets.add(target_key)
            writer.writerow(row)
            output_rows += 1

    mapping_csv.parent.mkdir(parents=True, exist_ok=True)
    with mapping_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=MAPPING_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(mapping)

    group_sizes = Counter(row["canonical_model_version"] for row in mapping)
    configuration_counts = Counter(
        row["model_configuration"] or "no_configuration_suffix" for row in mapping
    )
    selected_configuration_counts = Counter(
        row["model_configuration"] or "no_configuration_suffix"
        for row in mapping
        if row["selected"]
    )
    audit = {
        "schema_version": 1,
        "selection_rule": (
            "one actual forecast configuration per exact model version; prefer plain zero shot, "
            "then least-augmented zero shot; never use outcomes or average configurations"
        ),
        "version_boundary": (
            "remove only recognized trailing scratchpad/zero-shot configuration parentheses; "
            "retain dates, Preview, Exp, reasoning, size, and all other version tokens"
        ),
        "input_file": input_csv.name,
        "input_sha256": sha256_file(input_csv),
        "output_file": output_csv.name,
        "output_sha256": sha256_file(output_csv),
        "mapping_file": mapping_csv.name,
        "mapping_sha256": sha256_file(mapping_csv),
        "input_exact_model_names": len(stats),
        "output_model_versions": len(group_sizes),
        "multi_configuration_versions": sum(size > 1 for size in group_sizes.values()),
        "removed_configuration_variants": len(stats) - len(group_sizes),
        "input_scored_rows": sum(state.n_scored_rows for state in stats.values()),
        "output_scored_rows": output_rows,
        "group_size_counts": {
            str(size): count
            for size, count in sorted(Counter(group_sizes.values()).items())
        },
        "configuration_counts": dict(sorted(configuration_counts.items())),
        "selected_configuration_counts": dict(sorted(selected_configuration_counts.items())),
    }
    audit_json.parent.mkdir(parents=True, exist_ok=True)
    audit_json.write_text(
        json.dumps(audit, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mapping-output", required=True, type=Path)
    parser.add_argument("--audit-output", required=True, type=Path)
    args = parser.parse_args()
    audit = build_model_version_panel(
        input_csv=args.input,
        output_csv=args.output,
        mapping_csv=args.mapping_output,
        audit_json=args.audit_output,
    )
    print(json.dumps(audit, indent=2, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
