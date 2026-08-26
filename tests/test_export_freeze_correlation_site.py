from __future__ import annotations

from pathlib import Path

import pytest

from analysis.export_freeze_correlation_site import build_payload


def test_freeze_correlation_site_payload_matches_released_experiment() -> None:
    summary = Path("data/derived/freeze_exposed_market_aggregation/summary.json")
    pairs = Path(
        "data/derived/freeze_exposed_market_aggregation/pair_method_results.csv"
    )
    if not summary.exists() or not pairs.exists():
        pytest.skip("freeze-exposed experiment artifact not generated")
    payload = build_payload(summary, pairs)
    assert payload["audit"]["model_count"] == 27
    assert payload["audit"]["model_event_cells"] == 9323
    assert payload["audit"]["all_configs_explicitly_with_freeze"]
    assert all(
        "with freeze values" in point["exact_configuration"].lower()
        for point in payload["points"]
    )
    assert payload["points"] == sorted(
        payload["points"],
        key=lambda row: (
            -row["prediction_pearson"],
            row["model"].casefold(),
            row["model"],
        ),
    )
