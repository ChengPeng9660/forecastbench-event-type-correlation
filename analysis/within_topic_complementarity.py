"""Build the within-topic POG complementarity experiment.

The pair and topic screen is training-only.  Exact model-version, prompt, and
information configurations are retained.  Existing aggregation formulas are
reused without modification and evaluated on the event-disjoint test half.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import shutil

import numpy as np
import pandas as pd


SEEDS = list(range(20260910, 20260915))
PRIMARY_SEED = SEEDS[0]
PRIMARY_FOLD = 0
METHODS = [
    ("simple_mean", "Simple mean"),
    ("log_odds_mean", "Log-odds mean"),
    ("ec_w0_56", "EC · w = 0.56"),
    ("piecewise_odds", "Piecewise odds"),
    ("cf_directional", "Directional CF"),
]
METHOD_IDS = [item[0] for item in METHODS]
TOPICS = [
    ("health", "Health"),
    ("politics", "Politics"),
    ("sports", "Sports"),
    ("finance", "Finance"),
    ("technology", "Technology"),
    ("climate_weather", "Climate / Weather"),
    ("entertainment_culture", "Entertainment / Culture"),
]
TOPIC_IDS = {item[0] for item in TOPICS}
OVERALL_GAPS = [3.0, 5.0]
TOPIC_GAPS = [1.0, 2.0, 3.0]
SUPPORTS = [20, 30, 50]
PAIR_SCOPES = ["all", "different_model_version", "matched_conditions"]
MIN_SOURCE_TRAIN_EVENTS = min(SUPPORTS)
MIN_TEST_EVENTS = 20
EPS = 1e-10


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def split_events(events: list[tuple[str, str]], seed: int) -> np.ndarray:
    return np.asarray([
        int.from_bytes(
            hashlib.sha256(f"{seed}|{source.casefold()}|{event_id}".encode()).digest()[:8],
            "big",
        ) % 2
        for source, event_id in events
    ], dtype=np.int8)


def bi(adjusted_loss: np.ndarray | float) -> np.ndarray:
    loss = np.asarray(adjusted_loss, dtype=float)
    return 100 * (1 - np.sqrt(np.where(loss >= 0, loss, np.nan)))


def score(prediction: np.ndarray, outcome: np.ndarray, offset: np.ndarray) -> dict[str, np.ndarray]:
    prediction = np.asarray(prediction, dtype=float)
    if prediction.ndim == 1:
        prediction = prediction[:, None]
    raw = np.mean((prediction - outcome[:, None]) ** 2, axis=0)
    adjusted = raw + float(np.mean(offset))
    return {"raw": raw, "adjusted": adjusted, "bi": bi(adjusted)}


def directional_weights(p0: np.ndarray, p1: np.ndarray, outcome: np.ndarray) -> list[float]:
    difference = p1 - p0
    result = []
    for mask in (difference >= 0, difference < 0):
        numerator = float(np.mean(np.where(mask, (outcome - p0) * difference, 0.0)))
        denominator = float(np.mean(np.where(mask, difference**2, 0.0)))
        result.append(float(np.clip(numerator / denominator, 0, 1)) if denominator > 0 else 0.0)
    return result


def pool(p0: np.ndarray, p1: np.ndarray, alpha: list[float]) -> np.ndarray:
    p0, p1 = np.asarray(p0), np.asarray(p1)
    q0, q1 = np.clip(p0, 1e-6, 1 - 1e-6), np.clip(p1, 1e-6, 1 - 1e-6)
    summed_odds = np.log(q0 / (1 - q0)) + np.log(q1 / (1 - q1))
    boundary = math.log(5)
    piecewise = np.where(
        summed_odds <= -boundary,
        summed_odds + boundary / 2,
        np.where(summed_odds >= boundary, summed_odds - boundary / 2, summed_odds / 2),
    )
    sigmoid = lambda value: 1 / (1 + np.exp(-value))
    directional = p0 + np.where(p1 >= p0, alpha[0], alpha[1]) * (p1 - p0)
    return np.column_stack([
        (p0 + p1) / 2,
        sigmoid(summed_odds / 2),
        sigmoid(0.56 * summed_odds),
        sigmoid(piecewise),
        directional,
    ])


def pog_metrics(prediction_a: np.ndarray, prediction_b: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    loss_a = (prediction_a - outcome) ** 2
    loss_b = (prediction_b - outcome) ** 2
    delta = loss_a - loss_b
    a_rescue = float(np.mean(np.maximum(-delta, 0)))
    b_rescue = float(np.mean(np.maximum(delta, 0)))
    adjusted_pog = min(a_rescue, b_rescue)
    mean_raw_loss = float(np.mean((loss_a + loss_b) / 2))
    normalized_pog = adjusted_pog / mean_raw_loss if mean_raw_loss > 0 else np.nan
    tie = np.isclose(delta, 0.0, atol=1e-12, rtol=0)
    return {
        "train_adjusted_pog": adjusted_pog,
        "train_normalized_pog": normalized_pog,
        "train_a_rescue": a_rescue,
        "train_b_rescue": b_rescue,
        "train_a_win_share": float(np.mean((delta < -1e-12) & ~tie)),
        "train_b_win_share": float(np.mean((delta > 1e-12) & ~tie)),
        "train_tie_share": float(np.mean(tie)),
        "train_mean_raw_loss": mean_raw_loss,
    }


def same_scope(row: pd.Series, scope: str) -> bool:
    if scope == "all":
        return True
    if scope == "different_model_version":
        return not bool(row.same_model_version)
    if scope == "matched_conditions":
        return bool(row.same_prompt) and bool(row.same_information)
    raise ValueError(scope)


def finite_mean(series: pd.Series) -> float:
    values = pd.to_numeric(series, errors="coerce").dropna()
    return float(values.mean()) if len(values) else np.nan


def correlation(frame: pd.DataFrame, x: str, y: str, method: str) -> float:
    subset = frame[[x, y]].replace([np.inf, -np.inf], np.nan).dropna()
    if len(subset) < 2 or subset[x].nunique() < 2 or subset[y].nunique() < 2:
        return np.nan
    first = subset[x].rank(method="average").to_numpy() if method == "spearman" else subset[x].to_numpy()
    second = subset[y].rank(method="average").to_numpy() if method == "spearman" else subset[y].to_numpy()
    first = first - first.mean()
    second = second - second.mean()
    denominator = float(np.sqrt((first @ first) * (second @ second)))
    return float(first @ second / denominator) if denominator > 0 else np.nan


def summarize(frame: pd.DataFrame) -> pd.DataFrame:
    result: list[dict[str, object]] = []
    for scope in PAIR_SCOPES:
      scoped = frame
      if scope == "different_model_version":
          scoped = frame[~frame.same_model_version.eq(True)]
      elif scope == "matched_conditions":
          scoped = frame[frame.same_prompt.eq(True) & frame.same_information.eq(True)]
      for overall_gap, topic_gap, support in itertools.product(OVERALL_GAPS, TOPIC_GAPS, SUPPORTS):
        selected = scoped[
            (scoped.train_overall_gap <= overall_gap + 1e-12)
            & (scoped.train_topic_gap <= topic_gap + 1e-12)
            & (scoped.train_topic_events >= support)
        ]
        for metric in ["adjusted_pog", "normalized_pog"]:
          x = f"train_{metric}"
          ranked = selected[["id", x]].replace([np.inf, -np.inf], np.nan).dropna()
          ranked = ranked.sort_values([x, "id"], ascending=[False, True])
          top_count = max(1, math.ceil(len(ranked) / 4)) if len(ranked) else 0
          top_ids = set(ranked.head(top_count).id)
          for method in METHOD_IDS:
            for outcome in ["topic", "overall"]:
              gain = f"{method}_{outcome}_gain_best_bi"
              defined = selected[["id", gain, x]].replace([np.inf, -np.inf], np.nan).dropna()
              top = defined[defined.id.isin(top_ids)]
              result.append({
                  "pair_scope": scope,
                  "overall_gap": overall_gap,
                  "topic_gap": topic_gap,
                  "support": support,
                  "method": method,
                  "outcome": outcome,
                  "metric": metric,
                  "n": len(selected),
                  "n_defined": len(defined),
                  "mean_gain_bi": finite_mean(defined[gain]),
                  "beats_both_rate": float(defined[gain].gt(EPS).mean()) if len(defined) else np.nan,
                  "top_quartile_n": top_count,
                  "top_quartile_n_defined": len(top),
                  "top_quartile_mean_gain_bi": finite_mean(top[gain]),
                  "top_quartile_beats_both_rate": float(top[gain].gt(EPS).mean()) if len(top) else np.nan,
                  "pearson": correlation(defined, x, gain, "pearson"),
                  "spearman": correlation(defined, x, gain, "spearman"),
              })
    return pd.DataFrame(result)


def evaluate(source: Path, destination: Path) -> tuple[pd.DataFrame, dict[str, object]]:
    data = source / "data"
    results = source / "results"
    source_audit = json.loads((results / "audit.json").read_text())
    source_independent = json.loads((results / "independent_audit.json").read_text())
    if source_audit.get("panel_sha256") != digest(data / "panel.npz"):
        raise ValueError("source panel hash does not match the audited all-configuration study")
    if not source_audit.get("train_selection_only") or not source_audit.get("no_test_gap_filter"):
        raise ValueError("source pair study is not training-only")
    if source_independent.get("status") != "PASS":
        raise ValueError("source aggregation study independent audit did not pass")

    arrays = np.load(data / "panel.npz")
    predictions = arrays["predictions"]
    outcome = arrays["outcome"]
    offset = arrays["offset"]
    origin = arrays["origin"]
    event = arrays["event"]
    topic = arrays["topic"]
    models = json.loads((data / "models.json").read_text())
    identities_list = json.loads((data / "configurations.json").read_text())
    identities = {row["exact_configuration"]: row for row in identities_list}
    events = list(pd.read_csv(data / "events.csv", dtype=str, keep_default_na=False).itertuples(index=False, name=None))
    splits = {seed: split_events(events, seed)[event] for seed in SEEDS}

    usecols = [
        "id", "pair_id", "split", "fold", "i", "j", "model_a", "model_b",
        "train_events", "test_events", "train_rows", "test_rows", "train_gap",
        "mean_train_bi", "train_bi_a", "train_bi_b", "test_bi_a", "test_bi_b",
        "alpha_up", "alpha_down",
        "same_provider", "same_model_version", "same_prompt", "same_information",
        "provider_a", "provider_b", "canonical_model_version_a", "canonical_model_version_b",
        "prompt_type_a", "prompt_type_b", "information_type_a", "information_type_b",
        *[f"{method}_bi" for method in METHOD_IDS],
    ]
    pair_frame = pd.read_csv(results / "pair_results.csv.gz", usecols=usecols, dtype={"split": str})
    pair_frame = pair_frame[pair_frame.id.str.len().gt(0)].drop_duplicates("id").sort_values(["i", "j", "split", "fold"])
    if len(pair_frame) != source_audit["retained_pair_directions"]:
        raise ValueError("source direction count changed")

    rows: list[dict[str, object]] = []
    max_aggregation_error = float(source_independent["maximum_absolute_error"])
    event_overlap_failures = int(source_audit["event_overlap_failures"])
    pog_identity_error = 0.0
    groups = pair_frame.groupby(["i", "j"], sort=False)
    for pair_number, ((i, j), pair_rows) in enumerate(groups, start=1):
        common = np.flatnonzero(np.isfinite(predictions[:, i]) & np.isfinite(predictions[:, j]))
        for pair in pair_rows.itertuples(index=False):
            seed, fold = int(pair.split), int(pair.fold)
            split = splits[seed]
            train = common[split[common] == fold]
            test = common[split[common] != fold]
            better, other = (i, j) if pair.train_bi_a >= pair.train_bi_b else (j, i)
            alpha = [float(pair.alpha_up), float(pair.alpha_down)]
            test_pooled = pool(predictions[test, better], predictions[test, other], alpha)

            for topic_id, _label in TOPICS:
                train_topic = train[topic[train] == topic_id]
                train_topic_events = len(np.unique(event[train_topic]))
                if train_topic_events < MIN_SOURCE_TRAIN_EVENTS:
                    continue
                train_topic_score = score(
                    predictions[train_topic][:, [i, j]], outcome[train_topic], offset[train_topic]
                )
                topic_gap = abs(float(train_topic_score["bi"][0] - train_topic_score["bi"][1]))
                if not np.isfinite(topic_gap) or topic_gap > max(TOPIC_GAPS) + 1e-12:
                    continue
                pog = pog_metrics(predictions[train_topic, i], predictions[train_topic, j], outcome[train_topic])
                pog_identity_error = max(
                    pog_identity_error,
                    abs(pog["train_adjusted_pog"] - min(pog["train_a_rescue"], pog["train_b_rescue"])),
                )

                test_mask = topic[test] == topic_id
                test_topic = test[test_mask]
                test_topic_events = len(np.unique(event[test_topic]))
                test_topic_single = None
                test_topic_methods = None
                if test_topic_events >= MIN_TEST_EVENTS:
                    test_topic_single = score(
                        predictions[test_topic][:, [i, j]], outcome[test_topic], offset[test_topic]
                    )
                    test_topic_methods = score(
                        test_pooled[test_mask], outcome[test_topic], offset[test_topic]
                    )

                record: dict[str, object] = {
                    "id": f"{pair.id}:{topic_id}",
                    "direction_id": pair.id,
                    "pair_id": pair.pair_id,
                    "split": pair.split,
                    "fold": pair.fold,
                    "i": i,
                    "j": j,
                    "topic": topic_id,
                    "model_a": pair.model_a,
                    "model_b": pair.model_b,
                    "train_overall_events": pair.train_events,
                    "test_overall_events": pair.test_events,
                    "train_topic_events": train_topic_events,
                    "test_topic_events": test_topic_events,
                    "train_topic_rows": len(train_topic),
                    "test_topic_rows": len(test_topic),
                    "train_overall_gap": pair.train_gap,
                    "train_mean_bi": pair.mean_train_bi,
                    "train_topic_gap": topic_gap,
                    "train_bi_a": pair.train_bi_a,
                    "train_bi_b": pair.train_bi_b,
                    "train_topic_bi_a": float(train_topic_score["bi"][0]),
                    "train_topic_bi_b": float(train_topic_score["bi"][1]),
                    "test_bi_a": pair.test_bi_a,
                    "test_bi_b": pair.test_bi_b,
                    "test_topic_bi_a": float(test_topic_single["bi"][0]) if test_topic_single is not None else np.nan,
                    "test_topic_bi_b": float(test_topic_single["bi"][1]) if test_topic_single is not None else np.nan,
                    "test_topic_support_ok": test_topic_events >= MIN_TEST_EVENTS,
                    "alpha_up": alpha[0],
                    "alpha_down": alpha[1],
                    "train_origin_dataset_fraction": float(np.mean(origin[train_topic] == 0)),
                    "same_provider": pair.same_provider,
                    "same_model_version": pair.same_model_version,
                    "same_prompt": pair.same_prompt,
                    "same_information": pair.same_information,
                    "provider_a": pair.provider_a,
                    "provider_b": pair.provider_b,
                    "canonical_model_version_a": pair.canonical_model_version_a,
                    "canonical_model_version_b": pair.canonical_model_version_b,
                    "prompt_type_a": pair.prompt_type_a,
                    "prompt_type_b": pair.prompt_type_b,
                    "information_type_a": pair.information_type_a,
                    "information_type_b": pair.information_type_b,
                    **pog,
                }
                whole_best = max(float(pair.test_bi_a), float(pair.test_bi_b))
                topic_best = (
                    max(float(test_topic_single["bi"][0]), float(test_topic_single["bi"][1]))
                    if test_topic_single is not None else np.nan
                )
                for index, method in enumerate(METHOD_IDS):
                    whole_bi = float(getattr(pair, f"{method}_bi"))
                    topic_bi = float(test_topic_methods["bi"][index]) if test_topic_methods is not None else np.nan
                    record[f"{method}_overall_bi"] = whole_bi
                    record[f"{method}_overall_gain_best_bi"] = whole_bi - whole_best
                    record[f"{method}_topic_bi"] = topic_bi
                    record[f"{method}_topic_gain_best_bi"] = topic_bi - topic_best if np.isfinite(topic_bi) else np.nan
                rows.append(record)
        if pair_number % 750 == 0:
            print(f"within-topic pairs {pair_number:,}/{len(groups):,}; retained rows {len(rows):,}", flush=True)

    frame = pd.DataFrame(rows)
    primary = frame[(frame.split == str(PRIMARY_SEED)) & (frame.fold == PRIMARY_FOLD)].copy()
    destination.mkdir(parents=True, exist_ok=True)
    frame.to_csv(destination / "pair_topic_directions.csv.gz", index=False)
    primary.to_csv(destination / "primary_pair_topics.csv.gz", index=False)
    summary = summarize(frame)
    primary_summary = summarize(primary)
    summary.to_csv(destination / "direction_pooled_summary.csv", index=False)
    primary_summary.to_csv(destination / "primary_summary.csv", index=False)

    audit: dict[str, object] = {
        "status": "PASS" if event_overlap_failures == 0 and max_aggregation_error < 1e-8 and pog_identity_error < 1e-12 else "FAIL",
        "unit": "exact model version x prompt x information condition x topic x split direction",
        "weighting": "uniform common-target rows within each selected topic",
        "official_question_offsets_retained_for_bi": True,
        "pog_offset_cancellation": "the same question offset cancels exactly from pairwise loss differences",
        "seeds": SEEDS,
        "primary_seed": PRIMARY_SEED,
        "primary_fold": PRIMARY_FOLD,
        "train_only_filters": ["overall BI gap", "topic BI gap", "train topic events", "pair scope", "within-topic POG rank"],
        "test_filters_used_for_selection": [],
        "minimum_source_train_topic_events": MIN_SOURCE_TRAIN_EVENTS,
        "minimum_defined_test_topic_events": MIN_TEST_EVENTS,
        "source_pair_directions": len(pair_frame),
        "output_pair_topic_directions": len(frame),
        "primary_pair_topics": len(primary),
        "event_overlap_failures": event_overlap_failures,
        "max_existing_aggregation_bi_error": max_aggregation_error,
        "max_pog_identity_error": pog_identity_error,
        "panel_sha256": digest(data / "panel.npz"),
        "source_pair_results_sha256": digest(results / "pair_results.csv.gz"),
        "source_independent_audit_sha256": digest(results / "independent_audit.json"),
        "configuration_catalog_sha256": digest(data / "configurations.json"),
    }
    (destination / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    if audit["status"] != "PASS":
        raise AssertionError(f"within-topic audit failed: {audit}")
    return frame, audit


def finalize_saved(source: Path, destination: Path) -> dict[str, object]:
    """Create summaries and audit from safely persisted detail rows."""
    frame = pd.read_csv(destination / "pair_topic_directions.csv.gz", dtype={"split": str})
    primary = pd.read_csv(destination / "primary_pair_topics.csv.gz", dtype={"split": str})
    source_audit = json.loads((source / "results/audit.json").read_text())
    source_independent = json.loads((source / "results/independent_audit.json").read_text())
    summary = summarize(frame)
    primary_summary = summarize(primary)
    summary.to_csv(destination / "direction_pooled_summary.csv", index=False)
    primary_summary.to_csv(destination / "primary_summary.csv", index=False)
    pog_error = float(np.max(np.abs(
        frame.train_adjusted_pog.to_numpy()
        - np.minimum(frame.train_a_rescue.to_numpy(), frame.train_b_rescue.to_numpy())
    ))) if len(frame) else 0.0
    audit: dict[str, object] = {
        "status": "PASS" if source_audit["event_overlap_failures"] == 0 and pog_error < 1e-12 else "FAIL",
        "unit": "exact model version x prompt x information condition x topic x split direction",
        "weighting": "uniform common-target rows within each selected topic",
        "official_question_offsets_retained_for_bi": True,
        "pog_offset_cancellation": "the same question offset cancels exactly from pairwise loss differences",
        "seeds": SEEDS,
        "primary_seed": PRIMARY_SEED,
        "primary_fold": PRIMARY_FOLD,
        "train_only_filters": ["overall BI gap", "topic BI gap", "train topic events", "pair scope", "within-topic POG rank"],
        "test_filters_used_for_selection": [],
        "minimum_source_train_topic_events": MIN_SOURCE_TRAIN_EVENTS,
        "minimum_defined_test_topic_events": MIN_TEST_EVENTS,
        "source_pair_directions": source_audit["retained_pair_directions"],
        "output_pair_topic_directions": len(frame),
        "primary_pair_topics": len(primary),
        "event_overlap_failures": source_audit["event_overlap_failures"],
        "max_existing_aggregation_bi_error": source_independent["maximum_absolute_error"],
        "max_pog_identity_error": pog_error,
        "panel_sha256": digest(source / "data/panel.npz"),
        "source_pair_results_sha256": digest(source / "results/pair_results.csv.gz"),
        "source_independent_audit_sha256": digest(source / "results/independent_audit.json"),
        "configuration_catalog_sha256": digest(source / "data/configurations.json"),
        "finalized_from_persisted_detail": True,
    }
    (destination / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    if audit["status"] != "PASS":
        raise AssertionError(audit)
    return audit


def to_json_value(value):
    if value is None:
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(float(value)) else None
    return value


def stable_pair_topic_id(model_a: str, model_b: str, topic: str) -> str:
    names = sorted((model_a, model_b), key=lambda value: (value.casefold(), value))
    return "wt-" + hashlib.sha256("\0".join([*names, topic]).encode()).hexdigest()[:14]


def public_pair(row: pd.Series) -> dict[str, object]:
    keys = [
        "topic", "model_a", "model_b", "train_overall_events", "test_overall_events",
        "train_topic_events", "test_topic_events", "train_topic_rows", "test_topic_rows",
        "train_overall_gap", "train_mean_bi", "train_topic_gap", "train_bi_a", "train_bi_b",
        "train_topic_bi_a", "train_topic_bi_b", "test_bi_a", "test_bi_b",
        "test_topic_bi_a", "test_topic_bi_b", "test_topic_support_ok",
        "train_adjusted_pog", "train_normalized_pog", "train_a_rescue", "train_b_rescue",
        "train_a_win_share", "train_b_win_share", "train_tie_share", "train_mean_raw_loss",
        "alpha_up", "alpha_down", "train_origin_dataset_fraction", "same_provider",
        "same_model_version", "same_prompt", "same_information",
    ]
    result = {key: to_json_value(row[key]) for key in keys}
    result["id"] = stable_pair_topic_id(str(row.model_a), str(row.model_b), str(row.topic))
    result["methods"] = {
        method: {
            "topic_bi": to_json_value(row[f"{method}_topic_bi"]),
            "overall_bi": to_json_value(row[f"{method}_overall_bi"]),
        }
        for method in METHOD_IDS
    }
    return result


def export_site(source: Path, experiment_output: Path, site_destination: Path) -> dict[str, object]:
    audit = json.loads((experiment_output / "audit.json").read_text())
    independent = json.loads((experiment_output / "independent_audit.json").read_text())
    validation = json.loads((experiment_output / "validation.json").read_text())
    data_audit = json.loads((source / "data/audit.json").read_text())
    if audit.get("status") != "PASS" or audit.get("test_filters_used_for_selection") != []:
        raise ValueError("within-topic experiment audit did not pass")
    if independent.get("status") != "PASS" or not independent.get("implementation_independent"):
        raise ValueError("independent within-topic numerical audit did not pass")
    if validation.get("status") != "PASS":
        raise ValueError("within-topic descriptive validation did not pass")
    configurations = json.loads((source / "data/configurations.json").read_text())
    models = json.loads((source / "data/models.json").read_text())
    if [row["exact_configuration"] for row in configurations] != models:
        raise ValueError("configuration order differs from panel columns")
    frame = pd.read_csv(experiment_output / "primary_pair_topics.csv.gz", dtype={"split": str})
    summaries = pd.read_csv(experiment_output / "direction_pooled_summary.csv")
    primary_summaries = pd.read_csv(experiment_output / "primary_summary.csv")

    if site_destination.exists():
        shutil.rmtree(site_destination)
    focal_dir = site_destination / "focals"
    focal_dir.mkdir(parents=True)
    focal_files: dict[str, str] = {}
    public_rows = [public_pair(row) for _, row in frame.iterrows()]
    by_focal: dict[str, list[dict[str, object]]] = {model: [] for model in models}
    for row in public_rows:
        by_focal[str(row["model_a"])].append(row)
        by_focal[str(row["model_b"])].append(row)
    for index, model in enumerate(models):
        name = f"{index:03d}.json"
        focal_files[model] = f"focals/{name}"
        payload = {
            "schema_version": 1,
            "focal": model,
            "pairs": sorted(by_focal[model], key=lambda item: (str(item["topic"]), -float(item["train_normalized_pog"] or -1), str(item["id"]))),
        }
        (focal_dir / name).write_text(json.dumps(payload, separators=(",", ":")))

    summary_keys = [
        "pair_scope", "overall_gap", "topic_gap", "support", "method", "outcome", "metric",
        "n", "n_defined", "mean_gain_bi", "beats_both_rate", "top_quartile_n",
        "top_quartile_n_defined", "top_quartile_mean_gain_bi", "top_quartile_beats_both_rate", "pearson", "spearman",
    ]
    convert_summary = lambda row: {key: to_json_value(row[key]) for key in summary_keys}
    payload = {
        "schema_version": 1,
        "study": "within_topic_pog_complementarity_all_configurations_2026-09-01",
        "date": "2026-09-01",
        "primary_split": str(PRIMARY_SEED),
        "primary_fold": PRIMARY_FOLD,
        "weighting": "uniform_rows_within_topic",
        "event_split": "event-disjoint deterministic halves",
        "event_type_taxonomy": "forecastbench-seven-domain-v1.0.0",
        "topics": [{"id": key, "label": label} for key, label in TOPICS],
        "overall_gap_thresholds": [int(value) for value in OVERALL_GAPS],
        "topic_gap_thresholds": [int(value) for value in TOPIC_GAPS],
        "support_thresholds": SUPPORTS,
        "test_topic_support": MIN_TEST_EVENTS,
        "pair_scopes": [
            {"id": "all", "label": "All exact configurations"},
            {"id": "different_model_version", "label": "Different model versions"},
            {"id": "matched_conditions", "label": "Same prompt + information"},
        ],
        "methods": [{"id": key, "label": label} for key, label in METHODS],
        "metrics": [
            {"id": "normalized_pog", "label": "Normalized POG"},
            {"id": "adjusted_pog", "label": "Adjusted POG"},
        ],
        "outcomes": [
            {"id": "topic", "label": "Selected-topic gain"},
            {"id": "overall", "label": "Whole-test gain"},
        ],
        "configurations": configurations,
        "focal_files": focal_files,
        "summaries": [convert_summary(row) for _, row in summaries.iterrows()],
        "primary_summaries": [convert_summary(row) for _, row in primary_summaries.iterrows()],
        "validation": validation,
        "sample": {
            "configurations": len(models),
            "canonical_model_versions": len({row["canonical_model_version"] for row in configurations}),
            "events": data_audit["events"],
            "targets": data_audit["targets"],
            "pair_topic_directions": audit["output_pair_topic_directions"],
            "primary_pair_topics": audit["primary_pair_topics"],
            "split_directions": len(SEEDS) * 2,
        },
        "audit": {
            "status": "PASS",
            "event_disjointness": "PASS",
            "implementation_independent": True,
            "independent_sampled_rows": independent["sampled_pair_topic_directions"],
            "independent_maximum_absolute_error": independent["maximum_absolute_error"],
            "train_only_selection": True,
            "no_test_gap_filter": True,
            "max_existing_aggregation_bi_error": audit["max_existing_aggregation_bi_error"],
            "max_pog_identity_error": audit["max_pog_identity_error"],
        },
        "provenance": {
            "panel_sha256": audit["panel_sha256"],
            "source_pair_results_sha256": audit["source_pair_results_sha256"],
            "primary_pair_topics_sha256": digest(experiment_output / "primary_pair_topics.csv.gz"),
        },
    }
    (site_destination / "study.json").write_text(json.dumps(payload, separators=(",", ":")))
    for name in ["README.md", "PROTOCOL.md", "REPORT.md", "REPRODUCE.md"]:
        shutil.copyfile(experiment_output / name, site_destination / name)
    shutil.copyfile(experiment_output / "independent_audit.json", site_destination / "independent_audit.json")
    license_source = Path(__file__).resolve().parents[1] / "LICENSE-DATA.md"
    shutil.copyfile(license_source, site_destination / "LICENSE-DATA.md")
    manifest = {
        "study": payload["study"],
        "generated_from_audited_outputs": True,
        "files": {},
    }
    for path in sorted(site_destination.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            manifest["files"][str(path.relative_to(site_destination))] = {
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
    (site_destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {
        "focals": len(focal_files),
        "primary_pair_topics": len(frame),
        "public_pair_references": sum(len(value) for value in by_focal.values()),
        "bytes": sum(path.stat().st_size for path in site_destination.rglob("*") if path.is_file()),
    }


def write_docs(destination: Path, audit: dict[str, object]) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    protocol = f"""# Within-topic POG complementarity protocol

