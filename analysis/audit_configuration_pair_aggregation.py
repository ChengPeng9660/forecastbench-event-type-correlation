"""Independent arithmetic used to audit exact-configuration pair experiments.

No experiment producer or shared scoring helper is imported: formulas, event
assignment, support intersection, and fold aggregation are implemented directly.
This module is read-only with respect to experiment inputs and public artifacts.
"""
from __future__ import annotations

import hashlib
import argparse
import csv
import gzip
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence


METHODS = ("simple_mean", "log_odds_mean", "ec_w0_56", "piecewise_odds",
           "cf_directional", "best_single")
METRICS = ("prediction_diversity", "adjusted_pog", "high_loss_lift",
           "adjusted_loss_corr", "total_variation")
SEEDS = tuple(range(20260825, 20260835))
Key = tuple[str, str, str, str]
Panel = Mapping[Key, Mapping[str, Any]]


def event_half(key: Key, seed: int) -> str:
    token = f"{seed}|{key[1].casefold()}|{key[2]}".encode()
    return "A" if int.from_bytes(hashlib.sha256(token).digest()[:8], "big") % 2 == 0 else "B"


def mean(values: Sequence[float]) -> float:
    return math.fsum(values) / len(values)


def brier_index(loss: float) -> float | None:
    return (1 - math.sqrt(loss)) * 100 if math.isfinite(loss) and loss >= 0 else None


def correlation(first: Sequence[float], second: Sequence[float]) -> float | None:
    if (len(first) < 3 or all(value == first[0] for value in first)
            or all(value == second[0] for value in second)):
        return None
    a, b = mean(first), mean(second)
    da, db = [x - a for x in first], [x - b for x in second]
    aa, bb = math.fsum(x * x for x in da), math.fsum(x * x for x in db)
    return math.fsum(x * y for x, y in zip(da, db)) / math.sqrt(aa * bb) if aa and bb else None


def adjusted_losses(panel: Panel, keys: list[Key], predictions: Sequence[float] | None = None) -> list[float]:
    values = predictions if predictions is not None else [float(panel[key]["prediction"]) for key in keys]
    return [(value - float(panel[key]["outcome"])) ** 2
            - float(panel[key]["question_fixed_effect"]) + float(panel[key]["normalization_term"])
            for key, value in zip(keys, values)]


def train_coordinates(first: Panel, second: Panel, keys: list[Key]) -> dict[str, float | None]:
    p = [float(first[key]["prediction"]) for key in keys]
    q = [float(second[key]["prediction"]) for key in keys]
    a, b = adjusted_losses(first, keys), adjusted_losses(second, keys)
    prediction_r, loss_r = correlation(p, q), correlation(a, b)
    high_a, high_b = [loss > 0.25 for loss in a], [loss > 0.25 for loss in b]
    count_a, count_b = sum(high_a), sum(high_b)
    lift = (sum(x and y for x, y in zip(high_a, high_b)) * len(keys) / (count_a * count_b)
            if count_a and count_b else None)
    return {
        "prediction_diversity": None if prediction_r is None else 1 - prediction_r,
        "adjusted_pog": min(mean(a), mean(b)) - mean([min(x, y) for x, y in zip(a, b)]),
        "high_loss_lift": None if lift is None else 1 - lift,
        "adjusted_loss_corr": None if loss_r is None else -loss_r,
        "total_variation": mean([abs(x - y) for x, y in zip(p, q)]),
    }


def directional_weights(first: Panel, second: Panel, keys: list[Key]) -> tuple[float, float]:
    numerator, denominator = [[], []], [[], []]
    for key in keys:
        p, q, y = (float(first[key]["prediction"]), float(second[key]["prediction"]),
                   float(first[key]["outcome"]))
        d = q - p
        side = 0 if d >= 0 else 1
        numerator[side].append(d * (y - p))
        denominator[side].append(d * d)
    result = []
    for c, d in zip(numerator, denominator):
        scale = math.fsum(d)
        result.append(min(1.0, max(0.0, math.fsum(c) / scale)) if scale else 0.0)
    return result[0], result[1]


