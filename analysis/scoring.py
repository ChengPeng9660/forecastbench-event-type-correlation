"""Build the official-fixed-effect scored panel used by the topic analysis.

The module is intentionally dependency-free.  It reads ForecastBench processed
forecast JSON files, keeps clean LLM configurations, and emits one row per exact
model name and official target key.  Duplicate target rows are collapsed only
when their scored contents are identical; conflicting duplicates fail loudly.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping


EPS = 1e-6
MARKET_SOURCES = {"polymarket", "manifold", "metaculus", "infer"}
BASELINE_MODELS = {
    "Always 0",
    "Always 0.5",
    "Always 1",
    "Imputed Forecaster",
    "Naive Forecaster",
    "Random Uniform",
}

OUTPUT_FIELDS = [
    "date",
    "source",
    "event_id",
    "horizon",
    "origin_type",
    "model_name",
    "model_organization",
    "source_file",
    "prediction",
    "outcome",
    "raw_brier",
    "question_fixed_effect",
    "normalization_term",
    "adjusted_brier",
]


def normalize_id(value: object) -> str:
    """Match ForecastBench's stable rendering of scalar and structured IDs."""

    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True, ensure_ascii=False)
    return str(value)


def canonical_date(value: object) -> str:
    """Return YYYY-MM-DD from a millisecond timestamp or ISO-like value."""

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%d"
        )
    text = str(value).strip()
    if text.replace(".", "", 1).isdigit() and len(text.split(".", 1)[0]) >= 12:
        return datetime.fromtimestamp(float(text) / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%d"
        )
    return datetime.fromisoformat(text[:10]).strftime("%Y-%m-%d")


def origin_for_source(source: str) -> str:
    return "Market" if source.strip().lower() in MARKET_SOURCES else "Dataset"


def clip_probability(value: object) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"non-finite forecast: {value!r}")
    return min(max(number, EPS), 1 - EPS)


def model_is_baseline(payload: Mapping[str, Any], path: Path) -> bool:
    model = str(payload.get("model", ""))
    if model in BASELINE_MODELS:
        return True
    return ".ForecastBench." in path.name and any(
        part in path.name for part in ("always-", "random-", "naive", "imputed")
    )


def model_is_clean_llm(payload: Mapping[str, Any], path: Path) -> bool:
    """Preserve the clean-LLM filter used by the audited predecessor scripts."""

    if model_is_baseline(payload, path) or ".external." in path.name:
        return False
    lowered = str(payload.get("model", "")).lower()
    excluded_fragments = (
        "ensemble",
        "crowdadj",
        "median forecast",
        "public median",
        "superforecaster",
    )
    return bool(lowered.strip()) and not any(x in lowered for x in excluded_fragments)


def path_is_definitely_non_clean(path: Path) -> bool:
    """Reject filename-identifiable non-LLM rows before opening large payloads.

    Some excluded external submissions are very large or backed by a local file
    provider. Reading them before applying the clean-LLM filter is unnecessary
    and can block an otherwise reproducible build.
    """

    lowered = path.name.lower()
    if ".external." in lowered:
        return True
    if ".forecastbench." in lowered and any(
        fragment in lowered for fragment in ("always-", "random-", "naive", "imputed")
    ):
        return True
    return any(
        fragment in lowered
        for fragment in ("ensemble", "crowdadj", "median_forecast", "public_median", "superforecaster")
    )


FixedEffectKey = tuple[str, str, str, float | None]


def load_fixed_effects(path: Path) -> dict[FixedEffectKey, float]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("fixed-effect JSON must contain a list of rows")
    result: dict[FixedEffectKey, float] = {}
    for row in payload:
        source = str(row["source"]).strip().lower()
        horizon = None if row.get("horizon") is None else float(row["horizon"])
        key = (
            canonical_date(row["forecast_due_date"]),
            source,
            normalize_id(row["id"]),
            horizon,
        )
        value = float(row["question_fixed_effect"])
        if key in result and not math.isclose(result[key], value, abs_tol=1e-15):
            raise ValueError(f"conflicting fixed effects for key {key!r}")
        result[key] = value
    return result


