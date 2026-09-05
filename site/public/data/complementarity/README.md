# All-configuration complementarity package

This package expands the near-skill category-complementarity study to every
clean exact ForecastBench configuration while keeping model version, prompt,
and information condition distinct.

Forecasting loss follows the event-equal definition used by the accompanying
paper: average squared errors within each event, average those event scores,
and transform the resulting ordinary Brier score to BI once.

- `PROTOCOL.md` defines the design.
- `REPORT.md` interprets the results.
- `code/` contains panel construction, evaluation, diagnostics, and audit code.
- `data/` contains the scored panel, exact-configuration catalog, source
  manifest, and archived scoring inputs.
- `results/` contains pair results, category profiles, summaries, diagnostics,
  and independent checks.

The five aggregation formulas are unchanged and category labels do not enter
their computation. The event-type results use seven displayed domains: Health,
Politics, Sports, Finance, Technology, Climate / Weather, and Entertainment /
Culture. Science, conflict, economics, and AI are folded into Health, Politics,
Finance, and Technology, respectively.
