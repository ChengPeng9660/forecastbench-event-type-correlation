from __future__ import annotations

import csv
import os
from collections import defaultdict
from pathlib import Path

import pytest

from analysis.taxonomy import (
    EXPECTED_TOPICS,
    classify_csv,
    classify_event,
    load_config,
    normalize_source,
)


AUDITED_INPUT_SHA256 = "ad757817d32acca985f27e1ec82c190587303f4acd69bcda0380ba752a5505ff"
AUDITED_TOPIC_COUNTS = {
    "climate_weather": 1233,
    "entertainment_culture": 153,
    "finance_economics": 2972,
    "health_science": 690,
    "other": 5767,
    "politics_conflict": 1826,
    "sports": 755,
    "technology_ai": 265,
}
AUDITED_STATUS_COUNTS = {
    "fallback": 725,
    "generic_pair_unrecoverable": 5040,
    "keyword_rule": 2397,
    "manual_override": 154,
    "source_rule": 5345,
}


@pytest.mark.parametrize(
    ("source", "origin", "official"),
    [
        ("acled", "Dataset", "ACLED"),
        ("dbnomics", "Dataset", "DBnomics"),
        ("fred", "Dataset", "FRED"),
        ("wikipedia", "Dataset", "Wikipedia"),
        ("yfinance", "Dataset", "Yahoo Finance"),
        ("infer", "Market", "INFER"),
        ("manifold", "Market", "Manifold"),
        ("metaculus", "Market", "Metaculus"),
        ("polymarket", "Market", "Polymarket"),
    ],
)
def test_official_source_layer_is_complete(source: str, origin: str, official: str) -> None:
    result = classify_event(source, "An unmatched visible question")
    assert result.origin_type == origin
    assert result.official_source == official
    assert result.derived_topic in EXPECTED_TOPICS


def test_source_aliases_normalize_without_changing_provenance() -> None:
    assert normalize_source("Yahoo Finance") == "yfinance"
    assert normalize_source("YAHOO_FINANCE") == "yfinance"
    result = classify_event("Yahoo Finance", "Will the stock price rise?")
    assert result.origin_type == "Dataset"
    assert result.official_source == "Yahoo Finance"
    assert result.derived_topic == "finance_economics"


def test_unknown_source_fails_closed() -> None:
    with pytest.raises(ValueError, match="Unknown ForecastBench source"):
        classify_event("made-up-source", "Will this happen?")


def test_generic_pair_is_not_assigned_a_semantic_topic() -> None:
    text = (
        "We are presenting you with two probability questions. "
        "Please predict the probability that both will happen."
    )
    result = classify_event("polymarket", text)
    assert result.is_generic_pair is True
    assert result.derived_topic == "other"
    assert result.topic_id == result.derived_topic
    assert result.derived_subtopic == "generic_pair_unrecoverable"
    assert result.topic_status == "generic_pair_unrecoverable"
    assert result.topic_analysis_eligible is False
    assert result.review_required is True
    assert result.topic_candidate_count == 0


@pytest.mark.parametrize(
    ("source", "text", "topic", "rule_id"),
    [
        ("acled", "Will there be more battles?", "politics_conflict", "source.acled"),
        ("fred", "Will the indicator rise?", "finance_economics", "source.fred"),
        ("dbnomics", "Will the reading rise?", "climate_weather", "source.dbnomics"),
        ("wikipedia", "Will a FIDE ranking rise?", "sports", "wikipedia.chess"),
        ("polymarket", "James Norton announced as next James Bond?", "entertainment_culture", "override.james_bond"),
        ("polymarket", "Will Latvia win Eurovision 2025?", "entertainment_culture", "override.eurovision"),
        ("metaculus", "Will H5N1 transmit between humans?", "health_science", "override.avian_influenza"),
        ("metaculus", "¿Empresas del sector tecnológico?", "technology_ai", "keyword.technology_ai"),
        ("polymarket", "Will the Eagles win Super Bowl 2026?", "sports", "override.super_bowl"),
        ("polymarket", "Will the Utah Hockey Club win the 2025 President's Trophy?", "sports", "override.president_trophy"),
        ("polymarket", "Will Tesla reach $578 in November?", "finance_economics", "override.tesla_asset_price"),
    ],
)
def test_rules_and_known_ambiguity_regressions(
    source: str, text: str, topic: str, rule_id: str
) -> None:
    result = classify_event(source, text)
    assert result.derived_topic == topic
    assert result.topic_rule_id == rule_id
    assert result.review_required is False