def pool_predictions(p: float, q: float, weights: tuple[float, float]) -> dict[str, float]:
    def log_odds(value: float) -> float:
        clipped = min(1 - 1e-6, max(1e-6, value))
        return math.log(clipped) - math.log1p(-clipped)

    def logistic(value: float) -> float:
        return 1 / (1 + math.exp(-value))

    summed = log_odds(p) + log_odds(q)
    boundary = math.log(5)
    piecewise = (summed + boundary / 2 if summed <= -boundary else
                 summed - boundary / 2 if summed >= boundary else summed / 2)
    return {"simple_mean": (p + q) / 2, "log_odds_mean": logistic(summed / 2),
            "ec_w0_56": logistic(0.56 * summed), "piecewise_odds": logistic(piecewise),
            "cf_directional": p + weights[0 if q >= p else 1] * (q - p)}


def support_folds(first: Panel, second: Panel, market: Panel, *, seeds: Sequence[int] = SEEDS,
                  minimum_fold: int = 1) -> tuple[list[Key], list[dict[str, Any]]]:
    common = sorted(key for key in set(first) & set(second) & set(market)
                    if key[1].casefold() == "polymarket")
    records = []
    for repetition, seed in enumerate(seeds, 1):
        halves = {side: [key for key in common if event_half(key, seed) == side] for side in ("A", "B")}
        if min(map(len, halves.values())) < minimum_fold:
            continue
        for train, test in (("A", "B"), ("B", "A")):
            train_keys = halves[train]
            first_bi = brier_index(mean(adjusted_losses(first, train_keys)))
            second_bi = brier_index(mean(adjusted_losses(second, train_keys)))
            gap = abs(first_bi - second_bi) if first_bi is not None and second_bi is not None else None
            records.append({"fold_id": f"split_{repetition:02d}_seed_{seed}__{train}_train__{test}_test",
                            "seed": seed, "train_fold": train, "test_fold": test,
                            "train_keys": train_keys, "test_keys": halves[test],
                            "train_bi_gap": gap, "train_near_bi": gap is not None and gap <= 2})
    return common, records


def reference_folds(first: Panel, second: Panel, market: Panel, *, seeds: Sequence[int] = SEEDS,
                    minimum_fold: int = 1) -> list[dict[str, Any]]:
    _, folds = support_folds(first, second, market, seeds=seeds, minimum_fold=minimum_fold)
    for fold in folds:
        train, test = fold["train_keys"], fold["test_keys"]
        weights = directional_weights(first, second, train)
        fold["weights"] = weights
        fold["train_diversity"] = train_coordinates(first, second, train)
        fold["train_target_cells"], fold["test_target_cells"] = len(train), len(test)

        def scores(predicted: Sequence[float]) -> dict[str, float | None]:
            raw = mean([(value - float(first[key]["outcome"])) ** 2 for key, value in zip(test, predicted)])
            adjusted = mean(adjusted_losses(first, test, predicted))
            return {"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": brier_index(adjusted)}

        for name, panel in (("base", first), ("partner", second), ("market", market)):
            fold[name] = scores([float(panel[key]["prediction"]) for key in test])
        predictions = [pool_predictions(float(first[key]["prediction"]), float(second[key]["prediction"]), weights)
                       for key in test]
        fold["methods"] = {method: scores([row[method] for row in predictions]) for method in METHODS[:-1]}
        fold["methods"]["best_single"] = dict(min((fold["base"], fold["partner"]), key=lambda row: row["adjusted_brier"]))
    return folds