## Question

Can two exact model configurations have similar overall and within-topic ability, yet make their smaller errors on different forecast targets inside that topic, and does that training pattern predict held-out aggregation gain?

## Unit and data

The unit is an exact model version x prompt x information condition pair, a seven-domain topic, and one fixed train-to-test direction. The frozen panel contains 313 configurations, 26,531 targets, and 3,670 events. No imputed forecasts are used.

## Split and selection

Five deterministic event-level half splits yield ten directions. Events never cross train and test. Partner eligibility uses only training data: overall adjusted-BI gap <= 3 or <= 5, topic adjusted-BI gap <= 1, <= 2, or <= 3, at least 20, 30, or 50 training events in the selected topic, and the requested exact-configuration scope. Test support and outcomes never select or rank a pair.

## Within-topic POG

For target i in topic g, let L_Ai and L_Bi be squared Brier losses. The official question fixed effect is identical for both models on the same target and therefore cancels in their loss difference. Define

    POG_g = min(mean((L_B-L_A)_+), mean((L_A-L_B)_+)).

This equals min(mean adjusted loss A, mean adjusted loss B) minus the mean per-target oracle adjusted loss. It is positive only when each model rescues some loss from the other. Normalized POG divides POG by the two-model mean raw Brier loss within the topic. This normalization reduces scale differences after the BI-gap controls; it does not turn the oracle into a deployable router.