def test_multilabel_keyword_match_is_auditable() -> None:
    result = classify_event(
        "metaculus",
        "Will an AI cyberattack affect the presidential election?",
    )
    assert result.topic_status == "keyword_conflict"
    assert result.topic_id == result.derived_topic
    assert result.topic_candidates == ("politics_conflict", "technology_ai")
    assert result.topic_candidate_count == 2
    assert result.review_required is True
    assert result.topic_analysis_eligible is True


def test_classifier_is_deterministic() -> None:
    args = ("manifold", "Will inflation fall after the presidential election?")
    assert classify_event(*args) == classify_event(*args)


def test_config_has_stable_version_and_supported_topics() -> None:
    config = load_config()
    assert config["taxonomy_version"] == "forecastbench-topic-v1.1.0"
    configured_topics = {
        rule["topic"]
        for group in ("source_rules", "wikipedia_rules", "event_overrides", "manual_overrides", "keyword_rules")
        for rule in (
            config[group].values() if isinstance(config[group], dict) else config[group]
        )
    }
    assert configured_topics == EXPECTED_TOPICS


def test_exact_event_override_precedes_keyword_order() -> None:
    result = classify_event(
        "metaculus",
        "Will Russian athletes be barred from competing at the Olympics?",
        event_id="15796",
    )
    assert result.derived_topic == "sports"
    assert result.topic_status == "manual_override"
    assert result.topic_rule_id == "review.metaculus.15796"


def test_duplicate_analysis_key_is_rejected(tmp_path: Path) -> None:
    input_csv = tmp_path / "duplicate.csv"
    output_csv = tmp_path / "classified.csv"
    fieldnames = ["date", "source", "event_id", "question_text"]
    with input_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        row = {
            "date": "2025-01-01",
            "source": "acled",
            "event_id": "same-id",
            "question_text": "Will there be more battles?",
        }
        writer.writerow(row)
        writer.writerow(row)
    with pytest.raises(ValueError, match=r"duplicate \(date, source, event_id\)"):
        classify_csv(input_csv, output_csv)


def test_audited_forecastbench_snapshot(tmp_path: Path) -> None:
    """Optional golden test; set the env var when the licensed data is local."""

    input_value = os.environ.get("FORECASTBENCH_RESOLVED_EVENTS_CSV")
    if not input_value:
        pytest.skip("FORECASTBENCH_RESOLVED_EVENTS_CSV is not set")
    input_csv = Path(input_value)
    output_csv = tmp_path / "classified.csv"
    summary = classify_csv(input_csv, output_csv)

    assert summary["input_sha256"] == AUDITED_INPUT_SHA256
    assert summary["row_count"] == 13_661
    assert summary["unique_date_source_event_count"] == 13_661
    assert summary["unique_source_event_count"] == 8_204
    assert summary["origin_counts"] == {"Dataset": 10_205, "Market": 3_456}
    assert summary["topic_counts"] == AUDITED_TOPIC_COUNTS
    assert summary["status_counts"] == AUDITED_STATUS_COUNTS

    labels_by_event: dict[tuple[str, str], set[str]] = defaultdict(set)
    with output_csv.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            assert row["topic_id"] == row["derived_topic"]
            labels_by_event[(normalize_source(row["source"]), row["event_id"])].add(
                row["derived_topic"]
            )
    assert all(len(labels) == 1 for labels in labels_by_event.values())
