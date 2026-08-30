# Public research website

## Release scope — 2026-08-30

This is a presentation-only redesign of the ForecastBench Dependence Atlas. The
release target is the existing GitHub Pages site. Aggrena, its domains, Workers,
databases, forecasting jobs, and leaderboards are not changed.

## Information architecture

| Navigation | Experiments |
| --- | --- |
| Overview | Research introduction, dataset counts, real-data matrix preview, exploration entry points |
| Diversity | Event atlas, global view, pair rankings, model profiles, topic stability |
| Aggregation | Model pairs, without-market-information pairs, information exposure |
| Markets | Model performance, market + model, market-informed models, selected model pairs |
| Methods | Methodology, data and audit |

All fourteen original experiment anchors remain valid. Query parameters continue
to carry model choices and filter state. Visited experiments stay mounted but
hidden, so changing sections does not reset their controls. Large experiment
datasets are requested when a reader first opens the corresponding section.
Browser back/forward restores the URL-backed atlas, global, aggregation, and focal
controls. A hidden model-pair experiment cannot automatically change the atlas's
shared Near-BI toggle.

The public overview uses actual data from the selected event slice. Its eight-model
matrix is explicitly a coverage-based preview; it does not change the full atlas's
default thirty-model matrix or a reader's custom selection. Model-version suffixes
remain distinguishable in the preview.

## Presentation changes

- A five-link primary navigation replaces the long list of experiment anchors.
- Each research area has a short secondary navigation and one visible experiment.
- Graphs precede method comparison tables in the model-pair and market-pool views.
  Method selectors and the original comparison tables control the same state.
- Extended methods, split seeds, provenance, and interpretation notes are retained
  in native, keyboard-accessible disclosures.
- Essential scope remains visible: same-sample versus cross-fit, hindsight
  benchmarks, Dataset exclusions, and matched-support market comparisons.
- The header and analysis filters remain in normal document flow, not sticky.
- Mobile controls scroll within their own containers instead of widening the page.
- Source code, dataset attribution, and the CC BY-SA 4.0 license remain available.

## Unchanged research contract

No analysis scripts, derived results, published data, scoring formulas, splitting
rules, sample filters, metric directions, or aggregation defaults were changed.
The published tracked data-file checksum before the redesign is:

`ee94fa3a65b84ffb722c33f48a61bac07c1f1915516be5b1e545bbd1d0e659f3`

Computed with `git ls-files -z site/public/data | xargs -0 shasum -a 256 | shasum -a 256`.
This digest includes each tracked file's content hash and path.

## Verification

- TypeScript and production build.
- Complete front-end unit and data-contract suite: 77 tests across 19 files.
- Desktop and mobile end-to-end tests: 43 passed and one existing mobile-only test
  skipped in the desktop project. Coverage includes all original scientific-value
  assertions, every section link, deep links, back/forward navigation, fold
  selection, thirty-model coverage, and shared custom heatmap selection.
- GitHub Pages subpath build and browser verification.
- Responsive visual checks and per-experiment viewport-overflow assertions.
- The existing CI continues to run the Python checks before publishing Pages.

No public conclusion is inferred from the new overview's visual preview. Detailed
experimental limitations are available in each experiment and the Methods area.

## Focal-left pair markers — 2026-08-30

All split-color aggregation markers now use the selected focal model's family
color on the left and the partner's family color on the right. Labels use the same
focal-first order. Same-family pairs remain a single color. The original palette,
coordinates, support sizes, and scientific results are unchanged.

The shared renderer covers all 21 family combinations, all aggregation methods and
diversity metrics, Near-BI, same-sample diagnostics, and cross-fit Combined/A→B/B→A.
Other charts keep their existing single-color encodings (provider, information
condition, or above-market status); those colors convey different information.

The orientation key remains visible on mobile. Verification: 105 frontend tests
passed (including 28 marker-regression cases); desktop/mobile browser tests passed
47 cases, with the existing desktop skip for the mobile-only case unchanged.

## TV extension after the redesign — 2026-08-30

A subsequent update adds predictive total variation to the current experiment
data and controls, including the all-configuration model-versus-market plot.
The Same-sample diagnostic aggregation switch is removed; Cross-fit OOS retains
Combined, A→B, and B→A. The sections above document the earlier presentation-only
release and its then-existing controls. See
[Total variation and cross-fit controls](total-variation-crossfit.md) for the new
definition, regeneration scope, unchanged-result checks, and validation record.
