# Cross-category complementarity: public research view

Visual thesis: a quiet white research canvas with gold and slate for the two models, and purple for aggregation. The ability profile, rather than a decorative hero, is the first visual anchor.

Content plan: select a skill-matched model pair and compare training/test category profiles; evaluate five unchanged aggregation formulas against the better single model; compare BI-gap limits 3 and 5; inspect ten event directions; expose methods and data provenance.

Interaction thesis: selecting a pair links the scatter and the ability profile; a method switch updates the profile's aggregation marker and gain chart together; coverage and source/topic filters update the full cohort with short, reduced-motion-aware transitions. Train and test have one shared scale for the selected metric. The Markets page also embeds a focal-model view at its end: the exact model version, prompt, and information condition selected in the first chart become the fixed focal configuration, and the embedded view screens its partners from the frozen results.

The source is the independently audited `complementarity_all_configurations_2026-09-01` package. The exporter only copies/restructures its values and checks primary-cohort counts and gains against the original summaries; it does not refit or change Simple mean, Log-odds mean, EC w=0.56, Piecewise odds, or Directional CF. It also derives a calibration diagnostic from the frozen raw probabilities: Prophet Arena engine 2.2.0-compatible ECE with ten fixed equal-width bins over `[0, 1]`, pooled uniform common rows, and no question fixed effect or BI normalization. The exported audit reconstructs the frozen overall and category BI values from those probabilities before accepting the ECE values. Event type uses seven displayed domains: Health, Politics, Sports, Finance, Technology, Climate / Weather, and Entertainment / Culture. Science, conflict, economics, and AI are folded into Health, Politics, Finance, and Technology. Category labels only define the complementarity screen and never route or tune aggregation. The Markets integration adds a read-only view over this snapshot; it does not change existing market controls or calculations.

The interactive pair explorer uses the declared primary event split, with all eligible exact-configuration pair views retained before the displayed support filters. The ten fixed event directions are published as cohort stability summaries. BI-gap limits 3 and 5 and four category-coverage thresholds remain inspectable. The featured pair is explicitly illustrative. Missing values are null, not zero, and sparse test categories are distinguished from confirmed preservation of strengths.

Re-export with `uv run --with numpy python analysis/export_complementarity_site.py --study /path/to/complementarity_all_configurations_2026-09-01`. Source hashes and publication hashes are in `site/public/data/complementarity/manifest.json` and `study.json`. Downloads contain model-pair derived results and reports; personal local paths and the raw forecast archive are not published.

## Validation

- The publication contract independently checks source-file hashes, all 2,618 primary pair identities, every published cohort count and method mean, the featured pair, and undefined versus zero values.
- All five selectable methods are the existing deployable formulas. Best Single remains a hindsight baseline and is not selectable.
- A live browser check confirms method switching, the Gain / BI / ECE outcome control, scatter-to-profile selection, both BI-gap thresholds, both grouping dimensions, and URL persistence.
- At a 390-pixel viewport the page has no document overflow. Ability profiles switch between train and test using one fixed BI scale. The page is English-only; keyboard activation and reduced-motion styling are supported.
- The full research module loads only when the Complementarity page is visited. On Markets, the same data snapshot loads lazily when the embedded focal-model section approaches the viewport. Existing market controls and method calculations are unchanged.


## Type-based selection extension (2026-09-07)

The independent `TypeSelectionExperiment` section adds a trained 0/1 router to
the event-type page, using the frozen 2026-09-05 event-weighted panel. It compares
selection with Simple mean, Log-odds mean, EC (w=0.56), and Piecewise odds on
training-defined complementary types and on all shared test events. The original
five-formula experiment and its scores remain unchanged. The new section shares
the gap, coverage, identity-scope and selected-pair controls, always requires
crossed training strengths, and exposes Brier/BI/ECE, pair routing maps, ten
direction summaries, downloads and numerical audits.

Reproduce with NumPy and pandas:

```bash
python -m analysis.type_selection --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05
```

The protocol is in `docs/type-selection-protocol.md`; outputs are in
`site/public/data/type-selection`. Direct section URL:
`?cc_section=type-selection#complementarity`.

## Type-selection mechanism follow-up (2026-09-07)