## Evaluation

Partners are ranked by training POG. The five existing aggregation formulas are unchanged: Simple mean, Log-odds mean, EC w=0.56, Piecewise odds, and Directional CF. Their outputs are evaluated on the other event half against the better of the two single models on either the selected topic or the whole test support. A selected-topic outcome is reported only with at least {MIN_TEST_EVENTS} test events; this affects whether Y is defined, never pair selection.

## Weighting and dependence

Every common target row receives equal weight within the evaluated sample. There is no Dataset/Market rebalancing. Repeated split directions and pairs reuse events and are not independent observations. Correlations and win rates are descriptive.
"""
    readme = f"""# Within-topic POG complementarity

This package tests question-level reciprocal error correction inside a topic after controlling both overall and topic ability.

- Source pair directions: {audit['source_pair_directions']:,}
- Retained pair-topic directions with topic BI gap <= 3 and >= {MIN_SOURCE_TRAIN_EVENTS} training events: {audit['output_pair_topic_directions']:,}
- Primary pair-topic rows: {audit['primary_pair_topics']:,}
- Event-disjointness failures: {audit['event_overlap_failures']}
- Maximum difference from the existing aggregation outputs: {audit['max_existing_aggregation_bi_error']:.3e}
- Maximum POG identity error: {audit['max_pog_identity_error']:.3e}

