# Market overview → existing aggregation results

## Scope

The market-performance overview's selected-configuration panel retains direct
links to earlier model-pair aggregation results under **Earlier experiments**.
This secondary link index does not recalculate forecasts, split assignments,
diversity metrics, scores, or aggregation results.

The primary **Explore aggregation** action now opens the complete
[exact-configuration experiment](configuration-pair-aggregation.md) below the
overview. That separately computed experiment covers the entire 238-configuration
catalog; it is not limited to the 83 configurations with earlier exact matches.

Match the complete configuration: model version, information condition, and
prompt. Never remove the prompt suffix to find a merely similar version.

The link index is derived only from existing public JSON:

- `polymarket-aggregation/market-diversity-performance.json`: source catalog.
- `pair-aggregation/upper-left-model-pairs.json`: exact selected-model pairs,
  with full-sample and train-selected cross-fit views. Both use pair-matched
  freeze-time Polymarket test support; the full-sample view stays labeled as
  such and is not presented as a new OOS experiment.
- `pair-aggregation/fixed-focal-without-freeze.json`: existing fixed-base
  model-only experiment. A link is eligible only if the audit records exactly
  one representative configuration for that model and its complete name
  matches the clicked configuration. This experiment has broader Dataset +
  Market coverage, so links explicitly distinguish its scope from Polymarket.

## Interaction contract

1. Clicking or keyboard-activating a point pins its exact configuration in the
   new aggregation block. Merely focusing a point previews its inspector.
2. The inspector's secondary links display only available matching earlier
   results: 101 links across 83 exact configurations.
3. Upper-left links carry `upper_left_base` (the full configuration) and
   `upper_left_view` (`crossfit` or `fixed`). The requested graph selects that
   base without silently substituting another configuration.
4. Fixed-base links carry the existing `nofreeze_base` query parameter after
   exact configuration verification.
5. Configurations without an earlier exact match still have the primary action
   for the new experiment. They do not receive a model-version fallback link
   or a misleading link to a different prompt or information condition.
6. TV and the other existing metric/method controls remain available in the
   destination graph. A result link does not promise methods that its original
   experiment never evaluated.

## Validation and release

The generated index is checked against the source JSON with
`node site/scripts/build-aggregation-links.mjs --check`. Unit tests check exact
identity and destination state; browser tests exercise both pointer/keyboard
selection and destination links. It is published with the complete experiment
to the existing GitHub Pages site only, not Aggrena.
