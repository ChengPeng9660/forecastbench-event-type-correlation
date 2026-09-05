"""Event-equal scoring primitives for binary forecast evaluation.

Each event receives the same total mass.  Targets that belong to the same
event divide that event's mass equally.  These helpers deliberately operate on
ordinary squared error; difficulty adjustments are separate diagnostics.
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Iterable, Sequence


TargetKey = tuple[str, ...]
EventKey = tuple[str, str]


def event_key(key: TargetKey) -> EventKey:
    """Return the source/event identity shared across dates and horizons."""
    return key[1].casefold(), key[2]


def event_count(keys: Iterable[TargetKey]) -> int:
    return len({event_key(key) for key in keys})


def event_equal_weights(keys: Sequence[TargetKey]) -> list[float]:
    """Give each event equal total weight and split it across its targets."""
    if not keys:
        raise ValueError("event-equal weights require at least one target")
    counts = Counter(event_key(key) for key in keys)
    n_events = len(counts)
    return [1.0 / (n_events * counts[event_key(key)]) for key in keys]


def event_weighted_mean(keys: Sequence[TargetKey], values: Sequence[float]) -> float:
    if len(keys) != len(values):
        raise ValueError("event-weighted mean requires aligned keys and values")
    weights = event_equal_weights(keys)
    return math.fsum(weight * value for weight, value in zip(weights, values))


def brier_index(brier_score: float) -> float:
    if not math.isfinite(brier_score) or not 0 <= brier_score <= 1:
        raise ValueError(f"Brier score must lie in [0, 1], got {brier_score}")
    return 100.0 * (1.0 - math.sqrt(brier_score))
