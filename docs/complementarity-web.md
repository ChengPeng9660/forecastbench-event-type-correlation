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