The nested `TypeSelectionMechanisms` section examines the same frozen panel,
training filters and two test scopes. It adds confidence-group gain attribution,
training-fitted calibration and nested joint-prediction controls, convex pooling
with a separate extremization step, and descriptive matching within pair, type
and selected-probability bins. Contributions retain the original event weights
and sum to the full-scope gain. The four original formulas and their predictions
are unchanged. This is an exploratory follow-up to previously inspected
historical holdouts; ten directions are stability checks, not independent trials.

Reproduce the complete export and independent audit with NumPy and pandas:

```bash
OPENBLAS_NUM_THREADS=1 python -m analysis.type_selection_mechanisms --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05
```

The fixed settings and interpretation limits are in
`docs/type-selection-mechanisms-protocol.md`. The publication in
`site/public/data/type-selection-mechanisms` includes all-direction scores,
primary-pair fitted coefficients and diagnostics, 24 filter views, a source-hash
manifest, an independent numerical audit and a report. Direct section URL:
`?cc_section=type-selection-mechanisms#complementarity`.

## Pooling without calibration (2026-09-07)

`TypeSelectionNoCalibration` adds the requested raw-forecast comparison on the
same two scopes and training filters. The four unchanged fixed methods and a
normalized-product rule use no fitted parameters. A matched uncalibrated joint
model fixes every preceding calibration/type coefficient at zero and fits only
the other-forecast coefficient. Bounded log-odds and Brier probability mixtures
provide two additional one-weight controls. A selectable same-formula duplicate
baseline compares F(s,o) with F(s,s), preserving learned weights at evaluation.
This distinguishes replacing a duplicate from changing confidence through the
formula itself, without claiming independent internal evidence.

```bash
OPENBLAS_NUM_THREADS=1 python -m analysis.type_selection_no_calibration --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05
```

Definitions are in `docs/type-selection-no-calibration-protocol.md`. Exported
scores, primary pair outputs, filter views and independent audits are in
`site/public/data/type-selection-no-calibration`. Direct section URL:
`?cc_section=type-selection-no-calibration#complementarity`.

## Probability-calibrated pooling (2026-09-07)

`TypeSelectionCalibratedPooling` repeats the same ten methods with two fixed
calibration locations. Input calibration fits the two exact models separately
and then pools; output calibration fits each raw method's pooled output. Each
location has its own equally calibrated selection baseline. The raw-training
router and complete test support remain unchanged. The module displays both
test scopes, all shared training filters, raw and calibrated Brier/ECE, gains
against selection or a frozen same-pipeline duplicate, and all ten directions.
Multiple fitted stages reuse the outer training sample; no inner cross-fitting
or independence of internal evidence is claimed.

```bash
OPENBLAS_NUM_THREADS=1 python -m analysis.type_selection_calibrated_pooling --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05
```

The frozen protocol is `docs/type-selection-calibrated-pooling-protocol.md`.
All 24 views, primary-pair coefficients and scores, all-direction scores,
source/code hashes, protocol lock, independent audit and report are in
`site/public/data/type-selection-calibrated-pooling`. Direct section URL:
`?cc_section=type-selection-calibrated-pooling#complementarity`.

## Aggregation verdict presentation (2026-09-07)

The public `#complementarity` entry now opens `AggregationDecisionExplorer`.
It leads with the matched contrast between flexible type-adjusted selection
and the joint predictor, using the existing mechanism publication. A four-row
table separates raw routing, global calibration, flexible type adjustment and
adding the other forecast. The two test scopes and three training filters
continue to use the same archived data, weighting and pair eligibility.

Formula comparisons, direction stability and downloads are collapsed by
default. Formula evidence loads on demand and reports gains against both its
own selection baseline and the stronger single-forecast baseline. This avoids
presenting an improvement over simple calibration as a gain over the strongest
tested single-forecast control. No experiment, exported score or calibration
formula changes in this presentation revision.

The previous complete explorer and all detailed experiments remain accessible
through `?cc_view=explorer#complementarity`; retain `cc_section` to target a
specific original experiment there. Existing type-selection section links
without `cc_view=explorer` now lead to the concise verdict. The preferred link
is `?cc_section=aggregation-verdict#complementarity`.

