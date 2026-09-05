"""Cross-fit the full published exact-configuration catalog on common Polymarket targets.

All configurations and partners are retained. Only empty train/test splits are
unestimable; support below 50 is flagged, never silently excluded. Fixed pools
are computed once per unordered pair/target. Directional CF uses training C/D
and a quadratic test-loss identity, independently for both fixed-base choices.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import resource
import sys
import time
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable, Mapping

from analysis.high_loss_diagnostics import fold_diagnostics, high_loss_details, oriented_diagnostics
from analysis.market_diversity_performance import read_exact_panel
from analysis.event_weighted_scoring import (
    brier_index as event_brier_index,
    event_count,
    event_equal_weights,
    event_weighted_mean,
)
from analysis.metrics import adjusted_pog, high_loss_lift, pearson_correlation, total_variation
from analysis.pair_aggregation import KEY, event_fold, predictions, sha256_file
from analysis.polymarket_aggregation import build_freeze_panel, read_freeze_snapshots
from analysis.polymarket_cleaning import exclude_imputed_polymarket_rows


SCHEMA_VERSION = 2
DEFAULT_SEEDS = tuple(range(20260825, 20260835))
MARKET_COMPARISON_TOLERANCE = 1e-12
CF_DENOMINATOR_EPSILON = 1e-24
METHOD_ORDER = ("simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds", "cf_directional", "best_single")
FIXED_METHODS = METHOD_ORDER[:4]
METRIC_ORDER = ("prediction_diversity", "adjusted_pog", "high_loss_lift", "adjusted_loss_corr", "total_variation")
IDENTITY_FIELDS = ("exact_configuration", "canonical_model_version", "model_configuration", "provider",
                   "prompt_type", "prompt_label", "information_type", "information_label")
METHODS = {
    "simple_mean": {"label": "Simple Mean", "deployable": True, "formula": "(p_base + p_partner) / 2"},
    "log_odds_mean": {"label": "Log-odds Mean", "deployable": True, "formula": "sigmoid((logit(p_base) + logit(p_partner)) / 2)"},
    "ec_w0_56": {"label": "EC · w = 0.56", "deployable": True, "formula": "sigmoid(0.56 * (logit(p_base) + logit(p_partner)))"},
    "piecewise_odds": {"label": "Piecewise Odds", "deployable": True, "formula": "threshold-5 piecewise summed-logit transform"},
    "cf_directional": {"label": "Directional CF", "deployable": True, "formula": "fixed base plus sign-specific clipped train C/D times partner-minus-base"},
    "best_single": {"label": "Best Single · hindsight", "deployable": False, "formula": "lower event-averaged Brier-score constituent per test fold, not a per-target oracle"},
}
METRICS = {
    "prediction_diversity": {"label": "Prediction diversity", "axis": "1 − prediction-level Pearson r"},
    "adjusted_pog": {"label": "Adjusted POG", "axis": "Adjusted pairwise oracle gain"},
    "high_loss_lift": {"label": "High-loss diversity", "axis": "1 − adjusted high-loss lift"},
    "adjusted_loss_corr": {"label": "Adjusted-loss diversity", "axis": "− adjusted-loss Pearson r"},
    "total_variation": {"label": "Total variation (TV)", "axis": "Mean |p_base − p_partner|", "range": [0.0, 1.0]},
}
TargetKey = tuple[str, ...]
Panel = Mapping[TargetKey, Mapping[str, str]]


@dataclass(frozen=True, slots=True)
class Observation:
    probability: float
    outcome: float
    adjustment: float
    raw_loss: float


@dataclass(frozen=True, slots=True)
class PairCell:
    key: TargetKey
    first: float
    second: float
    adjustment: float
    raw_losses: tuple[float, ...]
    c: float
    d: float


def configuration_id(name: str) -> str:
    return "c-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:20]


def prepare_panel(rows: Panel) -> dict[TargetKey, Observation]:
    output = {}
    for key, row in rows.items():
        if key[1].casefold() != "polymarket" or row["origin_type"] != "Market":
            raise ValueError(f"non-Polymarket/Market target: {key}")
        p, y = float(row["prediction"]), float(row["outcome"])
        adjustment = float(row["normalization_term"]) - float(row["question_fixed_effect"])
        if not all(math.isfinite(value) for value in (p, y, adjustment)) or not 0 <= p <= 1 or not 0 <= y <= 1:
            raise ValueError(f"invalid probability/outcome/adjustment: {key}")
        output[key] = Observation(p, y, adjustment, (p - y) ** 2)
    return output


def _score(raw: float, adjustment: float) -> dict[str, Any]:
    if -1e-14 <= raw <= 1e-14:  # Roundoff in the exact CF quadratic at zero loss.
        raw = 0.0
    if not math.isfinite(raw) or raw < 0:
        raise ValueError(f"invalid raw Brier: {raw}")
    adjusted = raw + adjustment
    index = event_brier_index(raw)
    result = {"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": index}
    return result


def _correlation(first: list[float], second: list[float]) -> tuple[float | None, str]:
    """Reject exact constants before centered floating-point variance can mislead.

    Keep this experiment-local: historical experiments retain their old helper.
    """
    if len(first) != len(second):
        raise ValueError("correlation requires equal-length vectors")
    if len(first) < 3:
        return None, "fewer_than_3_observations"
    constant_a = all(value == first[0] for value in first)
    constant_b = all(value == second[0] for value in second)
    if constant_a and constant_b:
        return None, "both_vectors_constant"
    if constant_a:
        return None, "first_vector_constant"
    if constant_b:
        return None, "second_vector_constant"
    return pearson_correlation(first, second)


def _half_summary(cells: list[PairCell]) -> dict[str, Any]:
    n = len(cells)
    keys = [cell.key for cell in cells]
    weights = event_equal_weights(keys)
    adjustment = math.fsum(weight * cell.adjustment for weight, cell in zip(weights, cells))
    p, q = [cell.first for cell in cells], [cell.second for cell in cells]
    first_loss = [cell.raw_losses[0] + cell.adjustment for cell in cells]
    second_loss = [cell.raw_losses[1] + cell.adjustment for cell in cells]
    prediction_r, prediction_reason = _correlation(p, q)
    loss_r, loss_reason = _correlation(first_loss, second_loss)
    lift, _, _, _, _, lift_reason = high_loss_lift(first_loss, second_loss, 0.25)
    scores = {name: _score(math.fsum(weight * cell.raw_losses[index] for weight, cell in zip(weights, cells)), adjustment)
              for index, name in enumerate(("first", "second", "market", *FIXED_METHODS))}
    a, b = scores["first"]["brier_index"], scores["second"]["brier_index"]
    return {
        "n": n, "n_events": event_count(keys), "adjustment": adjustment, "scores": scores,
        "high_loss_diagnostics": high_loss_details(first_loss, second_loss),
        "bi_gap": abs(a - b) if a is not None and b is not None else None,
        "diversity": {
            "prediction_diversity": None if prediction_r is None else 1 - prediction_r,
            "adjusted_pog": adjusted_pog(first_loss, second_loss),
            "high_loss_lift": None if lift is None else 1 - lift,
            "adjusted_loss_corr": None if loss_r is None else -loss_r,
            "total_variation": total_variation(p, q),
        },
        "metric_reasons": {"prediction_diversity": prediction_reason, "adjusted_pog": "",
                           "high_loss_lift": lift_reason, "adjusted_loss_corr": loss_reason, "total_variation": ""},
        "cf_statistics": {
            "up_c": math.fsum(weight * cell.c for weight, cell in zip(weights, cells) if cell.second >= cell.first),
            "up_d": math.fsum(weight * cell.d for weight, cell in zip(weights, cells) if cell.second >= cell.first),
            "down_c": math.fsum(weight * cell.c for weight, cell in zip(weights, cells) if cell.second < cell.first),
            "down_d": math.fsum(weight * cell.d for weight, cell in zip(weights, cells) if cell.second < cell.first),
        },
    }


def _oriented_statistics(summary: Mapping[str, Any], reverse: bool) -> tuple[float, float, float, float]:
    v = summary["cf_statistics"]
    if reverse:
        return v["down_d"] - v["down_c"], v["down_d"], v["up_d"] - v["up_c"], v["up_d"]
    return v["up_c"], v["up_d"], v["down_c"], v["down_d"]


def _cf_score(train: Mapping[str, Any], test: Mapping[str, Any], reverse: bool) -> tuple[dict[str, Any], dict[str, float]]:
    uc, ud, dc, dd = _oriented_statistics(train, reverse)
    up = min(1.0, max(0.0, uc / ud)) if ud > CF_DENOMINATOR_EPSILON else 0.0
    down = min(1.0, max(0.0, dc / dd)) if dd > CF_DENOMINATOR_EPSILON else 0.0
    tuc, tud, tdc, tdd = _oriented_statistics(test, reverse)
    raw = test["scores"]["second" if reverse else "first"]["raw_brier"] - 2 * up * tuc + up ** 2 * tud - 2 * down * tdc + down ** 2 * tdd
    return _score(raw, test["adjustment"]), {"upward_alpha": up, "downward_alpha": down}


def evaluate_prepared_pair(
    first_name: str, second_name: str,
    first: Mapping[TargetKey, Observation], second: Mapping[TargetKey, Observation], market: Mapping[TargetKey, Observation],
    *, split_seeds: Iterable[int] = DEFAULT_SEEDS, minimum_fold_overlap: int = 1,
    assignments: Mapping[TargetKey, tuple[bool, ...]] | None = None,
) -> dict[str, Any]:
    seeds = tuple(split_seeds)
    if not seeds or len(set(seeds)) != len(seeds) or minimum_fold_overlap < 1:
        raise ValueError("unique nonempty seeds and positive minimum support are required")
    common = sorted(set(first) & set(second) & set(market))
    result: dict[str, Any] = {
        "first_configuration": first_name, "second_configuration": second_name,
        "n_common": len(common), "status": "eligible", "folds": [], "skipped_splits": [],
        "unique_event_count": len({(key[1].casefold(), key[2]) for key in common}),
        "support_sha256": hashlib.sha256("\n".join("\t".join(key) for key in common).encode()).hexdigest(),
        "maximum_fold_count": 2 * len(seeds),
    }
    if not common:
        result.update(status="zero_common_support", reason="No shared non-imputed Polymarket target with a valid freeze probability.")
        return result
    result.update(date_min=min(key[0][:10] for key in common), date_max=max(key[0][:10] for key in common))
    if assignments is None:
        assignments = {key: tuple(event_fold(key[1], key[2], seed) == "A" for seed in seeds) for key in common}
    counts = [sum(assignments[key][repeat] for key in common) for repeat in range(len(seeds))]
    valid_repeats = [repeat for repeat, count in enumerate(counts) if min(count, len(common) - count) >= minimum_fold_overlap]
    result["skipped_splits"] = [{"seed": seed, "a_rows": counts[repeat], "b_rows": len(common) - counts[repeat],
                                 "reason": "empty_train_or_test_half" if min(counts[repeat], len(common) - counts[repeat]) == 0 else "below_requested_minimum"}
                                for repeat, seed in enumerate(seeds) if repeat not in valid_repeats]
    if not valid_repeats:
        result.update(status="insufficient_split_support", reason="No event-disjoint split has nonempty training and test support.")
        return result
    cells = []
    for key in common:
        a, b, m = first[key], second[key], market[key]
        if a.outcome != b.outcome or a.outcome != m.outcome or a.adjustment != b.adjustment or a.adjustment != m.adjustment:
            raise ValueError(f"pair/market target scoring metadata disagree: {key}")
        fixed = predictions(a.probability, b.probability, 0.56, 5.0)
        delta = b.probability - a.probability
        cells.append(PairCell(key, a.probability, b.probability, a.adjustment,
                              (a.raw_loss, b.raw_loss, m.raw_loss, *[(fixed[method] - a.outcome) ** 2 for method in FIXED_METHODS]),
                              (a.outcome - a.probability) * delta, delta ** 2))
    for repeat in valid_repeats:
        seed = seeds[repeat]
        split = {"A": [cell for cell in cells if assignments[cell.key][repeat]],
                 "B": [cell for cell in cells if not assignments[cell.key][repeat]]}
        summaries = {fold: _half_summary(rows) for fold, rows in split.items()}
        for train_fold, test_fold in (("A", "B"), ("B", "A")):
            train, test = summaries[train_fold], summaries[test_fold]
            cf_first, weights_first = _cf_score(train, test, False)
            cf_second, weights_second = _cf_score(train, test, True)
            best = min(("first", "second"), key=lambda name: test["scores"][name]["raw_brier"])
            result["folds"].append({
                "fold_id": f"split_{repeat + 1:02d}_seed_{seed}__{train_fold}_train__{test_fold}_test",
                "seed": seed, "train_fold": train_fold, "test_fold": test_fold,
                "n_train": train["n"], "n_test": test["n"],
                "n_train_events": train["n_events"], "n_test_events": test["n_events"],
                "train_bi_gap": train["bi_gap"],
                "train_near_bi": train["bi_gap"] is not None and train["bi_gap"] <= 2.0,
                "train_diversity": train["diversity"], "train_metric_reasons": train["metric_reasons"],
                "train_high_loss_diagnostics": train["high_loss_diagnostics"],
                "train_cf_statistics": train["cf_statistics"], "test_cf_statistics": test["cf_statistics"],
                "first": test["scores"]["first"], "second": test["scores"]["second"], "market": test["scores"]["market"],
                "methods": {**{method: test["scores"][method] for method in FIXED_METHODS}, "best_single": test["scores"][best]},
                "cf_first": cf_first, "cf_second": cf_second, "weights_first": weights_first, "weights_second": weights_second,
                "best_single_side": best,
            })
    return result


def evaluate_pair(first_name: str, second_name: str, first_panel: Panel, second_panel: Panel, market_panel: Panel,
                  *, split_seeds: Iterable[int] = DEFAULT_SEEDS, minimum_fold_overlap: int = 1) -> dict[str, Any]:
    """Fixture/audit entry point using uncollapsed exact target rows."""
    return evaluate_prepared_pair(first_name, second_name, prepare_panel(first_panel), prepare_panel(second_panel), prepare_panel(market_panel),
                                  split_seeds=split_seeds, minimum_fold_overlap=minimum_fold_overlap)


def _weighted_score(scores: list[Mapping[str, Any]], weights: list[int]) -> dict[str, Any]:
    total = sum(weights)
    raw = (math.fsum(score["raw_brier"] * weight for score, weight in zip(scores, weights)) / total
           if all(score["raw_brier"] is not None for score in scores) else None)
    adjusted = (math.fsum(score["adjusted_brier"] * weight for score, weight in zip(scores, weights)) / total
                if all(score["adjusted_brier"] is not None for score in scores) else None)
    result = {
        "raw_brier": raw,
        "adjusted_brier": adjusted,
        "brier_index": event_brier_index(raw) if raw is not None else None,
    }
    if raw is None:
        result["brier_index_reason"] = "one_or_more_included_fold_brier_scores_undefined"
    return result


def aggregate_view(folds: list[dict[str, Any]], reverse: bool = False) -> dict[str, Any] | None:
    if not folds:
        return None
    train_total = sum(row["n_train"] for row in folds)
    train_event_total = sum(row["n_train_events"] for row in folds)
    test_weights = [row["n_test_events"] for row in folds]
    first, second = ("second", "first") if reverse else ("first", "second")
    references = {name: _weighted_score([row[field] for row in folds], test_weights)
                  for name, field in (("base", first), ("partner", second), ("market", "market"))}
    best = _weighted_score([row["methods"]["best_single"] for row in folds], test_weights)

    def gain(score: Mapping[str, Any], reference: Mapping[str, Any]) -> float | None:
        denominator = reference["raw_brier"]
        value = score["raw_brier"]
        return ((denominator - value) / denominator
                if denominator is not None and value is not None
                and math.isfinite(denominator) and math.isfinite(value) and denominator > 0 else None)

    methods = {}
    for method in METHOD_ORDER:
        scores = [row["cf_second" if reverse else "cf_first"] if method == "cf_directional" else row["methods"][method] for row in folds]
        score = _weighted_score(scores, test_weights)
        methods[method] = {**score, **{f"gain_vs_{name}": gain(score, ref) for name, ref in references.items()},
                           "gain_vs_best_single": gain(score, best),
                           "beats_market": score["brier_index"] is not None and references["market"]["brier_index"] is not None and score["brier_index"] > references["market"]["brier_index"] + MARKET_COMPARISON_TOLERANCE}
    diversity, valid_support, reasons = {}, {}, {}
    for metric in METRIC_ORDER:
        valid = [row for row in folds if row["train_diversity"][metric] is not None]
        support = sum(row["n_train"] for row in valid)
        diversity[metric] = (math.fsum(row["train_diversity"][metric] * row["n_train"] for row in valid) / support
                             if support and len(valid) == len(folds) else None)
        valid_support[metric] = support
        reasons[metric] = dict(Counter(row["train_metric_reasons"][metric] for row in folds if row["train_metric_reasons"][metric]))
    min_train, min_test = min(row["n_train"] for row in folds), min(row["n_test"] for row in folds)
    min_train_events = min(row["n_train_events"] for row in folds)
    min_test_events = min(row["n_test_events"] for row in folds)
    high_loss_diagnostics = fold_diagnostics(
        [row["train_diversity"]["high_loss_lift"] for row in folds],
        [row["n_train"] for row in folds],
        reasons=[row["train_metric_reasons"]["high_loss_lift"] for row in folds],
        details=[row.get("train_high_loss_diagnostics") for row in folds],
    )
    return {"fold_count": len(folds), "fold_ids": [row["fold_id"] for row in folds],
            "train_target_cells": train_total, "test_target_cells": sum(row["n_test"] for row in folds),
            "train_event_cells": train_event_total, "test_event_cells": sum(test_weights),
            "min_train_rows": min_train, "min_test_rows": min_test,
            "min_train_events": min_train_events, "min_test_events": min_test_events,
            "small_support": min(min_train_events, min_test_events) < 50,
            "train_diversity": diversity, "train_diversity_target_cells": valid_support, "train_metric_reasons": reasons,
            "high_loss_diagnostics": oriented_diagnostics(high_loss_diagnostics, reverse),
            "train_bi_gap": math.fsum(row["train_bi_gap"] * row["n_train_events"] for row in folds) / train_event_total if all(row["train_bi_gap"] is not None for row in folds) else None,
            **references, "methods": methods}


def build_views(result: Mapping[str, Any], reverse: bool = False) -> dict[str, Any]:
    return {sample: {view: aggregate_view([row for row in result["folds"]
                                           if (sample == "all" or row["train_near_bi"])
                                           and (view == "combined" or row["train_fold"] == ("A" if view == "a_to_b" else "B"))], reverse)
                     for view in ("combined", "a_to_b", "b_to_a")}
            for sample in ("all", "near_bi")}


@contextmanager
def gzip_text_writer(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", newline="") as text:
                yield text


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")


class FoldWriter:
    """Bound diagnostic file sizes while streaming one unordered-pair fold each row."""

    def __init__(self, directory: Path, chunk_size: int = 10_000):
        self.directory = directory
        self.chunk_size = chunk_size
        self.files: list[dict[str, Any]] = []
        self.context = None
        self.handle = None
        self.path: Path | None = None
        self.rows = 0

    def __enter__(self):
        return self

    def _close(self):
        if self.context is not None:
            self.context.__exit__(None, None, None)
            assert self.path is not None
            self.files.append({"file": f"folds/{self.path.name}", "row_count": self.rows,
                               "bytes": self.path.stat().st_size, "sha256": sha256_file(self.path)})
            self.context = self.handle = None

    def write(self, row: Mapping[str, Any]) -> None:
        if self.handle is None or self.rows == self.chunk_size:
            self._close()
            self.path = self.directory / "folds" / f"part-{len(self.files) + 1:04d}.jsonl.gz"
            self.context = gzip_text_writer(self.path)
            self.handle = self.context.__enter__()
            self.rows = 0
        self.handle.write(json.dumps(row, allow_nan=False, separators=(",", ":")) + "\n")
        self.rows += 1

    def __exit__(self, *_):
        self._close()




def _read_catalog(catalog_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    identities = {point["exact_configuration"]: {key: point[key] for key in IDENTITY_FIELDS} for point in catalog["points"]}
    if len(identities) != len(catalog["points"]):
        raise ValueError("duplicate exact configuration in the published catalog")
    return catalog, identities


def _check_catalog_support(catalog: Mapping[str, Any], panel: Mapping[str, Panel], market: Panel) -> list[dict[str, Any]]:
    source_checks = []
    for point in catalog["points"]:
        name = point["exact_configuration"]
        common = sorted(set(panel[name]) & set(market))
        if len(common) != point["n_common"] or len(panel[name]) != len(common):
            raise ValueError(f"catalog support changed for {name}: {len(common)} != {point['n_common']}")
        differences = []
        for source, label in ((panel[name], "model"), (market, "matched_market")):
            prepared = prepare_panel({key: source[key] for key in common})
            raw = event_weighted_mean(common, [prepared[key].raw_loss for key in common])
            offset = event_weighted_mean(common, [prepared[key].adjustment for key in common])
            score = _score(raw, offset)
            for metric in ("raw_brier", "adjusted_brier", "brier_index"):
                if score[metric] is None or abs(score[metric] - point[label][metric]) > 1e-12:
                    raise ValueError(f"catalog score changed for {name}: {label}.{metric}")
                differences.append(abs(score[metric] - point[label][metric]))
        source_checks.append({"exact_configuration": name, "n_common": len(common), "maximum_score_difference": max(differences)})
    return source_checks


def load_inputs(panel_path: Path, taxonomy_path: Path, processed_root: Path, catalog_path: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    catalog, identities = _read_catalog(catalog_path)
    panel, metadata, panel_audit = read_exact_panel(panel_path)
    if missing := identities.keys() - panel.keys():
        raise ValueError(f"published exact configurations missing from raw panel: {sorted(missing)}")
    panel = {name: {key: row for key, row in panel[name].items() if key[1].casefold() == "polymarket"} for name in identities}
    for name, identity in identities.items():
        for field in ("exact_configuration", "canonical_model_version", "model_configuration", "provider"):
            if metadata[name][field] != identity[field]:
                raise ValueError(f"published identity differs from raw panel: {name}, {field}")
    panel, clean_audit = exclude_imputed_polymarket_rows(panel, processed_root)
    snapshots, snapshot_audit = read_freeze_snapshots(taxonomy_path)
    valid_snapshots = {}
    for key, row in snapshots.items():
        try:
            value = float(row["market_prob"])
        except (ValueError, TypeError):
            continue
        if math.isfinite(value) and 0 <= value <= 1:
            valid_snapshots[key] = row
    invalid_freeze_rows = 0
    for name, rows in panel.items():
        valid = {key: row for key, row in rows.items() if (key[0][:10], "polymarket", key[2]) in valid_snapshots}
        invalid_freeze_rows += len(rows) - len(valid)
        panel[name] = valid
    market, match_audit = build_freeze_panel(panel, valid_snapshots)
    source_checks = _check_catalog_support(catalog, panel, market)
    return panel, market, identities, {
        "panel": panel_audit, "imputation": clean_audit, "freeze_snapshots": snapshot_audit,
        "freeze_match": match_audit, "excluded_invalid_or_missing_freeze_rows": invalid_freeze_rows,
        "published_configuration_support_checks": source_checks,
    }


def load_clean_cache(
    clean_path: Path,
    panel_path: Path,
    taxonomy_path: Path,
    catalog_path: Path,
    *,
    allow_metric_refresh: bool = False,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Reuse only a hash-verified clean snapshot and its original input audit.

    The processed raw files are not reread: their imputation decisions are frozen
    in this audited snapshot. A changed input panel, taxonomy, catalog, cache, or
    its reconstructed published supports/scores requires a fresh raw load.
    """
    audit_path = clean_path.parent / "audit.json"
    prior = json.loads(audit_path.read_text(encoding="utf-8"))
    clean_hash = sha256_file(clean_path)
    if clean_hash != prior["clean_intermediate_sha256"]:
        raise ValueError("clean cache SHA-256 differs from its recorded audit")
    source_hash_checks = {}
    for name, path in (("panel", panel_path), ("taxonomy", taxonomy_path)):
        source_hash_checks[name] = path.is_file()
        if path.is_file() and sha256_file(path) != prior["provenance"][f"{name}_sha256"]:
            raise ValueError(f"clean cache original {name} SHA-256 differs from current input")
    if not allow_metric_refresh and sha256_file(catalog_path) != prior["provenance"]["catalog_sha256"]:
        raise ValueError("clean cache original catalog SHA-256 differs from current input")
    catalog, identities = _read_catalog(catalog_path)
    panel: dict[str, dict[TargetKey, dict[str, str]]] = {name: {} for name in identities}
    market: dict[TargetKey, dict[str, str]] = {}
    copied = ("prediction", "outcome", "origin_type", "question_fixed_effect", "normalization_term", "source_file")
    with gzip.open(clean_path, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"exact_configuration", *KEY, *copied, "market_prediction"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("clean cache is missing required columns")
        for cached in reader:
            name = cached["exact_configuration"]
            if name not in panel:
                raise ValueError(f"clean cache has a configuration outside the published catalog: {name}")
            key = tuple(cached[field] for field in KEY)
            if key in panel[name]:
                raise ValueError(f"duplicate clean cache configuration/target: {name}, {key}")
            row = {**dict(zip(KEY, key)), **{field: cached[field] for field in copied}}
            panel[name][key] = row
            market_row = {**row, "prediction": cached["market_prediction"], "source_file": "audited_freeze_snapshot"}
            if key in market and any(float(market[key][field]) != float(market_row[field]) for field in
                                     ("prediction", "outcome", "question_fixed_effect", "normalization_term")):
                raise ValueError(f"clean cache market/scoring metadata disagree: {key}")
            market[key] = market_row
    if sum(len(rows) for rows in panel.values()) != prior["configuration_target_rows"]:
        raise ValueError("clean cache row count differs from its recorded audit")
    source_checks = _check_catalog_support(catalog, panel, market)
    input_audit = {**prior["inputs"], "original_provenance": prior.get("provenance", {}),
                   "published_configuration_support_checks": source_checks,
                   "verified_clean_cache": {"sha256": clean_hash,
                                            "original_source_hashes_verified_when_present": source_hash_checks,
                                            "panel_taxonomy_catalog_hashes_verified": not allow_metric_refresh and all(source_hash_checks.values()),
                                            "catalog_identity_support_and_scores_reconstructed": True,
                                            "metric_definition_refresh": allow_metric_refresh,
                                            "processed_raw_files_reread": False}}
    return panel, market, identities, input_audit


def write_clean_intermediate(path: Path, panel: Mapping[str, Panel], market: Panel) -> None:
    fields = ("exact_configuration", *KEY, "prediction", "outcome", "origin_type", "question_fixed_effect", "normalization_term", "market_prediction", "source_file")
    copied = ("prediction", "outcome", "origin_type", "question_fixed_effect", "normalization_term", "source_file")
    with gzip_text_writer(path) as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for name, rows in sorted(panel.items()):
            for key, row in sorted(rows.items()):
                writer.writerow({"exact_configuration": name, **dict(zip(KEY, key)),
                                 **{field: row.get(field, "") for field in copied}, "market_prediction": market[key]["prediction"]})


def run_experiment(
    panel_path: Path, taxonomy_path: Path, processed_root: Path, catalog_path: Path,
    output_dir: Path, site_output_dir: Path, *, split_seeds: Iterable[int] = DEFAULT_SEEDS,
    minimum_fold_overlap: int = 1, clean_cache: Path | None = None,
    metric_definition_refresh: bool = False,
) -> dict[str, Any]:
    start = time.perf_counter()
    seeds = tuple(split_seeds)
    panel, market, identities, input_audit = (load_clean_cache(clean_cache, panel_path, taxonomy_path, catalog_path,
                                                               allow_metric_refresh=metric_definition_refresh)
                                            if clean_cache is not None else load_inputs(panel_path, taxonomy_path, processed_root, catalog_path))
    output_dir.mkdir(parents=True, exist_ok=True)
    clean_path = output_dir / "clean_panel.csv.gz"
    write_clean_intermediate(clean_path, panel, market)
    prepared = {name: prepare_panel(rows) for name, rows in panel.items()}
    prepared_market = prepare_panel(market)
    assignments = {key: tuple(event_fold(key[1], key[2], seed) == "A" for seed in seeds) for key in market}
    del panel, market
    loaded_seconds = time.perf_counter() - start
    print(json.dumps({"stage": "inputs_ready", "configurations": len(identities), "clean_intermediate": str(clean_path), "seconds": loaded_seconds}), flush=True)
    names = sorted(identities, key=lambda name: (name.casefold(), name))
    if len({configuration_id(name) for name in names}) != len(names):
        raise ValueError("configuration artifact ID collision")
    partners: dict[str, list[dict[str, Any]]] = {name: [] for name in names}
    statuses: Counter[str] = Counter()
    fold_histogram: Counter[int] = Counter()
    fold_count = eligible_cells = high_support_pairs = 0
    fold_path = output_dir / "fold-results-manifest.json"
    with FoldWriter(output_dir) as fold_writer:
        for pair_number, (first, second) in enumerate(combinations(names, 2), start=1):
            result = evaluate_prepared_pair(first, second, prepared[first], prepared[second], prepared_market,
                                           split_seeds=seeds, minimum_fold_overlap=minimum_fold_overlap, assignments=assignments)
            statuses[result["status"]] += 1
            fold_histogram[len(result["folds"])] += 1
            if result["status"] == "eligible":
                eligible_cells += result["n_common"]
                high_support_pairs += int(all(min(fold["n_train_events"], fold["n_test_events"]) >= 50 for fold in result["folds"]))
            for fold in result["folds"]:
                fold_writer.write({"first_configuration": first, "second_configuration": second, **fold})
                fold_count += 1
            for base, partner, reverse in ((first, second, False), (second, first, True)):
                partners[base].append({"partner": identities[partner],
                                       **{key: value for key, value in result.items() if key not in ("folds", "first_configuration", "second_configuration")},
                                       "views": build_views(result, reverse)})
            if pair_number % 1000 == 0:
                print(json.dumps({"stage": "pairs", "candidate_pairs": pair_number, "status_counts": statuses, "elapsed_seconds": time.perf_counter() - start}), flush=True)
    _write_json(fold_path, {"schema_version": SCHEMA_VERSION, "format": "jsonl_gzip",
                            "row_count": fold_count, "files": fold_writer.files})
    configurations = []
    public_bytes = 0
    for name in names:
        rows = partners[name]
        file = f"configurations/{configuration_id(name)}.json"
        _write_json(site_output_dir / file, {"schema_version": SCHEMA_VERSION, "base_configuration": name, "base": identities[name], "partners": rows})
        public_bytes += (site_output_dir / file).stat().st_size
        configurations.append({**identities[name], "file": file,
                               "eligible_partner_count": sum(row["status"] == "eligible" for row in rows),
                               "partner_status_counts": dict(Counter(row["status"] for row in rows))})
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    audit = {
        "configuration_count": len(names), "candidate_unordered_pairs": sum(statuses.values()),
        "unordered_pair_status_counts": dict(statuses), "eligible_pair_target_rows": eligible_cells,
        "unordered_pair_available_fold_count_histogram": dict(sorted(fold_histogram.items())),
        "high_support_eligible_pairs": high_support_pairs,
        "unordered_fold_records": fold_count, "ordered_fold_evaluations": fold_count * 2,
        "configurations_without_eligible_partner": sum(row["eligible_partner_count"] == 0 for row in configurations),
        "configuration_target_rows": sum(len(rows) for rows in prepared.values()),
        "all_methods_use_identical_pair_market_test_support": True, "all_partners_retain_exact_catalog_identity": True,
        "strict_train_fold_near_bi": True, "test_event_outcomes_used_for_training": False,
        "clean_intermediate": str(clean_path), "clean_intermediate_sha256": sha256_file(clean_path),
        "fold_results": str(fold_path), "fold_results_sha256": sha256_file(fold_path),
        "fold_results_format": "sharded_jsonl_gzip",
        "fold_results_bytes": sum(chunk["bytes"] for chunk in fold_writer.files),
        "maximum_fold_shard_bytes": max((chunk["bytes"] for chunk in fold_writer.files), default=0),
        "input_loading_seconds": loaded_seconds, "elapsed_seconds": time.perf_counter() - start,
        "peak_rss_bytes": peak_rss if sys.platform == "darwin" else peak_rss * 1024,
        "public_shards_bytes": public_bytes,
    }
    prior_provenance = input_audit.get("original_provenance", {}) if isinstance(input_audit, dict) else {}
    provenance = {"panel": str(panel_path), "panel_sha256": sha256_file(panel_path) if panel_path.is_file() else prior_provenance.get("panel_sha256"),
                  "taxonomy": str(taxonomy_path), "taxonomy_sha256": sha256_file(taxonomy_path) if taxonomy_path.is_file() else prior_provenance.get("taxonomy_sha256"),
                  "catalog": str(catalog_path), "catalog_sha256": sha256_file(catalog_path),
                  "producer_sha256": sha256_file(Path(__file__)),
                  "market_probability": "valid audited freeze_datetime_value, not later market values",
                  "join_key": "date + lowercase Polymarket source + event_id + horizon"}
    manifest = {
        "schema_version": SCHEMA_VERSION, "generated_at": datetime.now(timezone.utc).isoformat(),
        "methods": METHODS, "method_order": METHOD_ORDER, "metrics": METRICS, "metric_order": METRIC_ORDER,
        "split": {"repetitions": len(seeds), "seeds": seeds, "minimum_fold_overlap": minimum_fold_overlap,
                  "support_warning_threshold": 50, "near_bi_gap": 2.0,
                  "unit": "source + event_id, shared across dates and horizons", "event_disjoint": True},
        "aggregation": {"diversity": "train-target weighted fold diagnostics; null if any included fold metric is undefined; exact constant vectors have undefined correlation",
                        "brier_score": "within each fold, average squared error within event and then equally across events; combine folds by event count",
                        "brier_index": "100 * (1 - sqrt(Brier score)), transformed once after event averaging",
                        "loss": "event-equal ordinary Brier score", "gain": "relative reduction in event-equal ordinary Brier score",
                        "best_single": "test-fold hindsight constituent, not deployable", "near_bi": "filter individual training folds before aggregation",
                        "beats_market_bi_tolerance": MARKET_COMPARISON_TOLERANCE},
        "configurations": configurations, "audit": audit, "provenance": provenance,
    }
    _write_json(site_output_dir / "manifest.json", manifest)
    _write_json(output_dir / "audit.json", {**audit, "inputs": input_audit, "provenance": provenance})
    print(json.dumps({"stage": "complete", **audit}, indent=2), flush=True)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, default=Path("data/build/scored_panel.csv"))
    parser.add_argument("--taxonomy", type=Path, default=Path("data/build/event_taxonomy.csv"))
    parser.add_argument("--processed-root", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("site/public/data/polymarket-aggregation/market-diversity-performance.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/derived/configuration_pair_aggregation"))
    parser.add_argument("--site-output-dir", type=Path, default=Path("site/public/data/configuration-pair-aggregation"))
    parser.add_argument("--clean-cache", type=Path, help="Reuse a clean CSV.gz only after checking adjacent audit.json hashes and catalog supports/scores")
    parser.add_argument("--metric-definition-refresh", action="store_true",
                        help="Allow a deliberately rescored catalog while retaining the audited clean cache")
    args = parser.parse_args()
    run_experiment(args.panel, args.taxonomy, args.processed_root, args.catalog, args.output_dir, args.site_output_dir,
                   clean_cache=args.clean_cache, metric_definition_refresh=args.metric_definition_refresh)


if __name__ == "__main__":
    main()