def compute_normalization_terms(
    fixed_effects: Mapping[FixedEffectKey, float],
) -> dict[tuple[str, str], float]:
    """Mean question FE by date and official Dataset/Market stratum."""

    grouped: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (date, source, _event_id, _horizon), value in fixed_effects.items():
        grouped[(date, origin_for_source(source))].append(float(value))
    return {key: sum(values) / len(values) for key, values in grouped.items()}


def score_forecast_row(
    row: Mapping[str, Any],
    fixed_effects: Mapping[FixedEffectKey, float],
    normalization_terms: Mapping[tuple[str, str], float],
) -> tuple[dict[str, Any] | None, str | None]:
    """Score one processed forecast row or return an auditable exclusion reason."""

    if row.get("forecast") is None:
        return None, "missing_forecast"
    if not bool(row.get("resolved")):
        return None, "unresolved"
    outcome_value = row.get("resolved_to")
    if outcome_value not in (0, 1, 0.0, 1.0):
        return None, "nonbinary_outcome"

    try:
        date = canonical_date(row["forecast_due_date"])
        source = str(row["source"]).strip().lower()
        event_id = normalize_id(row["id"])
        origin = origin_for_source(source)
        if origin == "Market":
            horizon = None
        else:
            resolution_date = datetime.fromisoformat(str(row["resolution_date"])[:10])
            due_date = datetime.fromisoformat(date)
            horizon = float((resolution_date - due_date).days)
        key = (date, source, event_id, horizon)
        question_fe = fixed_effects.get(key)
        if question_fe is None:
            return None, "missing_official_fixed_effect"
        normalization = normalization_terms.get((date, origin))
        if normalization is None:
            return None, "missing_normalization_term"
        prediction = clip_probability(row["forecast"])
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        return None, f"invalid_row:{type(exc).__name__}"

    outcome = float(outcome_value)
    raw_brier = (prediction - outcome) ** 2
    adjusted_brier = raw_brier - float(question_fe) + float(normalization)
    return {
        "date": date,
        "source": source,
        "event_id": event_id,
        "horizon": "" if horizon is None else horizon,
        "origin_type": origin,
        "prediction": prediction,
        "outcome": outcome,
        "raw_brier": raw_brier,
        "question_fixed_effect": float(question_fe),
        "normalization_term": float(normalization),
        "adjusted_brier": adjusted_brier,
    }, None


