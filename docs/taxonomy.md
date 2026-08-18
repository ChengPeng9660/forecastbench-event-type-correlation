# Auditable event taxonomy

## Design principle

The taxonomy has two layers that must not be conflated:

1. **Official provenance**: `origin_type` (`Dataset` or `Market`) and
   `official_source`. These fields are a deterministic normalization of the
   upstream `source` value; they are not inferred from question text.
2. **Derived semantic topic**: `derived_topic` and `derived_subtopic`. These
   fields are produced by versioned, inspectable rules in
   `analysis/taxonomy_config.json` and must be described as derived labels in
   publications and the website.

The row-level analysis key is `(date, source, event_id)`. `event_id` is not
globally unique: the audited snapshot contains the value `1585` in both INFER
and Metaculus. For event-level deduplication, use `(source, event_id)`.

## Official source mapping

| Raw source | Official source | Origin type |
|---|---|---|
| `acled` | ACLED | Dataset |
| `dbnomics` | DBnomics | Dataset |
| `fred` | FRED | Dataset |
| `wikipedia` | Wikipedia | Dataset |
| `yfinance` | Yahoo Finance | Dataset |
| `infer` | INFER | Market |
| `manifold` | Manifold | Market |
| `metaculus` | Metaculus | Market |
| `polymarket` | Polymarket | Market |

Unknown sources fail closed instead of being silently assigned to an origin.

## Derived topics

The stable top-level labels in `forecastbench-topic-v1.1.0` are:

- `finance_economics`
- `politics_conflict`
- `climate_weather`
- `health_science`
- `technology_ai`
- `sports`
- `entertainment_culture`
- `other`

The classifier applies rules in this order:

1. Detect the exact generic-pair template.
2. Apply the versioned `(source,event_id)` decisions from the manual review
   of every initially conflicting event and the stratified error audit.
3. Apply high-confidence source rules to visible ACLED, DBnomics, FRED, and
   Yahoo Finance questions.
4. Apply the separately documented Wikipedia template rules.
5. Apply narrow text-level disambiguation rules to visible market questions.
6. Collect all matching market keyword topics. The first configured topic is
   the deterministic primary label, while every match remains in
   `topic_candidates`.
7. If no semantic rule matches, assign `other` with `topic_status=fallback`.

Rule order is part of the versioned configuration. Before review, 61
multi-topic rows represented 17 unique events. All 17 were reviewed at the
event-ID level. Clear decisions are high-confidence manual overrides; genuinely
ambiguous decisions preserve both candidates and `review_required=true`.

### Known ambiguity regressions

Narrow overrides and word boundaries prevent mistakes observed in the earlier
prototype classifier:

- “James Bond” is entertainment, not a finance match on `bond`.
- Eurovision is entertainment/culture, not sports.
- H5N1/HPAI/avian influenza is health/science.
- Super Bowl questions are sports even when no team-league abbreviation is
  present.
- President's Trophy questions are ice hockey, not politics; Tesla questions
  with an explicit dollar/price/stock cue are finance, not technology.

## Generic-pair limitation

The audited input has 5,040 generic-pair rows (36.893% of all rows), covering
4,858 distinct `(source, event_id)` values. Every one contains the same 248
character instruction template, not the two constituent question texts.

Consequently, a source label cannot recover the pair's semantic topic. All
generic pairs are encoded as:

- `derived_topic=other`
- `derived_subtopic=generic_pair_unrecoverable`
- `topic_status=generic_pair_unrecoverable`
- `topic_analysis_eligible=false`
- `review_required=true`

`source_domain_hint` is retained for descriptive source-stratified analyses,
but it must not be interpreted as the pair's semantic topic. Generic pairs can
be included in `origin_type` or `official_source` analyses and must be excluded
from headline semantic-topic analyses unless their constituent texts are
recovered from upstream data.

Generic-pair row counts by source are:

| Source | Rows |
|---|---:|
| ACLED | 800 |
| FRED | 790 |
| Yahoo Finance | 784 |
| Polymarket | 759 |
| Wikipedia | 628 |
| DBnomics | 597 |
| Manifold | 334 |
| Metaculus | 226 |
| INFER | 122 |

## Output schema

The classifier preserves all input columns and appends:

| Field | Meaning |
|---|---|
| `origin_type` | Official Dataset/Market split |
| `official_source` | Canonical official source label |
| `is_generic_pair` | Exact generic-pair template flag |
| `source_domain_hint` | Descriptive source domain; not a semantic topic |
| `topic_id` | Metrics-facing stable ID; exactly equal to `derived_topic` |
| `derived_topic` | Versioned primary semantic label |
| `derived_subtopic` | More specific rule output |
| `topic_status` | `source_rule`, `keyword_rule`, `keyword_conflict`, `manual_override`, `generic_pair_unrecoverable`, or `fallback` |
| `topic_rule_id` | Stable ID of the selected rule |
| `topic_confidence` | `high`, `medium`, `low`, or `unavailable` |
| `topic_candidates` | Semicolon-delimited set of all candidate topics |
| `topic_candidate_count` | Number of distinct candidates |
| `topic_analysis_eligible` | Default inclusion flag for semantic-topic analysis |
| `review_required` | Manual-review queue flag |
| `taxonomy_version` | Configuration version used for the row |

For primary semantic-topic tests, filter
`topic_analysis_eligible=true`. Report a sensitivity analysis excluding
`review_required=true` rows. Always report support by topic and model pair.

## Audited snapshot

Input SHA-256:
`ad757817d32acca985f27e1ec82c190587303f4acd69bcda0380ba752a5505ff`

The snapshot contains 13,661 unique `(date, source, event_id)` rows, 8,204
unique `(source, event_id)` values, and 25 dates. Official provenance counts
are 10,205 Dataset rows and 3,456 Market rows.

Classification output for `forecastbench-topic-v1.1.0`:

| Derived topic | Rows |
|---|---:|
| `finance_economics` | 2,972 |
| `politics_conflict` | 1,826 |
| `climate_weather` | 1,233 |
| `health_science` | 690 |
| `technology_ai` | 265 |
| `sports` | 755 |
| `entertainment_culture` | 153 |
| `other` | 5,767 |

The `other` total is deliberately split by status: 5,040 unrecoverable
generic-pair rows, 725 visible but unmatched fallback rows, and two explicit
manual-review decisions that remain semantically unresolved. After reviewing
all 61 initial conflict rows, no unreviewed `keyword_conflict` remains. The
default semantic-topic eligible set contains 7,894 rows; 5,778 rows require
review, including all generic pairs and fallbacks. Only 11 eligible topic rows
remain review-required; their ambiguity is retained for sensitivity analysis.

These counts supersede the coarse prototype labels only for this repository's
versioned taxonomy. They do not alter ForecastBench's official provenance.

## Reproduction

```bash
python -m analysis.taxonomy \
  --input-csv /local/path/resolved_events_merged.csv \
  --output-csv /local/path/resolved_events_taxonomy.csv \
  --summary-json /local/path/taxonomy_summary.json
```

Run unit tests without licensed data:

```bash
python -m pytest
```

Run the optional golden snapshot test when the local data is available:

```bash
FORECASTBENCH_RESOLVED_EVENTS_CSV=/local/path/resolved_events_merged.csv \
  python -m pytest tests/test_taxonomy.py
```

The golden test verifies the input hash, row counts, official split, all topic
and status counts, unique-key preservation, and stable topic labels for every
repeated `(source, event_id)`.