## Individual pair verdicts

The concise aggregation verdict also supports `cc_result=pair&cc_pair=<published pair id>`.
The Overall evidence / One model pair tabs preserve the training cohort and test-scope
filters. Base model and Partner model selectors retain exact prompt and information
labels. Previous/next navigation stays within the selected base's eligible partners,
ordered alphabetically rather than by held-out performance. Base/partner labels and
training routing columns follow the reader's orientation even when the base is stored
as the second member of the published pair.

Each pair shows the same raw routing / global calibration / flexible selection / matched
joint sequence, using its own event-equal test Brier. Positive and negative added-forecast
gains are retained. Supporting disclosures contain raw, input-calibrated and output-calibrated
pooling scores, training type routing, ECE, and eligible repeated directions. Direction
eligibility uses that direction's training gap and coverage. A pair excluded by the active
filters shows an explicit empty state, never an aggregate score or a substituted pair.

`python3 site/scripts/export-decision-pairs.py` packages existing published records into
`site/public/data/aggregation-decision-pairs/`. It does not refit, rescore, or alter the
original experiment files. The index and a small pair shard are fetched only after opening
the individual-pair view. The export preserves source values and verifies 3,840 primary
mean scores across all 24 cohort settings against the existing mechanism/raw/calibrated
publications. `provenance.json` records source hashes and the validation count.

## Select the base in Markets

The first Markets scatter now selects the base for a compact Selection vs aggregation
block immediately below it. Its inspector shows `BASE MODEL · POLYMARKET` and a
button that scrolls to the comparison. Clicking or keyboard-selecting a point updates
the experiment's exact base; only the Partner model selector is editable inside the
embedded comparison. `cc_base` and `cc_pair` preserve the selection across refreshes,
while changes to the experiment controls retain `#market-performance`.

The compact ability strip copies Brier, BI and event support from the selected chart
point. These scores use that configuration's shared Polymarket events across event
types; they are not full ForecastBench scores or scores on a partner-specific test
intersection. They remain fixed when the partner or experiment test scope changes.
The aggregation table still reads the original experiment's held-out results. A base
without an eligible partner stays selected and shows an empty comparison.

The Selection vs aggregation navigation entry follows Model performance inside
Markets. Long explanatory paragraphs have been removed from the concise views;
score tables, controls, comparator labels and collapsed supporting evidence remain.
The full research explorer and its methods remain available at the existing URL.

## Uncalibrated fifth pipeline row

The main comparison now appends `Uncalibrated aggregation` in both overall and
individual-pair views, including the Markets-linked experiment. Its selector exposes
the four existing fixed formulas: Simple mean (the fixed default), Log-odds mean,
EC with w = 0.56, and Piecewise odds. `cc_raw_method` persists the method choice.
No method is automatically chosen from its test performance.

This row reads the original mechanism publication's uncalibrated formula scores
(indices 1–4), on the same pair and event scope as the preceding four rows. Its gain
compares with raw type selection (row 1). The main matched result still compares
rows 3 and 4; row 4 and row 5 use different aggregation families, so their difference
is not an isolated calibration effect. ECE follows the selected fifth-row formula.
No predictions, calibration fits, training rules or exported scores are changed.

## Post-hoc no-reversal pairs and training-overall fallback

The default concise verdict now uses `aggregation-stability/`, restricted to
the same crossed-training-strength model pairs. `cc_stability=stable` selects
pairs with no held-out reversal in any training-defined complementary type;
`fallback` selects reversed or unverified pairs and `all` includes both groups.
No unrelated model pairs are added. The default is `stable`. The original
training-only scores remain accessible with `cc_stability=original` and in the
full research explorer.

The reversal check uses the raw model forecasts once per pair/direction and
is shared by all calibration modes and both test scopes. Any reversed type
causes the entire pair to use its training-overall Brier winner. A missing test
type is unverified and also falls back; ties do not count as reversals. The
new calibrations and matched controls are fitted on training data using the
resulting selected/other roles. Tests explicitly distinguish the training
fallback winner from the better test model.

