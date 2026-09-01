# Cross-category complementarity: public research view

Visual thesis: a quiet white research canvas with gold and slate for the two models, and purple for aggregation. The ability profile, rather than a decorative hero, is the first visual anchor.

Content plan: select a skill-matched model pair and compare training/test category profiles; evaluate five unchanged aggregation formulas against the better single model; compare BI-gap limits 3 and 5; inspect ten event directions; expose methods and data provenance.

Interaction thesis: selecting a pair links the scatter and the ability profile; a method switch updates the profile's aggregation marker and gain chart together; coverage and source/topic filters update the full cohort with short, reduced-motion-aware transitions. Train and test have one shared BI scale.

The source is the independently audited `complementarity_unweighted_gap_sensitivity_2026-09-01` package. The exporter only copies/restructures its values and checks primary-cohort counts and gains against the original summaries; it does not refit or change Simple mean, Log-odds mean, EC w=0.56, Piecewise odds, or Directional CF. Category labels only define the complementarity screen and never route or tune aggregation. No changes are made to existing market screens.

The interactive pair explorer uses the declared primary event split, with all 2,618 dimension/pair views available before support filters. The ten fixed event directions are published as cohort stability summaries. BI-gap limits 3 and 5 and four category-coverage thresholds remain inspectable. The featured pair is explicitly illustrative. Missing values are null, not zero, and sparse test categories are distinguished from confirmed preservation of strengths.

Re-export with `python analysis/export_complementarity_site.py --study /path/to/complementarity_unweighted_gap_sensitivity_2026-09-01`. Source hashes and publication hashes are in `site/public/data/complementarity/manifest.json` and `study.json`. Downloads contain model-pair derived results and reports; personal local paths and the raw forecast archive are not published.

## Validation

- The publication contract independently checks source-file hashes, all 2,618 primary pair identities, every published cohort count and method mean, the featured pair, and undefined versus zero values.
- All five selectable methods are the existing deployable formulas. Best Single remains a hindsight baseline and is not selectable.
- A live browser check confirms method switching, scatter-to-profile selection, both BI-gap thresholds, both grouping dimensions, and URL persistence.
- At a 390-pixel viewport the page has no document overflow. Ability profiles switch between train and test using one fixed BI scale. The page is English-only; keyboard activation and reduced-motion styling are supported.
- The research module and its data snapshot load only when this page is visited. Existing market screens and method calculations are unchanged.