Run `python analysis/within_topic_complementarity.py --source-study ... --output ... --site-destination ...` from the website repository.
"""
    report = """# Within-topic POG complementarity results

## Main result

The pre-specified main screen requires overall training BI gap <= 3, within-topic training BI gap <= 1, and at least 30 training events in the topic. Under Directional CF and selected-topic evaluation, 85,113 pair-topic-direction rows pass the training screen and 84,626 have a defined held-out topic outcome.

Normalized POG is positively associated with held-out aggregation gain. All eligible rows average +0.232 BI versus the better test single. The training top-POG quartile averages +0.619 BI and beats both test models in 67.3% of defined rows. The top-minus-all gain difference is positive in all ten fixed split directions.

This pattern remains after a descriptive linear adjustment for overall mean BI, within-topic mean BI, both BI gaps, log topic support, topic fixed effects, and split-direction fixed effects: standardized normalized-POG beta = +0.170 and incremental R2 = 0.023. Normalized POG has correlation +0.011 with overall mean training BI and +0.175 with within-topic mean BI under the main screen.

## Why normalization matters

Raw Adjusted POG is more predictive in this sample: its Directional-CF top quartile averages +0.643 BI, standardized adjusted coefficient is +0.352, and incremental R2 is 0.067. But raw POG correlates -0.589 with mean topic BI, showing substantial remaining loss-scale/ability association. Normalized POG reduces this association while retaining positive OOS screening value. The clean claim is therefore not that POG is ability-free; it is that explicit overall/topic ability gates plus loss normalization materially reduce the confound and leave useful held-out signal.

