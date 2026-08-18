"""Auditable two-layer taxonomy for resolved ForecastBench events.

The official layer (``origin_type`` and ``official_source``) is never inferred
from topic text.  The semantic topic layer is explicitly marked as derived.
The module uses only the Python standard library so that classification can be
reproduced without installing a data-frame package.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


CONFIG_PATH = Path(__file__).with_name("taxonomy_config.json")
EXPECTED_TOPICS = {
    "finance_economics",
    "politics_conflict",
    "climate_weather",
    "health_science",
    "technology_ai",
    "sports",
    "entertainment_culture",
    "other",
}

OUTPUT_COLUMNS = (
    "origin_type",
    "official_source",
    "is_generic_pair",
    "source_domain_hint",
    "topic_id",
    "derived_topic",
    "derived_subtopic",
    "topic_status",
    "topic_rule_id",
    "topic_confidence",
    "topic_candidates",
    "topic_candidate_count",
    "topic_analysis_eligible",
    "review_required",
    "taxonomy_version",
)


@dataclass(frozen=True)
class Classification:
    origin_type: str
    official_source: str
    is_generic_pair: bool
    source_domain_hint: str
    topic_id: str
    derived_topic: str
    derived_subtopic: str
    topic_status: str
    topic_rule_id: str
    topic_confidence: str
    topic_candidates: tuple[str, ...]
    topic_candidate_count: int
    topic_analysis_eligible: bool
    review_required: bool
    taxonomy_version: str

    def csv_fields(self) -> dict[str, str | int | bool]:
        fields = asdict(self)
        fields["topic_candidates"] = ";".join(self.topic_candidates)
        return fields


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    if not config.get("taxonomy_version"):
        raise ValueError("taxonomy_version must be present")
    topics = {
        rule["topic"]
    for group in ("source_rules", "wikipedia_rules", "event_overrides", "manual_overrides", "keyword_rules")
        for rule in (
            config[group].values() if isinstance(config[group], dict) else config[group]
        )
    }
    unknown_topics = topics - EXPECTED_TOPICS
    if unknown_topics:
        raise ValueError(f"Unsupported topics in configuration: {sorted(unknown_topics)}")
    return config


def normalize_source(source: object) -> str:
    normalized = re.sub(r"[\s_-]+", " ", str(source or "").strip().lower())
    aliases = {
        "yahoo finance": "yfinance",
        "y finance": "yfinance",
    }
    return aliases.get(normalized, normalized.replace(" ", ""))


def _match_rules(text: str, rules: Sequence[Mapping[str, str]]) -> list[Mapping[str, str]]:
    return [rule for rule in rules if re.search(rule["pattern"], text, flags=re.IGNORECASE)]


def _make_classification(
    *,
    official: Mapping[str, str],
    config: Mapping[str, Any],
    is_generic_pair: bool,
    topic: str,
    subtopic: str,
    status: str,
    rule_id: str,
    confidence: str,
    candidates: Iterable[str],
    eligible: bool,
    review_required: bool,
) -> Classification:
    unique_candidates = tuple(dict.fromkeys(candidates))
    if topic not in EXPECTED_TOPICS:
        raise ValueError(f"Unsupported derived topic: {topic}")
    return Classification(
        origin_type=official["origin_type"],
        official_source=official["official_source"],
        is_generic_pair=is_generic_pair,
        source_domain_hint=official["source_domain_hint"],
        topic_id=topic,
        derived_topic=topic,
        derived_subtopic=subtopic,
        topic_status=status,
        topic_rule_id=rule_id,
        topic_confidence=confidence,
        topic_candidates=unique_candidates,
        topic_candidate_count=len(unique_candidates),
        topic_analysis_eligible=eligible,
        review_required=review_required,
        taxonomy_version=config["taxonomy_version"],
    )


def classify_event(
    source: object,
    question_text: object,
    *,
    event_id: object | None = None,
    config: Mapping[str, Any] | None = None,
) -> Classification:
    """Classify one event without mutating official provenance.

    Unknown sources fail closed.  A generic pair receives ``other`` rather
    than a source-imputed semantic topic because its two constituent question
    texts are absent from the audited input.
    """

    config = config or load_config()
    source_key = normalize_source(source)
    official = config["official_sources"].get(source_key)
    if official is None:
        raise ValueError(f"Unknown ForecastBench source: {source!r}")

    text = str(question_text or "").strip()
    is_generic_pair = text.startswith(config["generic_pair_prefix"])
    if is_generic_pair:
        return _make_classification(
            official=official,
            config=config,
            is_generic_pair=True,
            topic="other",
            subtopic="generic_pair_unrecoverable",
            status="generic_pair_unrecoverable",
            rule_id=f"generic_pair.{source_key}",
            confidence="unavailable",
            candidates=(),
            eligible=False,
            review_required=True,
        )

    exact_override = next(
        (
            rule
            for rule in config.get("event_overrides", [])
            if normalize_source(rule["source"]) == source_key
            and str(rule["event_id"]) == str(event_id)
        ),
        None,
    )
    if exact_override is not None:
        topic = exact_override["topic"]
        return _make_classification(
            official=official,
            config=config,
            is_generic_pair=False,
            topic=topic,
            subtopic=exact_override["subtopic"],
            status="manual_override",
            rule_id=exact_override["rule_id"],
            confidence=exact_override.get("confidence", "high"),
            candidates=exact_override.get("candidates", (topic,)),
            eligible=bool(exact_override.get("eligible", topic != "other")),
            review_required=bool(exact_override.get("review_required", False)),
        )

    source_rule = config["source_rules"].get(source_key)
    if source_rule:
        return _make_classification(
            official=official,
            config=config,
            is_generic_pair=False,
            topic=source_rule["topic"],
            subtopic=source_rule["subtopic"],
            status="source_rule",
            rule_id=source_rule["rule_id"],
            confidence="high",
            candidates=(source_rule["topic"],),
            eligible=True,
            review_required=False,
        )

    if source_key == "wikipedia":
        matches = _match_rules(text, config["wikipedia_rules"])
        if matches:
            primary = matches[0]
            candidates = [match["topic"] for match in matches]
            conflict = len(set(candidates)) > 1
            return _make_classification(
                official=official,
                config=config,
                is_generic_pair=False,
                topic=primary["topic"],
                subtopic=primary["subtopic"],
                status="keyword_conflict" if conflict else "keyword_rule",
                rule_id=primary["rule_id"],
                confidence="low" if conflict else "high",
                candidates=candidates,
                eligible=True,
                review_required=conflict,
            )
        return _make_classification(
            official=official,
            config=config,
            is_generic_pair=False,
            topic="other",
            subtopic="wikipedia_unclassified",
            status="fallback",
            rule_id="fallback.wikipedia",
            confidence="low",
            candidates=(),
            eligible=False,
            review_required=True,
        )

    overrides = _match_rules(text, config["manual_overrides"])
    if overrides:
        primary = overrides[0]
        return _make_classification(
            official=official,
            config=config,
            is_generic_pair=False,
            topic=primary["topic"],
            subtopic=primary["subtopic"],
            status="manual_override",
            rule_id=primary["rule_id"],
            confidence="high",
            candidates=(primary["topic"],),
            eligible=True,
            review_required=False,
        )

    matches = _match_rules(text, config["keyword_rules"])
    if matches:
        primary = matches[0]
        candidates = [match["topic"] for match in matches]
        conflict = len(set(candidates)) > 1
        return _make_classification(
            official=official,
            config=config,
            is_generic_pair=False,
            topic=primary["topic"],
            subtopic=primary["subtopic"],
            status="keyword_conflict" if conflict else "keyword_rule",
            rule_id=primary["rule_id"],
            confidence="low" if conflict else "medium",
            candidates=candidates,
            eligible=True,
            review_required=conflict,
        )

    return _make_classification(
        official=official,
        config=config,
        is_generic_pair=False,
        topic="other",
        subtopic="unclassified",
        status="fallback",
        rule_id=f"fallback.{source_key}",
        confidence="low",
        candidates=(),
        eligible=False,
        review_required=True,
    )


def classify_rows(
    rows: Iterable[Mapping[str, object]],
    *,
    config: Mapping[str, Any] | None = None,
) -> Iterable[dict[str, object]]:
    config = config or load_config()
    for row in rows:
        if "source" not in row or "question_text" not in row:
            raise ValueError("Input rows must contain source and question_text")
        classification = classify_event(
            row["source"],
            row["question_text"],
            event_id=row.get("event_id"),
            config=config,
        )
        yield {**row, **classification.csv_fields()}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def classify_csv(
    input_csv: Path,
    output_csv: Path,
    *,
    summary_json: Path | None = None,
    config_path: Path = CONFIG_PATH,
) -> dict[str, Any]:
    config = load_config(config_path)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    topic_counts: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    origin_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    row_count = 0
    unique_date_keys: set[tuple[str, str, str]] = set()
    unique_event_keys: set[tuple[str, str]] = set()

    with input_csv.open(newline="", encoding="utf-8-sig") as source_handle:
        reader = csv.DictReader(source_handle)
        if reader.fieldnames is None:
            raise ValueError("Input CSV has no header")
        required = {"date", "event_id", "source", "question_text"}
        missing = required - set(reader.fieldnames)
        if missing:
            raise ValueError(f"Input CSV is missing required columns: {sorted(missing)}")
        overlapping = set(reader.fieldnames) & set(OUTPUT_COLUMNS)
        if overlapping:
            raise ValueError(f"Input already has taxonomy columns: {sorted(overlapping)}")

        with output_csv.open("w", newline="", encoding="utf-8") as output_handle:
            writer = csv.DictWriter(output_handle, fieldnames=[*reader.fieldnames, *OUTPUT_COLUMNS])
            writer.writeheader()
            for output_row in classify_rows(reader, config=config):
                writer.writerow(output_row)
                row_count += 1
                topic_counts[str(output_row["derived_topic"])] += 1
                status_counts[str(output_row["topic_status"])] += 1
                origin_counts[str(output_row["origin_type"])] += 1
                source_counts[str(output_row["official_source"])] += 1
                source_key = normalize_source(output_row["source"])
                event_id = str(output_row["event_id"])
                unique_date_keys.add((str(output_row["date"]), source_key, event_id))
                unique_event_keys.add((source_key, event_id))

    if len(unique_date_keys) != row_count:
        raise ValueError(
            "Input contains duplicate (date, source, event_id) keys: "
            f"{row_count - len(unique_date_keys)} duplicate rows"
        )

    summary = {
        "taxonomy_version": config["taxonomy_version"],
        "input_sha256": sha256_file(input_csv),
        "row_count": row_count,
        "unique_date_source_event_count": len(unique_date_keys),
        "unique_source_event_count": len(unique_event_keys),
        "topic_counts": dict(sorted(topic_counts.items())),
        "status_counts": dict(sorted(status_counts.items())),
        "origin_counts": dict(sorted(origin_counts.items())),
        "official_source_counts": dict(sorted(source_counts.items())),
    }
    if summary_json is not None:
        summary_json.parent.mkdir(parents=True, exist_ok=True)
        summary_json.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-csv", type=Path, required=True)
    parser.add_argument("--output-csv", type=Path, required=True)
    parser.add_argument("--summary-json", type=Path)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    summary = classify_csv(
        args.input_csv,
        args.output_csv,
        summary_json=args.summary_json,
        config_path=args.config,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