def aggregate_reference(folds: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not folds:
        return None

    def weighted(getter, weight_field, *, require_all=False):
        valid = [(getter(row), row[weight_field]) for row in folds if getter(row) is not None]
        if require_all and len(valid) != len(folds):
            return None
        return math.fsum(value * weight for value, weight in valid) / sum(weight for _, weight in valid) if valid else None

    output = {"fold_count": len(folds), "fold_ids": [row["fold_id"] for row in folds],
              "train_target_cells": sum(row["train_target_cells"] for row in folds),
              "test_target_cells": sum(row["test_target_cells"] for row in folds),
              "min_train_rows": min(row["train_target_cells"] for row in folds),
              "min_test_rows": min(row["test_target_cells"] for row in folds),
              "small_support": any(min(row["train_target_cells"], row["test_target_cells"]) < 50 for row in folds),
              "train_bi_gap": weighted(lambda row: row["train_bi_gap"], "train_target_cells", require_all=True),
              "train_diversity": {metric: weighted(lambda row: row["train_diversity"][metric], "train_target_cells", require_all=True)
                                  for metric in METRICS},
              "train_diversity_target_cells": {
                  metric: sum(row["train_target_cells"] for row in folds if row["train_diversity"][metric] is not None)
                  for metric in METRICS}}
    score_fields = ("raw_brier", "adjusted_brier", "brier_index")
    for name in ("base", "partner", "market"):
        output[name] = {field: weighted(lambda row: row[name][field], "test_target_cells", require_all=field == "brier_index")
                        for field in score_fields}
    methods = {}
    for method in METHODS:
        row = {field: weighted(lambda fold: fold["methods"][method][field], "test_target_cells", require_all=field == "brier_index")
               for field in score_fields}
        for name in ("base", "partner", "market"):
            denominator = output[name]["adjusted_brier"]
            row[f"gain_vs_{name}"] = ((denominator - row["adjusted_brier"]) / denominator
                                     if denominator is not None and denominator > 0 else None)
        row["beats_market"] = (row["brier_index"] is not None and output["market"]["brier_index"] is not None
                               and row["brier_index"] > output["market"]["brier_index"] + 1e-12)
        methods[method] = row
    best_loss = methods["best_single"]["adjusted_brier"]
    for row in methods.values():
        row["gain_vs_best_single"] = (best_loss - row["adjusted_brier"]) / best_loss if best_loss > 0 else None
    output["methods"] = methods
    return output


def reference_views(folds: list[dict[str, Any]]) -> dict[str, Any]:
    views = {}
    for sample in ("all", "near_bi"):
        selected = [row for row in folds if sample == "all" or row["train_near_bi"]]
        views[sample] = {
            direction: aggregate_reference([row for row in selected if direction == "combined"
                                            or row["train_fold"] == ("A" if direction == "a_to_b" else "B")])
            for direction in ("combined", "a_to_b", "b_to_a")}
    return views


def compare_expected(expected: Any, actual: Any, path: str = "", tolerance: float = 1e-10) -> list[str]:
    """Compare independently expected fields, allowing explicit extra provenance."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path}: expected object"]
        return [error for key, value in expected.items()
                for error in ([f"{path}.{key}: missing"] if key not in actual else
                              compare_expected(value, actual[key], f"{path}.{key}", tolerance))]
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            return [f"{path}: array cardinality mismatch"]
        return [error for i, (left, right) in enumerate(zip(expected, actual))
                for error in compare_expected(left, right, f"{path}[{i}]", tolerance)]
    if isinstance(expected, (float, int)) and not isinstance(expected, bool):
        valid = (isinstance(actual, (float, int)) and not isinstance(actual, bool)
                 and math.isfinite(actual) and math.isclose(expected, actual, abs_tol=tolerance, rel_tol=tolerance))
        return [] if valid else [f"{path}: {expected!r} != {actual!r}"]
    return [] if type(expected) is type(actual) and expected == actual else [f"{path}: {expected!r} != {actual!r}"]


IDENTITY_FIELDS = ("exact_configuration", "canonical_model_version", "model_configuration", "provider",
                   "prompt_type", "prompt_label", "information_type", "information_label")


def file_sha256(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_clean_intermediate(path: Path) -> tuple[dict[str, dict[Key, dict[str, str]]], dict[Key, dict[str, str]]]:
    panels: dict[str, dict[Key, dict[str, str]]] = {}
    market: dict[Key, dict[str, str]] = {}
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            name = row["exact_configuration"]
            key = tuple(row[field] for field in ("date", "source", "event_id", "horizon"))
            if key[1] != "polymarket" or row["origin_type"] != "Market":
                raise ValueError(f"clean intermediate includes non-Polymarket target: {key}")
            for field in ("prediction", "market_prediction", "outcome"):
                value = float(row[field])
                if not math.isfinite(value) or not 0 <= value <= 1:
                    raise ValueError(f"invalid {field}: {name}, {key}")
            if not all(math.isfinite(float(row[field])) for field in ("question_fixed_effect", "normalization_term")):
                raise ValueError(f"invalid target adjustment: {key}")
            if key in panels.setdefault(name, {}):
                raise ValueError(f"duplicate exact-configuration target: {name}, {key}")
            panels[name][key] = row
            market_row = {**row, "prediction": row["market_prediction"]}
            if key in market and any(float(market[key][field]) != float(market_row[field])
                                     for field in ("prediction", "outcome", "question_fixed_effect", "normalization_term")):
                raise ValueError(f"pair/market metadata mismatch: {key}")
            market[key] = market_row
    return panels, market


def compact_support(first: Panel, second: Panel, market: Panel) -> dict[str, Any]:
    common, folds = support_folds(first, second, market)
    metadata = [{field: row[field] for field in ("fold_id", "seed", "train_fold", "test_fold", "train_bi_gap", "train_near_bi")}
                | {"n_train": len(row["train_keys"]), "n_test": len(row["test_keys"])} for row in folds]
    return {"n_common": len(common), "folds": metadata,
            "status": "eligible" if folds else "zero_common_support" if not common else "insufficient_split_support",
            "unique_event_count": len({(key[1], key[2]) for key in common}),
            "support_sha256": hashlib.sha256("\n".join("\t".join(key) for key in common).encode()).hexdigest()}


def selected_support(folds: list[dict[str, Any]], sample: str, direction: str) -> list[dict[str, Any]]:
    return [row for row in folds if (sample == "all" or row["train_near_bi"])
            and (direction == "combined" or row["train_fold"] == ("A" if direction == "a_to_b" else "B"))]


def audit_view_contract(view: Any, folds: list[dict[str, Any]], path: str) -> list[str]:
    if not folds:
        return [] if view is None else [f"{path}: empty support must have null view"]
    train_total = sum(row["n_train"] for row in folds)
    expected = {"fold_count": len(folds), "fold_ids": [row["fold_id"] for row in folds],
                "train_target_cells": train_total, "test_target_cells": sum(row["n_test"] for row in folds),
                "min_train_rows": min(row["n_train"] for row in folds), "min_test_rows": min(row["n_test"] for row in folds),
                "small_support": any(min(row["n_train"], row["n_test"]) < 50 for row in folds),
                "train_bi_gap": math.fsum(row["train_bi_gap"] * row["n_train"] for row in folds) / train_total
                if all(row["train_bi_gap"] is not None for row in folds) else None}
    errors = compare_expected(expected, view, path)
    if not isinstance(view, dict):
        return errors
    if set(view.get("train_diversity", {})) != set(METRICS):
        errors.append(f"{path}: wrong diversity metric IDs")
    if set(view.get("train_metric_reasons", {})) != set(METRICS):
        errors.append(f"{path}: wrong missing-metric reason IDs")
    if set(view.get("methods", {})) != set(METHODS):
        errors.append(f"{path}: wrong aggregation method IDs")
    for metric in METRICS:
        value = view.get("train_diversity", {}).get(metric)
        support = view.get("train_diversity_target_cells", {}).get(metric)
        if not isinstance(support, int) or isinstance(support, bool) or not 0 <= support <= train_total:
            errors.append(f"{path}.{metric}: invalid defined training support")
        elif (value is None) != (support < train_total):
            errors.append(f"{path}.{metric}: partial metric support must be null, complete support must be numeric")
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
            errors.append(f"{path}.{metric}: non-finite/non-numeric diversity")
        if metric == "total_variation" and (value is None or not 0 <= value <= 1):
            errors.append(f"{path}: nonempty view lacks valid TV")
        reasons = view.get("train_metric_reasons", {}).get(metric)
        if (not isinstance(reasons, dict) or any(not isinstance(count, int) or isinstance(count, bool)
                                                or count <= 0 for count in reasons.values())):
            errors.append(f"{path}.{metric}: invalid missing-metric reason counts")
        elif bool(reasons) != (value is None) or sum(reasons.values()) > len(folds):
            errors.append(f"{path}.{metric}: missing-metric reasons disagree with null coordinate")
    for name, score in [(name, view.get(name, {})) for name in ("base", "partner", "market")] + list(view.get("methods", {}).items()):
        for field in ("raw_brier", "adjusted_brier", "brier_index"):
            value = score.get(field)
            if field not in score or (value is None and field != "brier_index") or (
                value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value))
            ):
                errors.append(f"{path}.{name}.{field}: missing/invalid score")
        if isinstance(score.get("raw_brier"), (int, float)) and not -1e-12 <= score["raw_brier"] <= 1 + 1e-12:
            errors.append(f"{path}.{name}: raw Brier outside [0,1]")
    for name, score in view.get("methods", {}).items():
        for reference in ("base", "partner", "market"):
            denominator = view[reference]["adjusted_brier"]
            gain = ((denominator - score["adjusted_brier"]) / denominator if denominator > 0 else None)
            errors.extend(compare_expected(gain, score.get(f"gain_vs_{reference}"), f"{path}.{name}.gain_vs_{reference}"))
        best_loss = view["methods"]["best_single"]["adjusted_brier"]
        best_gain = ((best_loss - score["adjusted_brier"]) / best_loss if best_loss > 0 else None)
        errors.extend(compare_expected(best_gain, score.get("gain_vs_best_single"), f"{path}.{name}.gain_vs_best_single"))
        bi, market_bi = score["brier_index"], view["market"]["brier_index"]
        expected_win = bi is not None and market_bi is not None and bi > market_bi + 1e-12
        errors.extend(compare_expected(expected_win, score.get("beats_market"), f"{path}.{name}.beats_market"))
    return errors


def sample_pairs(supports: Mapping[tuple[str, str], dict[str, Any]], count: int) -> list[tuple[str, str]]:
    eligible = [pair for pair, data in supports.items() if data["status"] == "eligible"]
    ordered = sorted(eligible, key=lambda pair: hashlib.sha256("\0".join(pair).encode()).hexdigest())
    chosen = set()
    cases = [
        ("Grok-4-0709 (zero shot with freeze values)", "Grok-4-0709 (zero shot)"),
        ("Grok-beta (scratchpad with freeze values)", "Grok-beta (zero shot with freeze values)"),
        ("Grok-beta (zero shot with freeze values)", "Grok-beta (zero shot)"),
        ("GPT-4-Turbo-2024-04-09 (scratchpad with freeze values)", "GPT-4-Turbo-2024-04-09 (zero shot with freeze values)"),
    ]
    for pair in cases:
        key = tuple(sorted(pair))
        if key in supports and supports[key]["status"] == "eligible":
            chosen.add(key)
    for predicate in (lambda row: 0 < len(row["folds"]) < 20,
                      lambda row: any(fold["n_train"] < 50 or fold["n_test"] < 50 for fold in row["folds"]),
                      lambda row: 0 < sum(fold["train_near_bi"] for fold in row["folds"]) < len(row["folds"])):
        found = next((pair for pair in ordered if predicate(supports[pair])), None)
        if found:
            chosen.add(found)
    for pair in ordered:
        if len(chosen) >= count:
            break
        chosen.add(pair)
    return sorted(chosen)


def audit_fold_artifacts(derived: Path, supports: Mapping[tuple[str, str], dict[str, Any]],
                         panels: Mapping[str, Panel], market: Panel,
                         samples: list[tuple[str, str]]) -> dict[str, Any]:
    manifest_path = derived / "fold-results-manifest.json"
    manifest = read_json(manifest_path)
    errors = []
    expected_count = sum(len(row["folds"]) for row in supports.values())
    errors.extend(compare_expected(expected_count, manifest.get("row_count"), "fold_manifest.row_count"))
    expected = {pair: {row["fold_id"]: row for row in data["folds"]} for pair, data in supports.items() if data["folds"]}
    seen: dict[tuple[str, str], set[str]] = {}
    references = {}
    for first, second in samples:
        for base, partner in ((first, second), (second, first)):
            references[(base, partner)] = {row["fold_id"]: row for row in reference_folds(panels[base], panels[partner], market)}
    total = sample_count = 0
    files = []
    for index, chunk in enumerate(manifest["files"], 1):
        path = derived / chunk["file"]
        if not path.resolve().is_relative_to(derived.resolve()):
            raise ValueError("fold chunk path leaves derived experiment directory")
        if file_sha256(path) != chunk["sha256"]:
            errors.append(f"{chunk['file']}: checksum mismatch")
        if path.stat().st_size != chunk["bytes"]:
            errors.append(f"{chunk['file']}: byte size mismatch")
        rows = 0
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                first, second = row["first_configuration"], row["second_configuration"]
                pair = tuple(sorted((first, second)))
                fold_id = row["fold_id"]
                if pair not in expected or fold_id not in expected[pair]:
                    errors.append(f"{chunk['file']}: unknown pair/fold {pair}, {fold_id}")
                    continue
                if fold_id in seen.setdefault(pair, set()):
                    errors.append(f"{pair}: duplicate diagnostic fold {fold_id}")
                seen[pair].add(fold_id)
                errors.extend(compare_expected(expected[pair][fold_id], row, f"fold.{first}.{second}.{fold_id}"))
                if (first, second) in references:
                    for base, partner, reverse in ((first, second, False), (second, first, True)):
                        ref = references[(base, partner)][fold_id]
                        actual_weights = row["weights_second" if reverse else "weights_first"]
                        checks = [(ref["base"], row["second" if reverse else "first"]),
                                  (ref["partner"], row["first" if reverse else "second"]),
                                  (ref["market"], row["market"]),
                                  (ref["train_diversity"], row["train_diversity"]),
                                  (ref["methods"]["cf_directional"], row["cf_second" if reverse else "cf_first"]),
                                  ({"upward_alpha": ref["weights"][0], "downward_alpha": ref["weights"][1]}, actual_weights)]
                        checks.extend((ref["methods"][method], row["methods"][method]) for method in METHODS if method != "cf_directional")
                        for wanted, actual in checks:
                            errors.extend(compare_expected(wanted, actual, f"sample_fold.{base}.{partner}.{fold_id}"))
                    sample_count += 1
                rows += 1
        errors.extend(compare_expected(chunk["row_count"], rows, chunk["file"] + ".row_count"))
        files.append({"file": chunk["file"], "row_count": rows, "sha256": chunk["sha256"]})
        total += rows
        if index % 5 == 0:
            print(json.dumps({"stage": "fold_chunks", "checked": index, "rows": total, "errors": len(errors)}), flush=True)
    if set(seen) != set(expected) or any(seen.get(pair, set()) != set(records) for pair, records in expected.items()):
        errors.append("stored diagnostic pair/fold coverage differs from independent nonempty event splits")
    errors.extend(compare_expected(expected_count, total, "fold_files.total_rows"))
    return {"passed": not errors, "row_count": total, "sampled_fold_rows_recomputed_both_bases": sample_count,
            "files": files, "errors": errors}


def audit_artifacts(site_data: Path, derived: Path, catalog_path: Path, baseline_path: Path,
                    *, sampled_pair_count: int = 18) -> dict[str, Any]:
    experiment_dir = site_data / "configuration-pair-aggregation"
    manifest = read_json(experiment_dir / "manifest.json")
    catalog = read_json(catalog_path)
    identities = {row["exact_configuration"]: {field: row[field] for field in IDENTITY_FIELDS} for row in catalog["points"]}
    catalog_points = {row["exact_configuration"]: row for row in catalog["points"]}
    panels, market = read_clean_intermediate(derived / "clean_panel.csv.gz")
    errors = []
    for field, path in (("clean_intermediate_sha256", derived / "clean_panel.csv.gz"),
                        ("fold_results_sha256", derived / "fold-results-manifest.json")):
        if field in manifest.get("audit", {}) and manifest["audit"][field] != file_sha256(path):
            errors.append(f"manifest.audit.{field}: input/artifact checksum mismatch")
    if manifest.get("provenance", {}).get("catalog_sha256", file_sha256(catalog_path)) != file_sha256(catalog_path):
        errors.append("manifest provenance catalog checksum mismatch")
    producer_path = Path(__file__).with_name("configuration_pair_aggregation.py")
    recorded_producer = manifest.get("provenance", {}).get("producer_sha256")
    if recorded_producer is not None and recorded_producer != file_sha256(producer_path):
        errors.append("manifest provenance producer checksum differs from current source")
    errors.extend(compare_expected({"schema_version": 1, "method_order": list(METHODS), "metric_order": list(METRICS),
                                    "split": {"repetitions": 10, "seeds": list(SEEDS), "minimum_fold_overlap": 1, "near_bi_gap": 2}},
                                   manifest, "manifest"))
    if set(manifest.get("methods", {})) != set(METHODS) or set(manifest.get("metrics", {})) != set(METRICS):
        errors.append("manifest method/metric metadata mismatch")
    configurations = {row["exact_configuration"]: row for row in manifest["configurations"]}
    if set(configurations) != set(identities) or len(configurations) != len(manifest["configurations"]) or set(panels) != set(identities):
        errors.append("manifest/clean exact identities are not a one-to-one match with overview")
    if len({row["file"] for row in manifest["configurations"]}) != len(configurations):
        errors.append("manifest shard file collision")
    listed = {"manifest.json", *(row["file"] for row in manifest["configurations"])}
    actual_files = {str(path.relative_to(experiment_dir)) for path in experiment_dir.rglob("*.json")}
    if actual_files != listed:
        errors.append("new public JSON file set does not match manifest and exact-configuration shards")
    for name, rows in panels.items():
        if name not in catalog_points:
            continue
        point = catalog_points[name]
        if len(rows) != point["n_common"]:
            errors.append(f"{name}: clean support differs from catalog")
        keys = sorted(rows)
        for label, source in (("model", rows), ("matched_market", market)):
            raw = mean([(float(source[key]["prediction"]) - float(source[key]["outcome"])) ** 2 for key in keys])
            adjusted = mean(adjusted_losses(source, keys))
            errors.extend(compare_expected({"raw_brier": raw, "adjusted_brier": adjusted, "brier_index": brier_index(adjusted)},
                                           point[label], f"catalog.{name}.{label}", 1e-12))
    print(json.dumps({"stage": "clean_verified", "configurations": len(panels), "rows": sum(map(len, panels.values()))}), flush=True)
    supports: dict[tuple[str, str], dict[str, Any]] = {}
    file_reports = []
    ordered_status = Counter()
    for index, (name, config) in enumerate(configurations.items(), 1):
        errors.extend(compare_expected(identities[name], config, f"manifest.{name}"))
        shard_path = experiment_dir / config["file"]
        if not shard_path.resolve().is_relative_to(experiment_dir.resolve()):
            raise ValueError("shard path leaves experiment directory")
        payload = read_json(shard_path)
        errors.extend(compare_expected({"schema_version": 1, "base_configuration": name, "base": identities[name]}, payload, name))
        partners = {row["partner"]["exact_configuration"]: row for row in payload["partners"]}
        if set(partners) != set(identities) - {name} or len(partners) != len(payload["partners"]):
            errors.append(f"{name}: missing/duplicate/substituted partner identities")
        eligible = 0
        for partner, row in partners.items():
            if partner not in identities:
                continue
            errors.extend(compare_expected(identities[partner], row["partner"], f"{name}.{partner}.identity"))
            pair = tuple(sorted((name, partner)))
            if pair not in supports:
                supports[pair] = compact_support(panels[pair[0]], panels[pair[1]], market)
            support = supports[pair]
            errors.extend(compare_expected({field: support[field] for field in ("status", "n_common", "unique_event_count", "support_sha256")}, row, f"{name}.{partner}"))
            ordered_status[row["status"]] += 1
            eligible += row["status"] == "eligible"
            for sample in ("all", "near_bi"):
                for direction in ("combined", "a_to_b", "b_to_a"):
                    selected = selected_support(support["folds"], sample, direction)
                    errors.extend(audit_view_contract(row["views"][sample][direction], selected, f"{name}.{partner}.{sample}.{direction}"))
        errors.extend(compare_expected(eligible, config["eligible_partner_count"], f"{name}.eligible_partner_count"))
        file_reports.append({"file": config["file"], "partners": len(partners), "sha256": file_sha256(shard_path)})
        if index % 40 == 0:
            print(json.dumps({"stage": "shards", "checked": index, "errors": len(errors)}), flush=True)
    print(json.dumps({"stage": "all_shards_verified", "pairs": len(supports), "errors": len(errors)}), flush=True)
    sample_ids = sample_pairs(supports, sampled_pair_count)
    samples = []
    for first, second in sample_ids:
        sample_errors = []
        fold_count = 0
        for base, partner in ((first, second), (second, first)):
            payload = read_json(experiment_dir / configurations[base]["file"])
            actual = next(row for row in payload["partners"] if row["partner"]["exact_configuration"] == partner)
            folds = reference_folds(panels[base], panels[partner], market)
            fold_count = len(folds)
            sample_errors.extend(compare_expected(reference_views(folds), actual["views"], f"sample.{base}.{partner}"))
        samples.append({"first": first, "second": second, "n_common": supports[(first, second)]["n_common"],
                        "directions_per_base": fold_count, "passed": not sample_errors, "errors": sample_errors})
        errors.extend(sample_errors)
    fold_artifacts = audit_fold_artifacts(derived, supports, panels, market, sample_ids)
    errors.extend(fold_artifacts["errors"])
    baseline = read_json(baseline_path)["files"]
    old_changed = [relative for relative, expected in baseline.items()
                   if not (site_data / relative).is_file() or file_sha256(site_data / relative) != expected]
    errors.extend(f"pre-existing public JSON changed: {relative}" for relative in old_changed)
    statuses = Counter(row["status"] for row in supports.values())
    histogram = Counter(len(row["folds"]) for row in supports.values())
    expected_audit = {"configuration_count": len(configurations), "candidate_unordered_pairs": len(supports),
                      "unordered_pair_status_counts": dict(statuses), "unordered_fold_records": sum(len(row["folds"]) for row in supports.values()),
                      "configuration_target_rows": sum(map(len, panels.values()))}
    errors.extend(compare_expected(expected_audit, manifest["audit"], "manifest.audit"))
    return {"passed": not errors, "schema_version": 1, "audit": "Independent exact-configuration pair support, schema and sampled direct-array arithmetic",
            "auditor_sha256": file_sha256(Path(__file__)),
            "producer_sha256": recorded_producer,
            "baseline_public_sha256_manifest_sha256": file_sha256(baseline_path),
            "catalog_sha256": file_sha256(catalog_path), "manifest_sha256": file_sha256(experiment_dir / "manifest.json"),
            "clean_intermediate_sha256": file_sha256(derived / "clean_panel.csv.gz"),
            "configuration_count": len(configurations), "ordered_partner_records": sum(ordered_status.values()),
            "new_public_json_files": len(actual_files),
            "candidate_unordered_pairs": len(supports), "unordered_pair_status_counts": dict(statuses),
            "unordered_pair_fold_histogram": dict(sorted(histogram.items())),
            "clean_configuration_target_rows": sum(map(len, panels.values())),
            "catalog_score_checks": {"configurations": len(panels), "model_and_market_scalar_checks": len(panels) * 6, "tolerance": 1e-12},
            "high_support_eligible_pairs": sum(row["status"] == "eligible" and all(min(fold["n_train"], fold["n_test"]) >= 50 for fold in row["folds"])
                                                for row in supports.values()),
            "sampled_unordered_pairs": len(samples), "sampled_results": samples,
            "fold_artifacts": fold_artifacts,
            "pre_existing_public_json": {"checked": len(baseline), "changed_or_missing": old_changed, "passed": not old_changed},
            "shard_files": file_reports, "errors": errors,
            "limitations": ["Original processed forecast JSON was not re-read; the producer's provenance-cleaned intermediate is the numeric input.",
                            "Every public pair's identity, support, fold availability, train Near-BI mask and gain arithmetic is checked; complete forecast arithmetic is independently recomputed on the reported deterministic sample.",
                            "Repeated random event splits are not prospective temporal holdouts or independent repetitions."]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-data", type=Path, default=Path("site/public/data"))
    parser.add_argument("--derived", type=Path, default=Path("data/derived/configuration_pair_aggregation"))
    parser.add_argument("--catalog", type=Path, default=Path("site/public/data/polymarket-aggregation/market-diversity-performance.json"))
    parser.add_argument("--baseline", type=Path, default=Path("data/derived/configuration_pair_aggregation_audit/previous_public_sha256.json"))
    parser.add_argument("--sample-pairs", type=int, default=18)
    parser.add_argument("--output", type=Path, default=Path("data/derived/configuration_pair_aggregation_audit/report.json"))
    args = parser.parse_args()
    report = audit_artifacts(args.site_data, args.derived, args.catalog, args.baseline, sampled_pair_count=args.sample_pairs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({field: report[field] for field in ("passed", "configuration_count", "ordered_partner_records", "sampled_unordered_pairs")}), flush=True)
    if not report["passed"]:
        raise SystemExit("Configuration-pair audit failed; inspect the report")


if __name__ == "__main__":
    main()
