"""Export validated pair metrics to compact GitHub Pages artifacts.

The exporter never publishes raw forecasts or local absolute paths. It emits
only model metadata, pair-level derived metrics, aggregate taxonomy counts,
and reproducibility audits. Full and eligible pair tables are gzip-compressed
with a fixed timestamp so identical inputs produce byte-identical archives.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping


TOPIC_META: dict[str, dict[str, Any]] = {
    "finance_economics": {
        "label_zh": "金融与经济",
        "label_en": "Finance & Economics",
        "definition": "Macroeconomics, interest rates, exchange rates, equities, crypto assets, and financial markets.",
    },
    "politics_conflict": {
        "label_zh": "政治与冲突",
        "label_en": "Politics & Conflict",
        "definition": "Elections, public policy, diplomacy, war, armed conflict, and geopolitics.",
    },
    "climate_weather": {
        "label_zh": "气候与天气",
        "label_en": "Climate & Weather",
        "definition": "Temperature, precipitation, weather indicators, and climate-related questions.",
    },
    "health_science": {
        "label_zh": "健康与科学",
        "label_en": "Health & Science",
        "definition": "Disease, vaccines, biomedicine, clinical research, and general science.",
    },
    "technology_ai": {
        "label_zh": "科技与 AI",
        "label_en": "Technology & AI",
        "definition": "Artificial intelligence, models, technology companies, semiconductors, cybersecurity, and product launches.",
    },
    "sports": {
        "label_zh": "体育",
        "label_en": "Sports",
        "definition": "Sporting events, rankings, records, athletes, and competition outcomes.",
    },
    "entertainment_culture": {
        "label_zh": "娱乐与文化",
        "label_en": "Entertainment & Culture",
        "definition": "Film, television, music, publishing, gaming, awards, and cultural events.",
    },
    "other": {
        "label_zh": "其他 / 待审计",
        "label_en": "Other / Review",
        "definition": "Questions that cannot be reliably assigned to one topic, have unrecoverable text, or require manual review.",
    },
}

TOPIC_ORDER = tuple(topic for topic in TOPIC_META if topic != "other")
TAXONOMY_TOPIC_ORDER = tuple(TOPIC_META)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    kwargs = {"ensure_ascii": False, "sort_keys": True}
    if compact:
        text = json.dumps(payload, separators=(",", ":"), **kwargs)
    else:
        text = json.dumps(payload, indent=2, **kwargs)
    path.write_text(text + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_model_id(name: str) -> str:
    return "m-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:12]


def stable_row_id(dimension: str, slice_id: str, model_a: str, model_b: str) -> str:
    payload = "\x1f".join((dimension, slice_id, model_a, model_b))
    return "p-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def as_float(value: object) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    number = float(text)
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError(f"non-finite numeric output: {value!r}")
    return number


def as_bool(value: object) -> bool | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in {"1", "true", "yes"}:
        return True
    if text in {"0", "false", "no"}:
        return False
    raise ValueError(f"invalid boolean value: {value!r}")


def public_slice_id(dimension: str, slice_id: str) -> str:
    if dimension == "topic":
        return slice_id
    normalized = "".join(character if character.isalnum() else "_" for character in slice_id.lower())
    return f"{dimension}_{normalized}".strip("_")


def slice_reference(dimension: str, slice_id: str) -> dict[str, str]:
    public_id = public_slice_id(dimension, slice_id)
    if dimension == "topic":
        meta = TOPIC_META[slice_id]
        label_zh, label_en = meta["label_zh"], meta["label_en"]
    elif dimension == "origin_type":
        labels = {
            "Dataset": ("官方：Dataset", "Official: Dataset"),
            "Market": ("官方：Market", "Official: Market"),
        }
        label_zh, label_en = labels[slice_id]
    elif dimension == "official_source":
        label_zh, label_en = f"来源：{slice_id}", f"Source: {slice_id}"
    else:
        raise ValueError(f"unsupported slice dimension: {dimension!r}")
    return {
        "id": public_id,
        "label_zh": label_zh,
        "label_en": label_en,
        "dimension": dimension,
        "file": f"event-types/{public_id}.json",
    }


def provider_for(name: str, organization: str) -> str:
    normalized = organization.strip()
    if normalized:
        aliases = {
            "openai": "OpenAI",
            "anthropic": "Anthropic",
            "google": "Google",
            "xai": "xAI",
            "meta": "Meta",
            "mistral": "Mistral",
        }
        return aliases.get(normalized.lower(), normalized)
    lowered = name.lower()
    patterns = (
        (("gpt", "o1", "o3", "o4", "chatgpt"), "OpenAI"),
        (("claude",), "Anthropic"),
        (("gemini",), "Google"),
        (("grok",), "xAI"),
        (("llama",), "Meta"),
        (("mistral", "ministral", "magistral"), "Mistral"),
        (("qwen",), "Alibaba"),
        (("deepseek",), "DeepSeek"),
    )
    for needles, provider in patterns:
        if any(needle in lowered for needle in needles):
            return provider
    return "Other"


def gzip_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as input_handle, destination.open("wb") as raw_output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_output, mtime=0) as output_handle:
            shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)


def load_taxonomy_rows(path: Path) -> tuple[
    dict[tuple[str, str, str], dict[str, str]],
    dict[str, Counter[str]],
    Counter[str],
    Counter[str],
]:
    mapping: dict[tuple[str, str, str], dict[str, str]] = {}
    topic_confidence: dict[str, Counter[str]] = defaultdict(Counter)
    origin_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "date", "source", "event_id", "topic_id", "origin_type",
            "official_source", "topic_status", "topic_confidence",
            "topic_analysis_eligible", "review_required",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"taxonomy CSV missing columns: {sorted(missing)}")
        for row in reader:
            key = (row["date"][:10], row["source"].strip().lower(), row["event_id"])
            if key in mapping:
                raise ValueError(f"duplicate taxonomy key: {key!r}")
            mapping[key] = row
            topic = row["topic_id"]
            topic_confidence[topic][row["topic_confidence"] or "unknown"] += 1
            origin_counts[row["origin_type"]] += 1
            source_counts[row["official_source"]] += 1
    return mapping, topic_confidence, origin_counts, source_counts


def scan_scored_panel(
    path: Path,
    taxonomy: Mapping[tuple[str, str, str], Mapping[str, str]],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], Counter[str]]:
    models: dict[str, dict[str, Any]] = {}
    slices: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "target_keys": set(), "event_date_keys": set(), "event_keys": set(),
            "dates": set(), "models": set(),
        }
    )
    audit: Counter[str] = Counter()
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            audit["scored_rows"] += 1
            key = (row["date"][:10], row["source"].lower(), row["event_id"])
            meta = taxonomy.get(key)
            if meta is None:
                audit["scored_rows_missing_taxonomy"] += 1
                continue
            target = (*key, row["horizon"])
            model_name = row["model_name"]
            row_slices = [
                ("origin_type", meta["origin_type"]),
                ("official_source", meta["official_source"]),
            ]
            if as_bool(meta["topic_analysis_eligible"]):
                row_slices.insert(0, ("topic", meta["topic_id"]))
            for slice_key in row_slices:
                slice_state = slices[slice_key]
                slice_state["target_keys"].add(target)
                slice_state["event_date_keys"].add(key)
                slice_state["event_keys"].add((key[1], key[2]))
                slice_state["dates"].add(key[0])
                slice_state["models"].add(model_name)
            model = models.setdefault(
                model_name,
                {
                    "organization": row.get("model_organization", ""),
                    "targets": set(),
                    "dates": set(),
                    "first_date": key[0],
                },
            )
            model["targets"].add(target)
            model["dates"].add(key[0])
            model["first_date"] = min(model["first_date"], key[0])
            audit["joined_scored_rows"] += 1
    return models, slices, audit


def copy_pair_archives(
    pair_csv: Path,
    derived_dir: Path,
) -> tuple[Path, Path, int, Counter[str]]:
    full_gzip = derived_dir / "pair_metrics_all.csv.gz"
    eligible_csv = derived_dir / "pair_metrics_eligible.csv"
    eligible_gzip = derived_dir / "pair_metrics_eligible.csv.gz"
    gzip_copy(pair_csv, full_gzip)
    status_counts: Counter[str] = Counter()
    eligible_rows = 0
    with pair_csv.open(encoding="utf-8", newline="") as input_handle:
        reader = csv.DictReader(input_handle)
        with eligible_csv.open("w", encoding="utf-8", newline="") as output_handle:
            writer = csv.DictWriter(output_handle, fieldnames=reader.fieldnames)
            writer.writeheader()
            for row in reader:
                status_counts[row["metric_status"]] += 1
                if as_bool(row["eligible"]):
                    writer.writerow(row)
                    eligible_rows += 1
    gzip_copy(eligible_csv, eligible_gzip)
    eligible_csv.unlink()
    return full_gzip, eligible_gzip, eligible_rows, status_counts


def build_site_artifacts(
    *,
    pair_csv: Path,
    taxonomy_csv: Path,
    taxonomy_summary_json: Path,
    scored_panel: Path,
    scoring_audit_json: Path,
    model_version_audit_json: Path,
    model_version_mapping_csv: Path,
    metrics_audit_json: Path,
    site_data_dir: Path,
    derived_dir: Path,
    analysis_commit: str,
    built_at: str,
) -> dict[str, Any]:
    taxonomy_summary = read_json(taxonomy_summary_json)
    scoring_audit = read_json(scoring_audit_json)
    model_version_audit = read_json(model_version_audit_json)
    metrics_audit = read_json(metrics_audit_json)
    if scoring_audit.get("file_read_errors"):
        raise ValueError("refusing to publish a scoring build with forecast file read errors")
    if metrics_audit.get("unclassified_unique_targets", 0) > 4:
        raise ValueError("refusing to publish more than four unclassified official targets")
    taxonomy, confidence_by_topic, origin_counts, source_counts = load_taxonomy_rows(taxonomy_csv)
    models_state, slice_state, scored_scan = scan_scored_panel(scored_panel, taxonomy)

    site_data_dir.mkdir(parents=True, exist_ok=True)
    event_dir = site_data_dir / "event-types"
    event_dir.mkdir(parents=True, exist_ok=True)
    for stale_slice in event_dir.glob("*.json"):
        stale_slice.unlink()
    derived_dir.mkdir(parents=True, exist_ok=True)

    all_models = sorted(models_state)
    organizations: dict[str, str] = {}
    # Pair output is authoritative for organization after cross-date checks.
    pair_rows_by_slice: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    missing_reason_counts: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    with pair_csv.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            organizations.setdefault(row["model_a"], row.get("organization_a", ""))
            organizations.setdefault(row["model_b"], row.get("organization_b", ""))
            dimension = row["slice_dimension"]
            slice_id = row["slice_id"]
            slice_key = (dimension, slice_id)
            if not as_bool(row["eligible"]):
                missing_reason_counts[slice_key][row["insufficient_overlap_reason"]] += 1
                continue
            model_a = row["model_a"]
            model_b = row["model_b"]
            if model_a >= model_b:
                raise ValueError(f"pair output is not canonically ordered: {model_a!r}, {model_b!r}")
            pair_rows_by_slice[slice_key].append(
                {
                    "a": stable_model_id(model_a),
                    "b": stable_model_id(model_b),
                    "n_overlap": int(row["n_overlap"]),
                    "n_dates": int(row["n_dates"]),
                    "metrics": {
                        "adjusted_pog": {"value": as_float(row["adjusted_pog"]), "se": None, "ci95": None, "reason": row["pog_reason"] or None},
                        "high_loss_lift": {"value": as_float(row["adjusted_high_loss_lift_025"]), "se": None, "ci95": None, "reason": row["lift_reason"] or None},
                        "adjusted_loss_corr": {"value": as_float(row["adjusted_loss_pearson_corr"]), "se": None, "ci95": None, "reason": row["corr_reason"] or None},
                    },
                    "diagnostics": {
                        "mean_bi_gap": as_float(row["bi_gap_common"]),
                        "near_bi": as_bool(row["near_bi"]),
                        "high_loss_rate_a": as_float(row.get("high_loss_rate_a_025")),
                        "high_loss_rate_b": as_float(row.get("high_loss_rate_b_025")),
                        "joint_high_loss_rate": as_float(row.get("joint_high_loss_rate_025")),
                        "joint_high_loss_count": as_float(row.get("joint_high_loss_count_025")),
                    },
                    "row_id": stable_row_id(dimension, slice_id, model_a, model_b),
                }
            )

    provider_rank = {"OpenAI": 0, "Anthropic": 1}
    ordered_models = sorted(
        all_models,
        key=lambda name: (
            provider_rank.get(provider_for(name, organizations.get(name, models_state[name]["organization"])), 2),
            models_state[name]["first_date"],
            name.casefold(),
        ),
    )
    model_payload = []
    for order, name in enumerate(ordered_models):
        state = models_state[name]
        provider = provider_for(name, organizations.get(name, state["organization"]))
        model_payload.append(
            {
                "id": stable_model_id(name),
                "name": name,
                "provider": provider,
                "family": provider,
                "release_order": order,
                "n_targets": len(state["targets"]),
                "n_dates": len(state["dates"]),
            }
        )
    write_json(site_data_dir / "models.json", model_payload)
    shutil.copyfile(model_version_mapping_csv, site_data_dir / "model-version-mapping.csv")

    event_refs = []
    ordered_slices: list[tuple[str, str]] = [
        *(("topic", topic) for topic in TOPIC_ORDER),
        ("origin_type", "Dataset"),
        ("origin_type", "Market"),
        *(("official_source", source) for source in sorted(source_counts)),
    ]
    for dimension, raw_slice_id in ordered_slices:
        slice_key = (dimension, raw_slice_id)
        state = slice_state.get(slice_key, {})
        pairs = sorted(pair_rows_by_slice.get(slice_key, []), key=lambda row: (row["a"], row["b"]))
        model_ids = sorted(stable_model_id(name) for name in state.get("models", set()))
        dates = sorted(state.get("dates", set()))
        reference = slice_reference(dimension, raw_slice_id)
        event_refs.append(reference)
        payload = {
            "schema_version": "1.0.0",
            "event_type": reference,
            "scope": {
                "origin_type": raw_slice_id if dimension == "origin_type" else "mixed",
                "source": raw_slice_id if dimension == "official_source" else "mixed",
                "near_bi": False,
                "slice_dimension": dimension,
            },
            "sample": {
                "n_unique_events": len(state.get("event_keys", set())),
                "n_event_dates": len(state.get("event_date_keys", set())),
                "n_official_targets": len(state.get("target_keys", set())),
                "date_min": dates[0] if dates else "",
                "date_max": dates[-1] if dates else "",
            },
            "models": model_ids,
            "pairs": pairs,
            "missing_cells": [],
            "missing_cells_enumerated": False,
            "missing_summary": [
                {"reason": reason, "count": count}
                for reason, count in sorted(missing_reason_counts[slice_key].items())
            ],
        }
        write_json(event_dir / f"{reference['id']}.json", payload, compact=True)

    taxonomy_categories = []
    for topic in TAXONOMY_TOPIC_ORDER:
        topic_rows = [row for row in taxonomy.values() if row["topic_id"] == topic]
        taxonomy_categories.append(
            {
                "id": topic,
                "label_zh": TOPIC_META[topic]["label_zh"],
                "label_en": TOPIC_META[topic]["label_en"],
                "level": "topic",
                "derived": True,
                "parent_id": None,
                "definition": TOPIC_META[topic]["definition"],
                "rules": sorted({row["topic_rule_id"] for row in topic_rows}),
                "n_event_dates": len(topic_rows),
                "n_unique_events": len({(row["source"], row["event_id"]) for row in topic_rows}),
                "confidence_counts": dict(sorted(confidence_by_topic[topic].items())),
            }
        )
    taxonomy_payload = {
        "categories": taxonomy_categories,
        "official_dimensions": {
            "origin_type": sorted(origin_counts),
            "sources": sorted(source_counts),
            "origin_counts": dict(sorted(origin_counts.items())),
            "source_counts": dict(sorted(source_counts.items())),
        },
    }
    write_json(site_data_dir / "taxonomy.json", taxonomy_payload)

    metric_definitions = [
        {
            "id": "adjusted_pog", "label": "Adjusted Pairwise Oracle Gain", "short_label": "Adjusted POG",
            "direction": "higher", "format": ".3f",
            "description": "Measures whether two models excel on different questions—the ex post complementarity available at the question level.",
        },
        {
            "id": "high_loss_lift", "label": "Adjusted High-loss Lift", "short_label": "High-loss lift",
            "direction": "lower", "format": ".2f", "reference": 1.0,
            "description": "Measures how often two models incur severe errors together; 1 indicates approximate independence.",
        },
        {
            "id": "adjusted_loss_corr", "label": "Adjusted-loss Correlation", "short_label": "Loss correlation",
            "direction": "lower", "format": ".3f", "domain": [-1.0, 1.0],
            "description": "Measures the Pearson correlation between the models’ question-level difficulty-adjusted Brier losses.",
        },
    ]
    analytic_target_keys = set()
    analytic_event_keys = set()
    for state in slice_state.values():
        analytic_target_keys.update(state["target_keys"])
        analytic_event_keys.update(state["event_keys"])
    manifest = {
        "schema_version": "1.0.0",
        "dataset_version": scoring_audit["fixed_effects_file"],
        "taxonomy_version": taxonomy_summary["taxonomy_version"],
        "metric_version": "three-adjusted-pair-metrics-v1",
        "model_definition": "exact_model_version_one_zero_shot_representative_v1",
        "built_at": built_at,
        "commit_sha": analysis_commit,
        "fixture": False,
        "source_snapshot": {
            "official_targets": len(analytic_target_keys),
            "unique_events": len(analytic_event_keys),
            "sha256": scoring_audit["fixed_effects_sha256"],
        },
        "event_types": event_refs,
        "metrics": metric_definitions,
    }
    write_json(site_data_dir / "manifest.json", manifest)

    full_gzip, eligible_gzip, eligible_rows, status_counts = copy_pair_archives(pair_csv, derived_dir)
    write_json(derived_dir / "taxonomy_summary.json", taxonomy_summary)
    shutil.copyfile(model_version_mapping_csv, derived_dir / "model_version_mapping.csv")
    write_json(derived_dir / "model_version_audit.json", model_version_audit)
    combined_audit = {
        "built_at": built_at,
        "analysis_commit": analysis_commit,
        "scoring": scoring_audit,
        "model_versions": model_version_audit,
        "taxonomy": taxonomy_summary,
        "metrics": metrics_audit,
        "export": {
            "eligible_pair_slice_rows": eligible_rows,
            "pair_metric_status_counts": dict(sorted(status_counts.items())),
            "scored_scan": dict(sorted(scored_scan.items())),
        },
    }
    write_json(derived_dir / "analysis_audit.json", combined_audit)

    classification = {
        "total_event_dates": taxonomy_summary["row_count"],
        "deterministic": taxonomy_summary["status_counts"].get("source_rule", 0),
        "keyword": sum(
            taxonomy_summary["status_counts"].get(key, 0)
            for key in ("keyword_rule", "keyword_conflict")
        ),
        "manual": taxonomy_summary["status_counts"].get("manual_override", 0),
        "unresolved": sum(
            not as_bool(row["topic_analysis_eligible"])
            for row in taxonomy.values()
        ),
    }
    missing_scored = metrics_audit.get("join_counters", {}).get("scored_rows_missing_taxonomy", 0)
    file_read_errors = len(scoring_audit.get("file_read_errors", []))
    audit_status = "fail" if file_read_errors else ("warn" if missing_scored else "pass")
    audit_payload = {
        "status": audit_status,
        "generated_at": built_at,
        "fixture": False,
        "checks": [
            {"id": "taxonomy_keys", "label": "Taxonomy keys unique", "status": "pass", "detail": f"{taxonomy_summary['unique_date_source_event_count']:,} unique date-source-event keys."},
            {"id": "forecast_file_reads", "label": "Clean forecast files readable", "status": "fail" if file_read_errors else "pass", "detail": f"{file_read_errors:,} clean-candidate file read/parse errors."},
            {"id": "model_version_deduplication", "label": "One configuration per model version", "status": "pass", "detail": f"{model_version_audit['input_exact_model_names']:,} exact names reduced to {model_version_audit['output_model_versions']:,} distinct versions without outcome-based selection."},
            {"id": "fixed_effect_join", "label": "Fixed-effect taxonomy join", "status": "warn" if missing_scored else "pass", "detail": f"{missing_scored:,} scored model-target rows excluded across {metrics_audit.get('unclassified_unique_targets', 0):,} explicitly audited targets."},
            {"id": "pair_metrics", "label": "Pair metrics generated", "status": "pass", "detail": f"{eligible_rows:,} eligible pair-slice rows at n ≥ {metrics_audit['min_overlap']}."},
            {"id": "finite_values", "label": "Undefined metrics explicit", "status": "pass", "detail": "Undefined lift/correlation values are null with audited reasons; NaN/Infinity are never published."},
        ],
        "classification": classification,
        "thresholds": {
            "min_overlap_default": metrics_audit["min_overlap"],
            "near_bi_max_gap": metrics_audit["near_bi_gap"],
            "high_loss_threshold": metrics_audit["high_adjusted_loss_threshold"],
        },
        "files": [],
    }
    hash_targets = [
        site_data_dir / "manifest.json", site_data_dir / "models.json", site_data_dir / "taxonomy.json",
        site_data_dir / "model-version-mapping.csv",
        *[event_dir / reference["file"].split("/", 1)[1] for reference in event_refs],
        full_gzip, eligible_gzip, derived_dir / "model_version_mapping.csv",
        derived_dir / "model_version_audit.json", derived_dir / "analysis_audit.json",
    ]
    repository_root = Path(
        os.path.commonpath([site_data_dir.resolve(), derived_dir.resolve()])
    )
    audit_payload["files"] = [
        {
            "path": str(path.resolve().relative_to(repository_root)),
            "sha256": sha256_file(path),
        }
        for path in hash_targets
    ]
    write_json(site_data_dir / "audit.json", audit_payload)
    return {
        "eligible_pair_slice_rows": eligible_rows,
        "models": len(model_payload),
        "slices": len(event_refs),
        "analytic_targets": len(analytic_target_keys),
        "analytic_unique_source_events": len(analytic_event_keys),
        "audit_status": audit_status,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-csv", required=True, type=Path)
    parser.add_argument("--taxonomy-csv", required=True, type=Path)
    parser.add_argument("--taxonomy-summary", required=True, type=Path)
    parser.add_argument("--scored-panel", required=True, type=Path)
    parser.add_argument("--scoring-audit", required=True, type=Path)
    parser.add_argument("--model-version-audit", required=True, type=Path)
    parser.add_argument("--model-version-mapping", required=True, type=Path)
    parser.add_argument("--metrics-audit", required=True, type=Path)
    parser.add_argument("--site-data-dir", required=True, type=Path)
    parser.add_argument("--derived-dir", required=True, type=Path)
    parser.add_argument("--analysis-commit", required=True)
    parser.add_argument("--built-at", default=datetime.now(timezone.utc).isoformat())
    args = parser.parse_args()
    summary = build_site_artifacts(
        pair_csv=args.pair_csv,
        taxonomy_csv=args.taxonomy_csv,
        taxonomy_summary_json=args.taxonomy_summary,
        scored_panel=args.scored_panel,
        scoring_audit_json=args.scoring_audit,
        model_version_audit_json=args.model_version_audit,
        model_version_mapping_csv=args.model_version_mapping,
        metrics_audit_json=args.metrics_audit,
        site_data_dir=args.site_data_dir,
        derived_dir=args.derived_dir,
        analysis_commit=args.analysis_commit,
        built_at=args.built_at,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
