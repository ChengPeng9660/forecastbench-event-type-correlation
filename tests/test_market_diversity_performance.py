from pathlib import Path

import pytest

import analysis.market_diversity_performance as market_performance
from analysis.market_diversity_performance import information_metadata, prompt_metadata


def test_prompt_and_information_conditions_remain_separate() -> None:
    assert prompt_metadata("zero shot with freeze values") == ("zero_shot", "Zero shot")
    assert prompt_metadata("scratchpad with news with freeze values") == (
        "scratchpad",
        "Scratchpad",
    )
    assert information_metadata("zero shot") == ("none", "No extra information")
    assert information_metadata("zero shot with freeze values") == (
        "freeze_values",
        "Freeze values",
    )
    assert information_metadata("scratchpad with news") == ("news", "News")
    assert information_metadata("scratchpad with news with freeze values") == (
        "news_freeze",
        "News + freeze",
    )
    assert information_metadata("zero shot with web search") == (
        "web_search",
        "Web search",
    )


def test_market_performance_exports_five_metrics_with_matched_original_probability_tv(monkeypatch) -> None:
    keys = [("2026-01-01", "polymarket", f"event-{index}", "") for index in range(3)]

    def row(probability: float) -> dict[str, str]:
        return {
            "prediction": str(probability), "outcome": "1", "origin_type": "Market",
            "question_fixed_effect": "0", "normalization_term": "0",
        }

    name = "GPT-Test (zero shot with freeze values)"
    panel = {name: {key: row(value) for key, value in zip(keys, (0.5, 0.0, 0.9))}}
    market = {keys[0]: row(0.0), keys[1]: row(1.0)}
    metadata = {name: {
        "exact_configuration": name, "canonical_model_version": "GPT-Test",
        "model_configuration": "zero shot with freeze values", "provider": "OpenAI",
    }}
    monkeypatch.setattr(market_performance, "read_exact_panel", lambda _: (panel, metadata, {}))
    monkeypatch.setattr(market_performance, "exclude_imputed_polymarket_rows", lambda p, _: (p, {}))
    monkeypatch.setattr(market_performance, "read_freeze_snapshots", lambda _: ({}, {}))
    monkeypatch.setattr(market_performance, "build_freeze_panel", lambda *_: (market, {}))
    monkeypatch.setattr(market_performance, "sha256_file", lambda _: "fixture")
    payload = market_performance.build_payload(Path("panel"), Path("taxonomy"), Path("raw"), minimum_overlap=2)
    assert len(payload["metrics"]) == 5
    point = payload["points"][0]
    assert point["n_common"] == 2
    assert point["diversity"]["total_variation"] == pytest.approx(0.75)
    assert point["exact_configuration"] == name
    assert point["prompt_type"] == "zero_shot"
    assert point["information_type"] == "freeze_values"
    assert payload["metrics"]["total_variation"]["range"] == [0.0, 1.0]
    assert payload["metrics"]["total_variation"]["label"] == "Total variation (TV)"
    # Changing outcomes changes ability scores, not probability-only TV. All
    # models and the market retain the same aligned target support.
    for records in (*panel.values(), market):
        for record in records.values():
            record["outcome"] = "0"
    changed = market_performance.build_payload(Path("panel"), Path("taxonomy"), Path("raw"), minimum_overlap=2)
    assert changed["points"][0]["n_common"] == point["n_common"]
    assert changed["points"][0]["diversity"]["total_variation"] == point["diversity"]["total_variation"]
