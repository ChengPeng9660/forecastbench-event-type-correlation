# Fixed-focal without-freeze aggregation

Generated: 2026-08-27

## Question

For one selected canonical model that did not receive ForecastBench freeze
values, which other without-freeze model is the most useful aggregation
partner? The focal model stays fixed across partners and is always the
denominator of the reported fractional gain.

## Design

- Universe: 43 canonical merged GPT, Claude, Gemini, Qwen, DeepSeek, and Kimi
  model versions; every retained configuration excludes `with freeze values`.
- Eligibility: reuse the 337 unordered pairs in the released six-family
  cross-fit benchmark, then expand them to 674 ordered focal-to-partner pairs.
- Evaluation: ten reproducible SHA-256 event-disjoint A/B splits. Each ordered
  pair is evaluated A-train to B-test and B-train to A-test.
- Training-fold quantities: all three diversity metrics, Near-BI, and the two
  Directional CF weights.
- Test-fold quantities: aggregation BI and fractional gain versus the fixed
  focal model, partner, and hindsight best constituent.
- Methods: EC (`w=0.56`), Simple Mean, Log-odds Mean, Piecewise Odds,
  Directional CF, and non-deployable Best Single.

## Overall result

The following summaries support-weight all 674 ordered pairs by their common
test-event cells. Because both orientations are present, the aggregate gain
versus focal and aggregate gain versus partner coincide at the whole-universe
level; they generally differ within any selected focal-model view.

| Method | BI (higher is better) | Gain vs focal | Gain vs hindsight best | Positive vs focal |
|---|---:|---:|---:|---:|
| EC, `w=0.56` | 61.45 | +5.80% | -1.22% | 491 / 674 |
| Simple Mean | 61.32 | +5.25% | -1.89% | 488 / 674 |
| Log-odds Mean | 61.46 | +5.89% | -1.13% | 495 / 674 |
| Piecewise Odds | 61.31 | +5.09% | -1.95% | 460 / 674 |
| Directional CF | **62.50** | **+10.60%** | **+4.10%** | **647 / 674** |
| Best Single (hindsight) | 61.68 | +6.75% | 0.00% | 442 / 674 |

Directional CF is the strongest deployable method in this experiment. This is
an OOS benchmark result, not a pair-independent dominance guarantee.

## Diversity interpretation

The website recomputes Pearson and Spearman association only across partners
of the selected focal model. This is the correct unit for the fixed-base
question: the focal model, denominator, method, fold direction, and optional
Near-BI restriction remain constant while only the partner changes.

Near-BI is a training-fold restriction, not a test-outcome filter. Strong
diversity claims should be read primarily within Near-BI because otherwise
partner ability gaps can dominate aggregation gain. A negative displayed
association is an empirical finding under that focal model and should not be
relabelled as positive evidence for the diversity hypothesis.

## Reproduction

```bash
PYTHONPATH=. .venv/bin/python analysis/fixed_focal_without_freeze.py
PYTHONPATH=. .venv/bin/pytest -q tests/test_fixed_focal_without_freeze.py
cd site && npm test -- --run && npm run build && npm run test:e2e
```

Published payload:
`site/public/data/pair-aggregation/fixed-focal-without-freeze.json`.