## Aggregation methods

For normalized-POG top-quartile rows on the selected topic, mean gains versus the better single are -0.006 BI for Simple mean, +0.210 for Log-odds mean, +0.297 for EC w=0.56, +0.354 for Piecewise odds, and +0.619 for Directional CF. The ranking screen does not change any aggregation formula.

## Topic heterogeneity

The normalized-POG Directional-CF pattern is strongest in Politics (+1.252 BI top quartile versus +0.712 all eligible), Finance (+0.381 versus +0.133), Health (+0.192 versus +0.025), and Climate / Weather (+0.221 versus -0.042). It does not generalize uniformly: Sports is negative (-0.126 top quartile versus -0.049 all), while Technology and Entertainment / Culture have very small main-screen samples and negative estimates. These sparse or negative domains should be shown rather than pooled away.

## Interpretation limits

POG is a retrospective oracle diagnostic, not a deployable question router. Pair rows and split directions reuse events, so counts are not independent trials and no significance claim is made. Top-quartile comparisons are ranked only by training POG; held-out outcomes never choose partners. The results support within-topic reciprocal error correction as a screening idea, with clear domain and method dependence.
"""
    reproduce = """# Reproduce the within-topic POG experiment

From the website repository, using a Python environment with NumPy and pandas:

```bash
python analysis/within_topic_complementarity.py \\
  --source-study /absolute/path/to/outputs/complementarity_all_configurations_2026-09-01 \\
  --output /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01 \\
  --site-destination site/public/data/within-topic-complementarity

python analysis/audit_within_topic_complementarity.py \\
  --source-study /absolute/path/to/outputs/complementarity_all_configurations_2026-09-01 \\
  --experiment /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01 \\
  --sample 256

python analysis/validate_within_topic_complementarity.py \\
  --experiment /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01

python analysis/within_topic_complementarity.py \\
  --source-study /absolute/path/to/outputs/complementarity_all_configurations_2026-09-01 \\
  --output /absolute/path/to/outputs/within_topic_pog_all_configurations_2026-09-01 \\
  --site-destination site/public/data/within-topic-complementarity \\
  --reuse
```