The UI labels these test-conditioned groups as post-hoc. It displays the
fallback model and each type's training/test support and reversal status.
Original archived forecasts, scores and protocols are retained unchanged.

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python -m analysis.aggregation_stability --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05 --workers 4
```

The new protocol, source/code hashes, numerical audit, all-direction JSONL,
primary fitted coefficients, per-pair shards and 24 filtered cohort views are
published under `site/public/data/aggregation-stability/`. Export requires
independent event-level score reconstruction, unchanged-score checks against
the original publication, and primary cohort reconstruction from pair records.

## Event-type matched aggregation row (2026-09-08)

The overall pipeline table now adds `Matched aggregation · event-type weights`
after the global no-calibration coefficient. Each supported training event type
fits its own coefficient on the other-minus-selected log-odds difference; types
with fewer than 30 training events and unseen types use the published pooled
fallback. The row reports both Brier and ECE, its Brier gain against the displayed
selection baseline, and separate Brier/ECE gains against the global coefficient.

The row is available for the original training-only routing population and the
default no-reversal cohort, where its selected/other roles and test support match
the surrounding table. It is deliberately omitted for the overall-fallback and
mixed-policy cohorts: those views replace the selected model after inspecting
test reversal status, but the event-type experiment does not refit coefficients
under that changed policy. The UI explains the omission instead of joining
incomparable scores.

An expandable evidence table retains all ten fixed directions and reports gains
against both raw selection and the global coefficient. Report, protocol,
coefficient summary, and audit downloads are linked from the same disclosure.
The published data contract verifies the frozen method identities, complete
directions, cohort partition, shared support, and exact reproduction of the raw
selection and global-weight columns before displaying the new result.

Reproduce the publication with:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python -m analysis.typewise_matched_aggregation --study /path/to/complementarity_all_configurations_event_weighted_2026-09-05 --output site/public/data/typewise-matched-aggregation --workers 4
```

The locked protocol is `docs/typewise-matched-aggregation-protocol.md`; frontend
artifacts are published under `site/public/data/typewise-matched-aggregation/`.
This remains an exploratory no-calibration result. No existing selection,
scoring, ranking, fallback, or pair-level calculation is changed.

## Temporary No reversals presentation scope (2026-09-09)

The aggregation verdict and its Markets-embedded pair view now display only
No reversals. The cohort picker is removed, and legacy
`cc_stability=fallback|all|original` links normalize to `stable`. Reversed or
unverified pair bookmarks show an empty state and eligible partners, without
a link to fallback results. The full research explorer entry is hidden from
the focused verdict; the archived explorer remains available at its existing
direct URL.

The focused results use complementary events only; the All test events switch
is removed and legacy `cc_test_scope=all` links normalize to `complementary`.
The same scope applies to overall evidence, model pairs, Markets and 2–4 models.
The focused scope annotation and study-filter controls are removed; model-pair
browsing remains available. Pair metadata, reversal
explanations, the duplicated Polymarket ability summary, the eligible-partner
count, Test directions disclosures, Pooling methods and the Post-hoc context
annotation are removed from the focused UI. Study protocols and downloadable
evidence retain the full methodology and provenance.
This is a presentation change: experimental outputs, archived cohort loaders,
scoring, routing, fitted coefficients and calibration behavior are unchanged.

## Event-type weights for individual pairs (2026-09-09)

The individual-pair comparison, including the Markets-linked view, now includes
row 4, `Matched aggregation · event-type weights`, immediately after row 3,
`Matched aggregation · no calibration`. Brier, ECE, selection gain, and the
comparison with the global coefficient come from the selected pair on the same
complementary-event support. The ECE disclosure and pair JSON download include
the new result. Changing the base or partner reloads the matching scores.

`python -m analysis.export_typewise_pair_scores` extracts the primary direction
from the frozen `all-direction-results.jsonl.gz` into small pair shards. It
performs no fitting or rescoring and verifies identities, support, and both
selection/global Brier and ECE against the existing pair records. The browser
checks these contracts again before displaying a pair. Export provenance and
shard hashes are recorded in `typewise-matched-aggregation/pair-scores-manifest.json`.

The `2–4 models` tab is temporarily hidden in both the overall explorer and the
Markets embed. Existing direct model-count URLs and their archived data remain
available.