def _scored_signature(row: Mapping[str, Any]) -> tuple[Any, ...]:
    return tuple(row[field] for field in OUTPUT_FIELDS if field != "source_file")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_scored_panel(
    processed_root: Path,
    fixed_effects_path: Path,
    output_csv: Path,
    audit_json: Path | None = None,
    dates: set[str] | None = None,
    max_file_read_errors: int = 0,
) -> dict[str, Any]:
    if max_file_read_errors < 0:
        raise ValueError("max_file_read_errors cannot be negative")
    fixed_effects = load_fixed_effects(fixed_effects_path)
    normalization_terms = compute_normalization_terms(fixed_effects)
    scorable_dates = {key[0] for key in fixed_effects}
    if dates is not None:
        scorable_dates &= dates

    counters: Counter[str] = Counter()
    model_organizations: dict[str, str] = {}
    observed_dates: set[str] = set()
    observed_models: set[str] = set()
    input_files = 0
    file_read_errors: list[dict[str, str]] = []

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", encoding="utf-8", newline="") as output_handle:
        writer = csv.DictWriter(output_handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()

        date_dirs = sorted(path for path in processed_root.iterdir() if path.is_dir())
        for date_dir in date_dirs:
            if date_dir.name not in scorable_dates:
                continue
            # A date-local index catches duplicate model/target rows without holding
            # the entire multi-date panel in memory.
            date_rows: dict[tuple[str, str, str, str], dict[str, Any]] = {}
            date_sources: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
            for path in sorted(date_dir.glob("*.json")):
                input_files += 1
                if path_is_definitely_non_clean(path):
                    counters["excluded_non_clean_model_file"] += 1
                    counters["excluded_non_clean_before_read"] += 1
                    continue
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                except Exception as exc:  # retained in the audit rather than hidden
                    counters[f"file_read_error:{type(exc).__name__}"] += 1
                    file_read_errors.append(
                        {
                            "date": date_dir.name,
                            "file": path.name,
                            "error_type": type(exc).__name__,
                            "error": str(exc),
                        }
                    )
                    if len(file_read_errors) > max_file_read_errors:
                        raise RuntimeError(
                            "clean-candidate forecast file read errors exceeded "
                            f"the allowed maximum {max_file_read_errors}: {path} "
                            f"({type(exc).__name__}: {exc})"
                        ) from exc
                    continue
                if not model_is_clean_llm(payload, path):
                    counters["excluded_non_clean_model_file"] += 1
                    continue
                model_name = str(payload.get("model", "")).strip()
                organization = str(payload.get("model_organization", "")).strip()
                known_org = model_organizations.setdefault(model_name, organization)
                if known_org and organization and known_org != organization:
                    raise ValueError(
                        f"model {model_name!r} has conflicting organizations: "
                        f"{known_org!r} vs {organization!r}"
                    )
                if not known_org and organization:
                    model_organizations[model_name] = organization
                    known_org = organization
                observed_models.add(model_name)
                for raw_row in payload.get("forecasts", []):
                    counters["input_forecast_rows"] += 1
                    scored, reason = score_forecast_row(
                        raw_row, fixed_effects, normalization_terms
                    )
                    if scored is None:
                        counters[f"excluded:{reason}"] += 1
                        continue
                    scored.update(
                        {
                            "model_name": model_name,
                            "model_organization": organization or known_org,
                            "source_file": path.name,
                        }
                    )
                    row_key = (
                        model_name,
                        str(scored["source"]),
                        str(scored["event_id"]),
                        str(scored["horizon"]),
                    )
                    prior = date_rows.get(row_key)
                    if prior is not None:
                        if _scored_signature(prior) != _scored_signature(scored):
                            raise ValueError(
                                "conflicting duplicate model-target row for "
                                f"date={date_dir.name}, key={row_key!r}"
                            )
                        counters["collapsed_identical_duplicate_rows"] += 1
                        date_sources[row_key].add(path.name)
                        continue
                    date_rows[row_key] = scored
                    date_sources[row_key].add(path.name)

            for row_key in sorted(date_rows):
                row = date_rows[row_key]
                row["source_file"] = ";".join(sorted(date_sources[row_key]))
                writer.writerow(row)
                counters["output_scored_rows"] += 1
                observed_dates.add(str(row["date"]))

    audit = {
        "schema_version": 1,
        "fixed_effects_file": fixed_effects_path.name,
        "fixed_effects_sha256": _sha256(fixed_effects_path),
        "fixed_effect_keys": len(fixed_effects),
        "processed_root_name": processed_root.name,
        "input_json_files_considered": input_files,
        "n_dates": len(observed_dates),
        "date_min": min(observed_dates) if observed_dates else None,
        "date_max": max(observed_dates) if observed_dates else None,
        "n_exact_model_names": len(observed_models),
        "max_file_read_errors": max_file_read_errors,
        "file_read_errors": file_read_errors,
        "counters": dict(sorted(counters.items())),
    }
    if audit_json is not None:
        audit_json.parent.mkdir(parents=True, exist_ok=True)
        audit_json.write_text(
            json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    return audit


def _parse_dates(values: Iterable[str] | None) -> set[str] | None:
    if not values:
        return None
    return {canonical_date(value) for value in values}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-root", required=True, type=Path)
    parser.add_argument("--fixed-effects", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--audit-output", type=Path)
    parser.add_argument("--dates", nargs="*")
    parser.add_argument(
        "--max-file-read-errors",
        type=int,
        default=0,
        help="Fatal bound for clean-candidate JSON read/parse errors (default: 0).",
    )
    args = parser.parse_args()
    audit = build_scored_panel(
        processed_root=args.processed_root,
        fixed_effects_path=args.fixed_effects,
        output_csv=args.output,
        audit_json=args.audit_output,
        dates=_parse_dates(args.dates),
        max_file_read_errors=args.max_file_read_errors,
    )
    print(json.dumps(audit, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