The final reuse step exports only after both the main and implementation-independent audits pass. Check `artifact_manifest.json` and the public `manifest.json` for file hashes.
"""
    (destination / "PROTOCOL.md").write_text(protocol)
    (destination / "README.md").write_text(readme)
    (destination / "REPORT.md").write_text(report)
    (destination / "REPRODUCE.md").write_text(reproduce)


def build_manifest(destination: Path) -> None:
    files = {}
    for path in sorted(destination.rglob("*")):
        if path.is_file() and path.name != "artifact_manifest.json":
            files[str(path.relative_to(destination))] = {
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
    (destination / "artifact_manifest.json").write_text(json.dumps({"files": files}, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-study", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--site-destination", type=Path, required=True)
    parser.add_argument("--reuse", action="store_true")
    parser.add_argument("--reuse-details", action="store_true")
    args = parser.parse_args()
    source = args.source_study.resolve()
    output = args.output.resolve()
    if args.reuse:
        audit = json.loads((output / "audit.json").read_text())
        if audit.get("status") != "PASS":
            raise ValueError("reused experiment audit did not pass")
    elif args.reuse_details:
        audit = finalize_saved(source, output)
        write_docs(output, audit)
        build_manifest(output)
    else:
        _frame, audit = evaluate(source, output)
        write_docs(output, audit)
        build_manifest(output)
    result = export_site(source, output, args.site_destination.resolve())
    print(json.dumps({"audit": audit, "site": result}, indent=2), flush=True)


if __name__ == "__main__":
    main()
